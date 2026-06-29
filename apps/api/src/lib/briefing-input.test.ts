// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import { buildBriefingDigestInput, type BriefingActivityRow } from './briefing-input.js';

function row(
  authorLogin: string | null,
  eventType: BriefingActivityRow['eventType'],
  provider: BriefingActivityRow['provider'] = 'github',
  metadata?: Record<string, unknown> | null,
): BriefingActivityRow {
  return { authorLogin, eventType, provider, metadata };
}

describe('buildBriefingDigestInput', () => {
  it('returns an empty input for no rows', () => {
    const input = buildBriefingDigestInput([]);
    expect(input.totalItems).toBe(0);
    expect(input.agentGroups).toHaveLength(0);
    expect(input.summary).toEqual({
      totalPrsMerged: 0,
      totalIssuesClosed: 0,
      totalCommitsPushed: 0,
      totalPrsOpened: 0,
    });
  });

  it('groups rows by author and tallies per-agent counters', () => {
    const input = buildBriefingDigestInput([
      row('alice', 'pr_opened'),
      row('alice', 'pr_merged'),
      row('alice', 'commit_pushed'),
      row('bob', 'issue_closed'),
    ]);
    expect(input.totalItems).toBe(4);
    const alice = input.agentGroups.find((g) => g.login === 'alice');
    expect(alice).toMatchObject({ prsOpened: 1, prsMerged: 1, commitsPushed: 1, issuesClosed: 0 });
    expect(alice?.items).toHaveLength(3);
    const bob = input.agentGroups.find((g) => g.login === 'bob');
    expect(bob).toMatchObject({ issuesClosed: 1 });
  });

  it('aggregates the cross-agent summary totals', () => {
    const input = buildBriefingDigestInput([
      row('alice', 'pr_merged'),
      row('bob', 'pr_merged'),
      row('bob', 'pr_opened'),
      row('carol', 'issue_closed'),
      row('carol', 'commit_pushed'),
    ]);
    expect(input.summary).toEqual({
      totalPrsMerged: 2,
      totalIssuesClosed: 1,
      totalCommitsPushed: 1,
      totalPrsOpened: 1,
    });
  });

  it('orders groups busiest-first', () => {
    const input = buildBriefingDigestInput([
      row('quiet', 'commit_pushed'),
      row('busy', 'commit_pushed'),
      row('busy', 'commit_pushed'),
      row('busy', 'pr_opened'),
    ]);
    expect(input.agentGroups[0]?.login).toBe('busy');
    expect(input.agentGroups[1]?.login).toBe('quiet');
  });

  it('buckets null author logins under a single unknown group', () => {
    const input = buildBriefingDigestInput([row(null, 'commit_pushed'), row(null, 'pr_opened')]);
    expect(input.agentGroups).toHaveLength(1);
    expect(input.agentGroups[0]?.login).toBe('(unknown)');
    expect(input.agentGroups[0]?.items).toHaveLength(2);
  });

  it('recovers the actor name from metadata when author_login is null (FUL-139)', () => {
    // Repo-scan rows leave `author_login` null but carry the name in metadata.
    const input = buildBriefingDigestInput([
      row(null, 'commit_pushed', 'github', { author: 'ada' }),
      row(null, 'pr_merged', 'github', { author: 'ada' }),
      row(null, 'pr_opened', 'github', { author: 'grace' }),
    ]);
    expect(input.agentGroups.find((g) => g.login === '(unknown)')).toBeUndefined();
    expect(input.agentGroups.find((g) => g.login === 'ada')?.items).toHaveLength(2);
    expect(input.agentGroups.find((g) => g.login === 'grace')?.prsOpened).toBe(1);
  });
});
