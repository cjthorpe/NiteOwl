// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { BriefingDigestInput, DigestAgentGroup } from '@niteowl/shared/briefing-digest';
import { resolveAuthorLogin, UNKNOWN_AUTHOR_LOGIN } from '@niteowl/shared/briefing-digest';
import type { ActivityEventType, ActivityProvider } from '@niteowl/types';

/**
 * Server-side construction of the structured {@link BriefingDigestInput}.
 *
 * This mirrors the web hook's `groupByAgent` / `computeSummary` so the API
 * (`GET /api/briefing/digest`, FUL-136) feeds the LLM — and the heuristic
 * fallback — exactly the same shape the client would compute locally. Keeping
 * the two in lock-step is what makes the heuristic a true drop-in fallback with
 * no visible regression when the LLM is off.
 *
 * Pure: it takes already-fetched rows and returns a new object. No I/O.
 */

/** The minimal activity-row fields the digest input is built from. */
export interface BriefingActivityRow {
  provider: ActivityProvider;
  eventType: ActivityEventType;
  authorLogin: string | null;
  /**
   * Provider-specific payload. Used to recover the actor name for rows whose
   * `authorLogin` column was never populated (e.g. repo-scan ingestion, FUL-139).
   */
  metadata?: Record<string, unknown> | null;
}

function countEvent(rows: ReadonlyArray<BriefingActivityRow>, type: ActivityEventType): number {
  return rows.reduce((acc, r) => (r.eventType === type ? acc + 1 : acc), 0);
}

/**
 * Group rows by author and tally the per-agent and summary counters the digest
 * reasons about. Groups are returned busiest-first to match the web ordering.
 */
export function buildBriefingDigestInput(
  rows: ReadonlyArray<BriefingActivityRow>,
): BriefingDigestInput {
  const byLogin = new Map<string, BriefingActivityRow[]>();
  for (const row of rows) {
    const login = resolveAuthorLogin(row.authorLogin, row.metadata) ?? UNKNOWN_AUTHOR_LOGIN;
    const existing = byLogin.get(login);
    if (existing) {
      existing.push(row);
    } else {
      byLogin.set(login, [row]);
    }
  }

  const agentGroups: DigestAgentGroup[] = Array.from(byLogin.entries())
    .map(([login, groupRows]) => ({
      login,
      items: groupRows.map((r) => ({ provider: r.provider, eventType: r.eventType })),
      prsOpened: countEvent(groupRows, 'pr_opened'),
      prsMerged: countEvent(groupRows, 'pr_merged'),
      issuesClosed: countEvent(groupRows, 'issue_closed'),
      commitsPushed: countEvent(groupRows, 'commit_pushed'),
    }))
    .sort((a, b) => b.items.length - a.items.length);

  const summary = {
    totalPrsMerged: agentGroups.reduce((acc, g) => acc + g.prsMerged, 0),
    totalIssuesClosed: agentGroups.reduce((acc, g) => acc + g.issuesClosed, 0),
    totalCommitsPushed: agentGroups.reduce((acc, g) => acc + g.commitsPushed, 0),
    totalPrsOpened: agentGroups.reduce((acc, g) => acc + g.prsOpened, 0),
  };

  return { agentGroups, summary, totalItems: rows.length };
}
