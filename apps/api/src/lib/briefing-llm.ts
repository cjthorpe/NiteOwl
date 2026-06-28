// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import {
  buildBriefingDigest,
  type BriefingDigest,
  type BriefingDigestInput,
  type BriefingHighlight,
  type BriefingHighlightKind,
} from '@niteowl/shared/briefing-digest';

/**
 * Optional LLM enhancement layer for the morning-briefing digest (FUL-136).
 *
 * The heuristic ({@link buildBriefingDigest}) is the guaranteed, dependency-free
 * fallback. This layer asks a small, fast Claude model to REWRITE the heuristic
 * into warmer, more natural-language copy while preserving the structured shape
 * (`kind` / `emphasis` / order) the UI styles against. It is:
 *
 *   - gated behind `BRIEFING_LLM_ENABLED` AND a present API key,
 *   - hard-bounded by a timeout (AbortController),
 *   - total: it NEVER throws and NEVER returns a malformed digest — every failure
 *     path (disabled, unkeyed, network error, non-2xx, timeout, unparseable or
 *     schema-invalid output) resolves to `null`, signalling the caller to use the
 *     heuristic instead.
 *
 * No client-side secret is ever involved: this runs server-side only and the key
 * lives in `ANTHROPIC_API_KEY`.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_TOKENS = 512;
const ANTHROPIC_VERSION = '2023-06-01';

/** Bounds applied to model output before it is trusted by the UI. */
const MAX_HEADLINE_LEN = 240;
const MAX_HIGHLIGHT_LEN = 240;
const MAX_HIGHLIGHTS = 5;

const HIGHLIGHT_KINDS: ReadonlySet<BriefingHighlightKind> = new Set([
  'needs_review',
  'merged',
  'top_mover',
  'issues',
  'commits',
  'providers',
]);

export interface BriefingLlmConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxTokens: number;
}

/** Minimal structural type for the fetch we depend on (injectable in tests). */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface EnhanceDeps {
  config: BriefingLlmConfig;
  fetchImpl?: FetchLike;
  logger?: { warn: (obj: unknown, msg?: string) => void };
}

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the LLM configuration from an environment bag.
 *
 * `enabled` requires BOTH the flag to be truthy AND a non-empty API key, so an
 * operator can never half-enable the feature into a guaranteed-fail state.
 */
export function resolveBriefingLlmConfig(env: NodeJS.ProcessEnv = process.env): BriefingLlmConfig {
  const apiKey = (env['ANTHROPIC_API_KEY'] ?? '').trim();
  const flag = parseBool(env['BRIEFING_LLM_ENABLED']);
  return {
    enabled: flag && apiKey.length > 0,
    apiKey,
    model: (env['BRIEFING_LLM_MODEL'] ?? '').trim() || DEFAULT_MODEL,
    baseUrl: (env['ANTHROPIC_BASE_URL'] ?? '').trim() || DEFAULT_BASE_URL,
    timeoutMs: parsePositiveInt(env['BRIEFING_LLM_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS),
    maxTokens: parsePositiveInt(env['BRIEFING_LLM_MAX_TOKENS'], DEFAULT_MAX_TOKENS),
  };
}

const SYSTEM_PROMPT = [
  "You rewrite a software team's morning activity digest into warm, natural,",
  'skimmable English for an engineering manager. You are given the raw activity',
  'summary and a deterministic baseline digest.',
  '',
  'Rules:',
  '- Return ONLY a JSON object, no prose, no markdown fences.',
  '- Shape: {"headline": string, "highlights": [{"kind": string, "text": string, "emphasis"?: boolean}]}.',
  '- Preserve each highlight\'s "kind" and "emphasis" and the order from the baseline.',
  '- Never invent facts: only restate what the numbers support. Keep every count exact.',
  '- Keep the headline under 200 characters and each highlight under 200 characters.',
  '- Allowed kinds: needs_review, merged, top_mover, issues, commits, providers.',
].join('\n');

function buildUserPrompt(input: BriefingDigestInput, baseline: BriefingDigest): string {
  return [
    'Raw activity summary (JSON):',
    JSON.stringify({ summary: input.summary, totalItems: input.totalItems }),
    '',
    'Baseline digest to rewrite (JSON):',
    JSON.stringify(baseline),
    '',
    'Return the rewritten digest as JSON now.',
  ].join('\n');
}

/** Extract the first balanced top-level JSON object from a model text reply. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pull the concatenated text from an Anthropic Messages API response body. */
function textFromMessagesResponse(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body['content'])) return null;
  const text = body['content']
    .filter((b): b is Record<string, unknown> => isRecord(b) && b['type'] === 'text')
    .map((b) => (typeof b['text'] === 'string' ? b['text'] : ''))
    .join('');
  return text.length > 0 ? text : null;
}

/**
 * Validate + sanitise a parsed model object into a trusted {@link BriefingDigest}.
 * Returns null if the structure is unusable so the caller falls back. Highlights
 * with an unknown `kind` are dropped (rather than failing the whole response),
 * but a missing/blank headline or a non-array highlights field is fatal.
 */
function sanitizeDigest(parsed: unknown): BriefingDigest | null {
  if (!isRecord(parsed)) return null;
  const headlineRaw = parsed['headline'];
  if (typeof headlineRaw !== 'string' || headlineRaw.trim().length === 0) return null;
  const highlightsRaw = parsed['highlights'];
  if (!Array.isArray(highlightsRaw)) return null;

  const headline = headlineRaw.trim().slice(0, MAX_HEADLINE_LEN);

  const highlights: BriefingHighlight[] = [];
  for (const item of highlightsRaw) {
    if (highlights.length >= MAX_HIGHLIGHTS) break;
    if (!isRecord(item)) continue;
    const kind = item['kind'];
    const text = item['text'];
    if (typeof kind !== 'string' || !HIGHLIGHT_KINDS.has(kind as BriefingHighlightKind)) continue;
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    const highlight: BriefingHighlight = {
      kind: kind as BriefingHighlightKind,
      text: text.trim().slice(0, MAX_HIGHLIGHT_LEN),
    };
    if (item['emphasis'] === true) highlight.emphasis = true;
    highlights.push(highlight);
  }

  return { headline, highlights };
}

/**
 * Enhance the digest with an LLM rewrite, or return null to use the heuristic.
 *
 * Total function: any disabled/error/timeout path resolves to null.
 */
export async function enhanceBriefingWithLlm(
  input: BriefingDigestInput,
  deps: EnhanceDeps,
): Promise<BriefingDigest | null> {
  const { config } = deps;
  if (!config.enabled) return null;

  // Nothing to dress up when the window is empty — skip the call entirely.
  if (input.totalItems === 0) return null;

  const baseline = buildBriefingDigest(input);
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchImpl !== 'function') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input, baseline) }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      deps.logger?.warn({ status: res.status }, 'briefing LLM call returned non-2xx');
      return null;
    }

    const body = await res.json();
    const text = textFromMessagesResponse(body);
    if (text === null) return null;

    const sanitized = sanitizeDigest(extractJsonObject(text));
    if (sanitized === null) {
      deps.logger?.warn({}, 'briefing LLM output failed validation');
      return null;
    }
    return sanitized;
  } catch (err: unknown) {
    // Timeouts surface as AbortError; network failures as TypeError. Either way
    // we degrade silently to the heuristic — the digest must always render.
    deps.logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'briefing LLM call failed',
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
