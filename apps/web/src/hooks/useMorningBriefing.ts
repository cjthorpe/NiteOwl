import { useQuery } from '@tanstack/react-query';
import { fetchBriefingItems } from '../lib/feed';
import type { Activity } from '@niteowl/types';

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
      const items = await fetchBriefingItems({ since: 'last_login' });
      const agentGroups = groupByAgent(items);
      const summary = computeSummary(agentGroups);
      return { agentGroups, summary, totalItems: items.length };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
