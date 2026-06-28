// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { ActivityEventType, ActivityProvider } from '@niteowl/types';

/**
 * Heuristic morning-briefing summarisation (FUL-122).
 *
 * Turns the grouped activity feed into a short "here's what changed and why it
 * matters" digest. This is the deterministic, dependency-free baseline: it needs
 * no API key, is fully unit-testable, and is the GUARANTEED fallback.
 *
 * It lives in the isomorphic `@niteowl/shared` layer (importable as
 * `@niteowl/shared/briefing-digest` — a subpath kept free of any `node:*`
 * imports so the browser bundle stays clean) so a single source of truth is
 * shared by:
 *   - the web client (renders it directly, and as a fallback when the optional
 *     server LLM digest is unavailable), and
 *   - the API (`GET /api/briefing/digest`), which falls back to this exact shape
 *     whenever the LLM layer is disabled, unkeyed, errors, or times out (FUL-136).
 *
 * Keep this function pure — no I/O, no `node:*`, no mutation — so it remains a
 * safe fallback on both runtimes.
 */

/** The activity fields the digest reasons about (a structural subset of Activity). */
export interface DigestActivity {
  provider: ActivityProvider;
  eventType: ActivityEventType;
}

/** The slice of an agent group the digest reasons about. */
export interface DigestAgentGroup {
  login: string;
  items: ReadonlyArray<DigestActivity>;
  prsOpened: number;
  prsMerged: number;
  issuesClosed: number;
  commitsPushed: number;
}

export interface DigestSummary {
  totalPrsMerged: number;
  totalIssuesClosed: number;
  totalCommitsPushed: number;
  totalPrsOpened: number;
}

export interface BriefingDigestInput {
  agentGroups: ReadonlyArray<DigestAgentGroup>;
  summary: DigestSummary;
  totalItems: number;
}

export type BriefingHighlightKind =
  | 'needs_review'
  | 'merged'
  | 'top_mover'
  | 'issues'
  | 'commits'
  | 'providers';

export interface BriefingHighlight {
  kind: BriefingHighlightKind;
  text: string;
  /** Actionable highlights surface first and receive accent treatment. */
  emphasis?: boolean;
}

export interface BriefingDigest {
  headline: string;
  highlights: BriefingHighlight[];
}

/** Maximum highlights shown so the digest stays scannable. */
const MAX_HIGHLIGHTS = 5;

const PROVIDER_LABELS: Record<ActivityProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  slack: 'Slack',
};

/** Deterministic display order for cross-provider callouts. */
const PROVIDER_ORDER: ActivityProvider[] = ['github', 'linear', 'jira', 'slack'];

function plural(count: number, singular: string, suffix = 's'): string {
  return count === 1 ? singular : `${singular}${suffix}`;
}

/** Joins names as "a", "a and b", or "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function topBy(
  groups: ReadonlyArray<DigestAgentGroup>,
  pick: (g: DigestAgentGroup) => number,
): DigestAgentGroup | null {
  let best: DigestAgentGroup | null = null;
  let bestValue = 0;
  for (const g of groups) {
    const value = pick(g);
    if (value > bestValue) {
      best = g;
      bestValue = value;
    }
  }
  return best;
}

function buildHeadline(totalItems: number, agentCount: number): string {
  if (totalItems === 0) {
    return 'All quiet — nothing new since your last login.';
  }
  const updates = `${totalItems} ${plural(totalItems, 'update')}`;
  const agents = `${agentCount} ${plural(agentCount, 'agent')}`;
  return `${updates} from ${agents} since your last login.`;
}

function distinctProviders(groups: ReadonlyArray<DigestAgentGroup>): ActivityProvider[] {
  const seen = new Set<ActivityProvider>();
  for (const g of groups) {
    for (const item of g.items) seen.add(item.provider);
  }
  return PROVIDER_ORDER.filter((p) => seen.has(p));
}

/**
 * Build a prioritised, deterministic digest of the briefing window.
 *
 * Highlights are ordered by actionability: PRs awaiting review come first
 * (the user can act on them), followed by completed work, momentum signals,
 * and context. The list is capped at {@link MAX_HIGHLIGHTS}.
 */
export function buildBriefingDigest(data: BriefingDigestInput): BriefingDigest {
  const { agentGroups, summary, totalItems } = data;
  const headline = buildHeadline(totalItems, agentGroups.length);

  if (totalItems === 0) {
    return { headline, highlights: [] };
  }

  const highlights: BriefingHighlight[] = [];

  // 1. Actionable: open PRs waiting for review.
  if (summary.totalPrsOpened > 0) {
    const n = summary.totalPrsOpened;
    const topOpener = topBy(agentGroups, (g) => g.prsOpened);
    const who = topOpener ? ` — ${topOpener.login} opened the most` : '';
    highlights.push({
      kind: 'needs_review',
      emphasis: true,
      text: `${n} open ${plural(n, 'pull request')} waiting for review${who}.`,
    });
  }

  // 2. Completed: merged PRs.
  if (summary.totalPrsMerged > 0) {
    const n = summary.totalPrsMerged;
    const topMerger = topBy(agentGroups, (g) => g.prsMerged);
    const who = topMerger ? `, led by ${topMerger.login}` : '';
    highlights.push({
      kind: 'merged',
      text: `${n} ${plural(n, 'pull request')} merged${who}.`,
    });
  }

  // 3. Momentum: the busiest contributor (skip when it just restates the headline).
  const busiest = topBy(agentGroups, (g) => g.items.length);
  if (busiest && (agentGroups.length > 1 || busiest.items.length >= 3)) {
    const n = busiest.items.length;
    highlights.push({
      kind: 'top_mover',
      text: `${busiest.login} was the most active with ${n} ${plural(n, 'update')}.`,
    });
  }

  // 4. Completed: issues closed.
  if (summary.totalIssuesClosed > 0) {
    const n = summary.totalIssuesClosed;
    highlights.push({
      kind: 'issues',
      text: `${n} ${plural(n, 'issue')} closed.`,
    });
  }

  // 5. Volume: commits pushed.
  if (summary.totalCommitsPushed > 0) {
    const n = summary.totalCommitsPushed;
    highlights.push({
      kind: 'commits',
      text: `${n} ${plural(n, 'commit')} pushed.`,
    });
  }

  // 6. Context: cross-provider activity.
  const providers = distinctProviders(agentGroups);
  if (providers.length > 1) {
    highlights.push({
      kind: 'providers',
      text: `Activity spanned ${joinList(providers.map((p) => PROVIDER_LABELS[p]))}.`,
    });
  }

  return { headline, highlights: highlights.slice(0, MAX_HIGHLIGHTS) };
}
