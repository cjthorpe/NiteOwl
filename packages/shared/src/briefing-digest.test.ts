// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import {
  buildBriefingDigest,
  resolveAuthorLogin,
  UNKNOWN_AUTHOR_LOGIN,
  type BriefingDigestInput,
} from './briefing-digest';

/** Minimal builder for the structural digest input used across these tests. */
function input(overrides: Partial<BriefingDigestInput> = {}): BriefingDigestInput {
  return {
    agentGroups: [],
    summary: {
      totalPrsMerged: 0,
      totalIssuesClosed: 0,
      totalCommitsPushed: 0,
      totalPrsOpened: 0,
    },
    totalItems: 0,
    ...overrides,
  };
}

function group(
  login: string,
  counts: {
    prsOpened?: number;
    prsMerged?: number;
    issuesClosed?: number;
    commitsPushed?: number;
    items?: BriefingDigestInput['agentGroups'][number]['items'];
  } = {},
) {
  return {
    login,
    items: counts.items ?? [],
    prsOpened: counts.prsOpened ?? 0,
    prsMerged: counts.prsMerged ?? 0,
    issuesClosed: counts.issuesClosed ?? 0,
    commitsPushed: counts.commitsPushed ?? 0,
  };
}

describe('buildBriefingDigest', () => {
  it('reports a quiet headline and no highlights when nothing changed', () => {
    const digest = buildBriefingDigest(input());
    expect(digest.headline).toMatch(/quiet/i);
    expect(digest.highlights).toHaveLength(0);
  });

  it('summarises volume and contributor count in the headline', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 12,
        agentGroups: [group('alice'), group('bob'), group('carol')],
      }),
    );
    expect(digest.headline).toContain('12 updates');
    expect(digest.headline).toContain('3 agents');
  });

  it('singularises a lone update from a single agent', () => {
    const digest = buildBriefingDigest(input({ totalItems: 1, agentGroups: [group('alice')] }));
    expect(digest.headline).toContain('1 update ');
    expect(digest.headline).toContain('1 agent ');
  });

  it('surfaces unreviewed PRs first as an emphasised, actionable highlight', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 4,
        summary: {
          totalPrsMerged: 0,
          totalIssuesClosed: 0,
          totalCommitsPushed: 0,
          totalPrsOpened: 3,
        },
        agentGroups: [group('alice', { prsOpened: 2 }), group('bob', { prsOpened: 1 })],
      }),
    );
    const first = digest.highlights[0];
    expect(first).toBeDefined();
    expect(first?.kind).toBe('needs_review');
    expect(first?.emphasis).toBe(true);
    expect(first?.text).toMatch(/3 .*review/i);
    expect(first?.text).toContain('alice');
  });

  it('reports merges and names the top merger', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 5,
        summary: {
          totalPrsMerged: 4,
          totalIssuesClosed: 0,
          totalCommitsPushed: 0,
          totalPrsOpened: 0,
        },
        agentGroups: [group('alice', { prsMerged: 3 }), group('bob', { prsMerged: 1 })],
      }),
    );
    const merged = digest.highlights.find((h) => h.kind === 'merged');
    expect(merged?.text).toContain('4');
    expect(merged?.text).toContain('alice');
  });

  it('identifies the busiest agent as the top mover', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 6,
        agentGroups: [
          group('alice', { items: [{ provider: 'github', eventType: 'commit_pushed' }] }),
          group('bob', {
            items: [
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'pr_merged' },
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
            ],
          }),
        ],
      }),
    );
    const mover = digest.highlights.find((h) => h.kind === 'top_mover');
    expect(mover?.text).toContain('bob');
    expect(mover?.text).toContain('5');
  });

  it('notes when activity spans multiple providers', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 2,
        agentGroups: [
          group('alice', {
            items: [
              { provider: 'github', eventType: 'pr_opened' },
              { provider: 'linear', eventType: 'issue_closed' },
            ],
          }),
        ],
      }),
    );
    const providers = digest.highlights.find((h) => h.kind === 'providers');
    expect(providers?.text).toContain('GitHub');
    expect(providers?.text).toContain('Linear');
  });

  it('omits attribution when the top contributor is the unknown sentinel (FUL-139)', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 5,
        summary: {
          totalPrsMerged: 4,
          totalIssuesClosed: 0,
          totalCommitsPushed: 0,
          totalPrsOpened: 0,
        },
        agentGroups: [group(UNKNOWN_AUTHOR_LOGIN, { prsMerged: 4 })],
      }),
    );
    const merged = digest.highlights.find((h) => h.kind === 'merged');
    expect(merged?.text).toContain('4');
    expect(merged?.text).not.toContain('led by');
    expect(merged?.text).not.toContain('unknown');
  });

  it('does not surface the unknown bucket as the busiest top mover (FUL-139)', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 6,
        agentGroups: [
          group(UNKNOWN_AUTHOR_LOGIN, {
            items: [
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
            ],
          }),
          group('alice', {
            items: [
              { provider: 'github', eventType: 'commit_pushed' },
              { provider: 'github', eventType: 'commit_pushed' },
            ],
          }),
        ],
      }),
    );
    expect(digest.highlights.find((h) => h.kind === 'top_mover')).toBeUndefined();
  });

  it('caps the number of highlights to keep the digest scannable', () => {
    const digest = buildBriefingDigest(
      input({
        totalItems: 20,
        summary: {
          totalPrsMerged: 5,
          totalIssuesClosed: 4,
          totalCommitsPushed: 8,
          totalPrsOpened: 3,
        },
        agentGroups: [
          group('alice', {
            prsOpened: 3,
            prsMerged: 5,
            issuesClosed: 4,
            commitsPushed: 8,
            items: [
              { provider: 'github', eventType: 'pr_merged' },
              { provider: 'linear', eventType: 'issue_closed' },
              { provider: 'jira', eventType: 'issue_updated' },
            ],
          }),
          group('bob'),
        ],
      }),
    );
    expect(digest.highlights.length).toBeLessThanOrEqual(5);
    // The actionable review highlight must never be dropped by the cap.
    expect(digest.highlights[0]?.kind).toBe('needs_review');
  });
});

describe('resolveAuthorLogin', () => {
  it('prefers a non-empty authorLogin column', () => {
    expect(resolveAuthorLogin('octocat', { author: 'someone-else' })).toBe('octocat');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveAuthorLogin('  octocat  ')).toBe('octocat');
  });

  it('falls back to metadata.author when the column is null (repo-scan rows, FUL-139)', () => {
    expect(resolveAuthorLogin(null, { author: 'Ada Lovelace' })).toBe('Ada Lovelace');
  });

  it('honours the actor-field priority order', () => {
    expect(resolveAuthorLogin(undefined, { pusher: 'p', sender: 's', author: 'a' })).toBe('a');
    expect(resolveAuthorLogin(undefined, { pusher: 'p', sender: 's' })).toBe('s');
    expect(resolveAuthorLogin(undefined, { pusher: 'p' })).toBe('p');
  });

  it('ignores blank and non-string candidates', () => {
    expect(
      resolveAuthorLogin('   ', { author: '   ', sender: 42 as unknown as string }),
    ).toBeNull();
  });

  it('returns null when no actor is recoverable', () => {
    expect(resolveAuthorLogin(null, {})).toBeNull();
    expect(resolveAuthorLogin(null, null)).toBeNull();
    expect(resolveAuthorLogin(undefined)).toBeNull();
  });
});
