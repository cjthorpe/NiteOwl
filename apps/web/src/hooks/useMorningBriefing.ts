// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Activity } from '@niteowl/types';
import { useQuery } from '@tanstack/react-query';

import { buildBriefingDigest, type BriefingDigest } from '../lib/briefing-digest';
import { fetchServerBriefingDigest } from '../lib/briefing';
import { fetchBriefingItems } from '../lib/feed';

export interface AgentGroup {
  login: string;
  items: Activity[];
  prsOpened: number;
  prsMerged: number;
  issuesClosed: number;
  commitsPushed: number;
  /** PRs that are still open (not merged/closed) — need review */
  unreviewedPrs: Activity[];
}

export interface BriefingSummary {
  totalPrsMerged: number;
  totalIssuesClosed: number;
  totalCommitsPushed: number;
  totalPrsOpened: number;
}

export interface MorningBriefingData {
  agentGroups: AgentGroup[];
  summary: BriefingSummary;
  totalItems: number;
  /**
   * "What changed and why it matters" digest. Prefers the server digest (which
   * may be an LLM rewrite, FUL-136) and falls back to the local heuristic
   * (FUL-122) whenever the endpoint or LLM is unavailable.
   */
  digest: BriefingDigest;
  /** Which path produced {@link digest}: the server ('llm'/'heuristic') or local fallback. */
  digestSource: 'llm' | 'heuristic' | 'local';
}

function groupByAgent(items: Activity[]): AgentGroup[] {
  const map = new Map<string, Activity[]>();

  for (const item of items) {
    const login = item.authorLogin ?? '(unknown)';
    const existing = map.get(login);
    if (existing) {
      existing.push(item);
    } else {
      map.set(login, [item]);
    }
  }

  return Array.from(map.entries())
    .map(([login, groupItems]) => {
      const prsOpened = groupItems.filter((i) => i.eventType === 'pr_opened').length;
      const prsMerged = groupItems.filter((i) => i.eventType === 'pr_merged').length;
      const issuesClosed = groupItems.filter((i) => i.eventType === 'issue_closed').length;
      const commitsPushed = groupItems.filter((i) => i.eventType === 'commit_pushed').length;
      const unreviewedPrs = groupItems.filter((i) => i.eventType === 'pr_opened');

      return {
        login,
        items: groupItems,
        prsOpened,
        prsMerged,
        issuesClosed,
        commitsPushed,
        unreviewedPrs,
      };
    })
    .sort((a, b) => b.items.length - a.items.length);
}

function computeSummary(groups: AgentGroup[]): BriefingSummary {
  return {
    totalPrsMerged: groups.reduce((acc, g) => acc + g.prsMerged, 0),
    totalIssuesClosed: groups.reduce((acc, g) => acc + g.issuesClosed, 0),
    totalCommitsPushed: groups.reduce((acc, g) => acc + g.commitsPushed, 0),
    totalPrsOpened: groups.reduce((acc, g) => acc + g.prsOpened, 0),
  };
}

export function useMorningBriefing() {
  return useQuery({
    queryKey: ['morning-briefing'],
    queryFn: async (): Promise<MorningBriefingData> => {
      // Fetch the feed (needed for the grouped UI) and the optional server digest
      // in parallel — the server computes its own window, so there's no waterfall.
      const [items, serverDigest] = await Promise.all([
        fetchBriefingItems({ since: 'last_login' }),
        fetchServerBriefingDigest(),
      ]);
      const agentGroups = groupByAgent(items);
      const summary = computeSummary(agentGroups);
      const totalItems = items.length;

      // Prefer the server digest; fall back to the local heuristic so the digest
      // always renders even when the endpoint or LLM is unavailable.
      const localDigest = buildBriefingDigest({ agentGroups, summary, totalItems });
      const digest: BriefingDigest = serverDigest
        ? { headline: serverDigest.headline, highlights: serverDigest.highlights }
        : localDigest;
      const digestSource = serverDigest ? serverDigest.source : 'local';

      return { agentGroups, summary, totalItems, digest, digestSource };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
