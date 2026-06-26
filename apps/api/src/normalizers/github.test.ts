import { describe, expect, it } from 'vitest';
import { normalizeGitHubEvent } from './github.js';

const USER_ID = 'user-abc-123';

// ---------------------------------------------------------------------------
// Fixtures — derived from GitHub webhook documentation
// ---------------------------------------------------------------------------

const prOpenedPayload = {
  action: 'opened',
  number: 42,
  pull_request: {
    id: 100000001,
    number: 42,
    title: 'Add dark mode support',
    body: 'This PR adds dark mode to the dashboard.',
    html_url: 'https://github.com/acme/app/pull/42',
    state: 'open',
    merged: false,
    merged_at: null,
    created_at: '2024-03-15T10:00:00Z',
    updated_at: '2024-03-15T10:00:00Z',
    user: { login: 'octocat' },
    base: { repo: { full_name: 'acme/app' } },
  },
  repository: { full_name: 'acme/app' },
  sender: { login: 'octocat' },
};

const prMergedPayload = {
  action: 'closed',
  number: 42,
  pull_request: {
    id: 100000001,
    number: 42,
    title: 'Add dark mode support',
    body: null,
    html_url: 'https://github.com/acme/app/pull/42',
    state: 'closed',
    merged: true,
    merged_at: '2024-03-16T09:30:00Z',
    created_at: '2024-03-15T10:00:00Z',
    updated_at: '2024-03-16T09:30:00Z',
    user: { login: 'octocat' },
    base: { repo: { full_name: 'acme/app' } },
  },
  repository: { full_name: 'acme/app' },
  sender: { login: 'reviewer' },
};

const prClosedPayload = {
  action: 'closed',
  number: 43,
  pull_request: {
    id: 100000002,
    number: 43,
    title: 'Experiment branch',
    body: 'Closing without merge.',
    html_url: 'https://github.com/acme/app/pull/43',
    state: 'closed',
    merged: false,
    merged_at: null,
    created_at: '2024-03-14T08:00:00Z',
    updated_at: '2024-03-15T12:00:00Z',
    user: { login: 'developer' },
    base: { repo: { full_name: 'acme/app' } },
  },
  repository: { full_name: 'acme/app' },
  sender: { login: 'developer' },
};

const pushPayload = {
  ref: 'refs/heads/main',
  before: 'aaaaaaa',
  after: 'bbbbbbb',
  commits: [
    {
      id: 'bbbbbbb',
      message: 'fix: resolve login redirect loop',
      url: 'https://github.com/acme/app/commit/bbbbbbb',
      timestamp: '2024-03-16T11:00:00Z',
    },
    {
      id: 'ccccccc',
      message: 'chore: update lockfile',
      url: 'https://github.com/acme/app/commit/ccccccc',
      timestamp: '2024-03-16T11:05:00Z',
    },
  ],
  repository: {
    full_name: 'acme/app',
    html_url: 'https://github.com/acme/app',
  },
  pusher: { name: 'octocat' },
};

const issueOpenedPayload = {
  action: 'opened',
  issue: {
    id: 200000001,
    number: 99,
    title: 'Button alignment broken on mobile',
    body: 'Steps to reproduce: open the app on iOS 17...',
    html_url: 'https://github.com/acme/app/issues/99',
    state: 'open',
    created_at: '2024-03-15T14:00:00Z',
    updated_at: '2024-03-15T14:00:00Z',
    closed_at: null,
    user: { login: 'reporter' },
  },
  repository: { full_name: 'acme/app' },
  sender: { login: 'reporter' },
};

const issueClosedPayload = {
  action: 'closed',
  issue: {
    id: 200000001,
    number: 99,
    title: 'Button alignment broken on mobile',
    body: null,
    html_url: 'https://github.com/acme/app/issues/99',
    state: 'closed',
    created_at: '2024-03-15T14:00:00Z',
    updated_at: '2024-03-17T10:00:00Z',
    closed_at: '2024-03-17T10:00:00Z',
    user: { login: 'reporter' },
  },
  repository: { full_name: 'acme/app' },
  sender: { login: 'maintainer' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeGitHubEvent — pull_request', () => {
  it('normalizes a pr_opened event', () => {
    const result = normalizeGitHubEvent(prOpenedPayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('github');
    expect(result?.eventType).toBe('pr_opened');
    expect(result?.userId).toBe(USER_ID);
    expect(result?.title).toBe('[acme/app] PR #42: Add dark mode support');
    expect(result?.description).toBe('This PR adds dark mode to the dashboard.');
    expect(result?.url).toBe('https://github.com/acme/app/pull/42');
    expect(result?.sourceId).toBe('pr:100000001:opened');
    expect(result?.occurredAt).toBe('2024-03-15T10:00:00Z');
    expect(result?.metadata).toMatchObject({ repo: 'acme/app', author: 'octocat' });
  });

  it('normalizes a pr_merged event', () => {
    const result = normalizeGitHubEvent(prMergedPayload, USER_ID);

    expect(result?.eventType).toBe('pr_merged');
    expect(result?.occurredAt).toBe('2024-03-16T09:30:00Z');
    expect(result?.description).toBeUndefined();
  });

  it('normalizes a pr_closed (not merged) event', () => {
    const result = normalizeGitHubEvent(prClosedPayload, USER_ID);

    expect(result?.eventType).toBe('pr_closed');
  });

  it('returns null for an unrecognised PR action', () => {
    const result = normalizeGitHubEvent(
      { ...prOpenedPayload, action: 'review_requested' },
      USER_ID,
    );
    expect(result).toBeNull();
  });

  // Regression (FUL-88): the GitHub Events API (catchup path) can return a
  // pull_request with a missing/null `user` (ghost / deleted author) and no
  // `base`/`sender`. This previously threw
  // "Cannot read properties of undefined (reading 'login')" and aborted the
  // whole catchup run.
  it('does not throw when pull_request.user is undefined', () => {
    const { user: _user, base: _base, ...prWithoutUser } = prOpenedPayload.pull_request;
    const payload = { ...prOpenedPayload, pull_request: prWithoutUser, sender: undefined };

    let result;
    expect(() => {
      result = normalizeGitHubEvent(payload, USER_ID);
    }).not.toThrow();

    expect(result?.eventType).toBe('pr_opened');
    expect(result?.metadata).toMatchObject({ author: null, sender: null, baseBranch: null });
  });

  it('does not throw when pull_request.user is null', () => {
    const payload = {
      ...prMergedPayload,
      pull_request: { ...prMergedPayload.pull_request, user: null },
    };

    let result;
    expect(() => {
      result = normalizeGitHubEvent(payload, USER_ID);
    }).not.toThrow();

    expect(result?.eventType).toBe('pr_merged');
    expect(result?.metadata).toMatchObject({ author: null });
  });
});

describe('normalizeGitHubEvent — push', () => {
  it('normalizes a commit_pushed event', () => {
    const result = normalizeGitHubEvent(pushPayload, USER_ID);

    expect(result?.provider).toBe('github');
    expect(result?.eventType).toBe('commit_pushed');
    expect(result?.title).toBe('[acme/app] 2 commits pushed to main');
    expect(result?.sourceId).toBe('push:bbbbbbb');
    expect(result?.url).toBe('https://github.com/acme/app/commit/bbbbbbb');
    expect(result?.metadata).toMatchObject({ branch: 'main', commitCount: 2 });
    expect(result?.occurredAt).toBe('2024-03-16T11:00:00Z');
  });

  it('returns null for an empty commits array', () => {
    const result = normalizeGitHubEvent({ ...pushPayload, commits: [] }, USER_ID);
    expect(result).toBeNull();
  });

  it('does not throw when pusher is missing', () => {
    const { pusher: _pusher, ...pushWithoutPusher } = pushPayload;

    let result;
    expect(() => {
      result = normalizeGitHubEvent(pushWithoutPusher, USER_ID);
    }).not.toThrow();

    expect(result?.eventType).toBe('commit_pushed');
    expect(result?.metadata).toMatchObject({ pusher: null });
  });
});

describe('normalizeGitHubEvent — issues', () => {
  it('normalizes an issue_opened event', () => {
    const result = normalizeGitHubEvent(issueOpenedPayload, USER_ID);

    expect(result?.eventType).toBe('issue_opened');
    expect(result?.title).toBe('[acme/app] Issue #99: Button alignment broken on mobile');
    expect(result?.sourceId).toBe('issue:200000001:opened');
    expect(result?.occurredAt).toBe('2024-03-15T14:00:00Z');
  });

  it('normalizes an issue_closed event', () => {
    const result = normalizeGitHubEvent(issueClosedPayload, USER_ID);

    expect(result?.eventType).toBe('issue_closed');
    expect(result?.occurredAt).toBe('2024-03-17T10:00:00Z');
  });

  it('returns null for unrecognised issue actions', () => {
    const result = normalizeGitHubEvent({ ...issueOpenedPayload, action: 'milestoned' }, USER_ID);
    expect(result).toBeNull();
  });

  it('does not throw when issue.user is missing', () => {
    const { user: _user, ...issueWithoutUser } = issueOpenedPayload.issue;
    const payload = { ...issueOpenedPayload, issue: issueWithoutUser, sender: undefined };

    let result;
    expect(() => {
      result = normalizeGitHubEvent(payload, USER_ID);
    }).not.toThrow();

    expect(result?.eventType).toBe('issue_opened');
    expect(result?.metadata).toMatchObject({ author: null, sender: null });
  });
});

describe('normalizeGitHubEvent — unknown payload shape', () => {
  it('returns null for a completely unknown payload', () => {
    expect(normalizeGitHubEvent({}, USER_ID)).toBeNull();
    expect(normalizeGitHubEvent({ type: 'create' }, USER_ID)).toBeNull();
    expect(normalizeGitHubEvent({ deployment: {} }, USER_ID)).toBeNull();
  });
});

describe('normalizeGitHubEvent — determinism', () => {
  it('produces the same output for the same input (except id and ingestedAt)', () => {
    const a = normalizeGitHubEvent(prOpenedPayload, USER_ID);
    const b = normalizeGitHubEvent(prOpenedPayload, USER_ID);

    // id is random UUID, ingestedAt is current time — exclude those
    const { id: _idA, ingestedAt: _ia, ...restA } = a!;
    const { id: _idB, ingestedAt: _ib, ...restB } = b!;

    expect(restA).toEqual(restB);
  });
});
