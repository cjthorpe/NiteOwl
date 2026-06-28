// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { BriefingDigestInput } from '@niteowl/shared/briefing-digest';
import { describe, expect, it, vi } from 'vitest';


import {
  enhanceBriefingWithLlm,
  resolveBriefingLlmConfig,
  type BriefingLlmConfig,
  type FetchLike,
} from './briefing-llm.js';

// A non-empty input so the layer actually attempts a call.
const INPUT: BriefingDigestInput = {
  totalItems: 5,
  summary: {
    totalPrsMerged: 2,
    totalIssuesClosed: 1,
    totalCommitsPushed: 0,
    totalPrsOpened: 1,
  },
  agentGroups: [
    {
      login: 'alice',
      items: [
        { provider: 'github', eventType: 'pr_opened' },
        { provider: 'github', eventType: 'pr_merged' },
      ],
      prsOpened: 1,
      prsMerged: 2,
      issuesClosed: 1,
      commitsPushed: 0,
    },
  ],
};

const ENABLED: BriefingLlmConfig = {
  enabled: true,
  apiKey: 'sk-test',
  model: 'claude-haiku-4-5-20251001',
  baseUrl: 'https://api.anthropic.com',
  timeoutMs: 4000,
  maxTokens: 512,
};

/** Build a fetch mock returning a 200 with the given Messages-API text content. */
function okFetchReturning(text: string): FetchLike {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  }));
}

describe('resolveBriefingLlmConfig', () => {
  it('is disabled when the flag is off, even with a key', () => {
    const cfg = resolveBriefingLlmConfig({ BRIEFING_LLM_ENABLED: 'false', ANTHROPIC_API_KEY: 'k' });
    expect(cfg.enabled).toBe(false);
  });

  it('is disabled when the flag is on but no key is present', () => {
    const cfg = resolveBriefingLlmConfig({ BRIEFING_LLM_ENABLED: 'true' });
    expect(cfg.enabled).toBe(false);
  });

  it('is enabled only when both the flag and a key are present', () => {
    const cfg = resolveBriefingLlmConfig({ BRIEFING_LLM_ENABLED: '1', ANTHROPIC_API_KEY: 'k' });
    expect(cfg.enabled).toBe(true);
  });

  it('defaults to a small fast model and sane bounds', () => {
    const cfg = resolveBriefingLlmConfig({ BRIEFING_LLM_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' });
    expect(cfg.model).toBe('claude-haiku-4-5-20251001');
    expect(cfg.timeoutMs).toBeGreaterThan(0);
    expect(cfg.maxTokens).toBeGreaterThan(0);
  });

  it('honours model/timeout/maxTokens overrides', () => {
    const cfg = resolveBriefingLlmConfig({
      BRIEFING_LLM_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'k',
      BRIEFING_LLM_MODEL: 'claude-sonnet-4-0',
      BRIEFING_LLM_TIMEOUT_MS: '1500',
      BRIEFING_LLM_MAX_TOKENS: '256',
    });
    expect(cfg.model).toBe('claude-sonnet-4-0');
    expect(cfg.timeoutMs).toBe(1500);
    expect(cfg.maxTokens).toBe(256);
  });
});

describe('enhanceBriefingWithLlm — fallback paths return null', () => {
  it('returns null without calling fetch when disabled', async () => {
    const fetchImpl = vi.fn();
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: { ...ENABLED, enabled: false },
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null without calling fetch for an empty window', async () => {
    const fetchImpl = vi.fn();
    const empty: BriefingDigestInput = { ...INPUT, totalItems: 0, agentGroups: [] };
    const result = await enhanceBriefingWithLlm(empty, {
      config: ENABLED,
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const result = await enhanceBriefingWithLlm(INPUT, { config: ENABLED, fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: ENABLED,
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toBeNull();
  });

  it('returns null when the model text is not parseable JSON', async () => {
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: ENABLED,
      fetchImpl: okFetchReturning('I could not produce JSON, sorry.'),
    });
    expect(result).toBeNull();
  });

  it('returns null when the JSON is missing a headline', async () => {
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: ENABLED,
      fetchImpl: okFetchReturning(JSON.stringify({ highlights: [] })),
    });
    expect(result).toBeNull();
  });

  it('returns null and aborts when the call exceeds the timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const promise = enhanceBriefingWithLlm(INPUT, {
      config: { ...ENABLED, timeoutMs: 1000 },
      fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe('enhanceBriefingWithLlm — success path', () => {
  it('returns a sanitised digest and sends a well-formed request', async () => {
    const fetchImpl = okFetchReturning(
      JSON.stringify({
        headline: 'Five updates from one busy agent overnight.',
        highlights: [
          { kind: 'needs_review', text: 'Alice has a PR ready for your eyes.', emphasis: true },
          { kind: 'merged', text: 'Two PRs landed cleanly.' },
        ],
      }),
    );
    const result = await enhanceBriefingWithLlm(INPUT, { config: ENABLED, fetchImpl });
    expect(result).not.toBeNull();
    expect(result?.headline).toContain('Five updates');
    expect(result?.highlights[0]).toMatchObject({ kind: 'needs_review', emphasis: true });

    // Request integrity: correct endpoint, auth header, and model in the body.
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init as { headers: Record<string, string> }).headers['x-api-key']).toBe('sk-test');
    expect((init as { body: string }).body).toContain('claude-haiku-4-5-20251001');
  });

  it('drops highlights with an unknown kind but keeps valid ones', async () => {
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: ENABLED,
      fetchImpl: okFetchReturning(
        JSON.stringify({
          headline: 'Activity overnight.',
          highlights: [
            { kind: 'bogus_kind', text: 'should be dropped' },
            { kind: 'merged', text: 'kept' },
          ],
        }),
      ),
    });
    expect(result?.highlights).toHaveLength(1);
    expect(result?.highlights[0]?.kind).toBe('merged');
  });

  it('extracts JSON even when wrapped in markdown fences', async () => {
    const result = await enhanceBriefingWithLlm(INPUT, {
      config: ENABLED,
      fetchImpl: okFetchReturning(
        '```json\n{"headline":"Wrapped.","highlights":[]}\n```',
      ),
    });
    expect(result?.headline).toBe('Wrapped.');
  });
});
