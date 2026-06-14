import type { Activity, ActivityEventType } from '@niteowl/types';

// ---------------------------------------------------------------------------
// GitHub webhook payload types (minimal — only what we need for normalisation)
// ---------------------------------------------------------------------------

interface GitHubPullRequestPayload {
  action: string;
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    merged: boolean;
    merged_at: string | null;
    created_at: string;
    updated_at: string;
    state: string;
    user: { login: string };
    base: { ref: string; repo: { full_name: string } };
  };
  repository: { full_name: string };
  sender: { login: string };
}

interface GitHubPushPayload {
  ref: string;
  after: string;
  before: string;
  commits: Array<{
    id: string;
    message: string;
    url: string;
    timestamp: string;
  }>;
  repository: { full_name: string; html_url: string };
  pusher: { name: string };
}

interface GitHubIssuePayload {
  action: string;
  issue: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    user: { login: string };
  };
  repository: { full_name: string };
  sender: { login: string };
}

// ---------------------------------------------------------------------------
// Event type resolution
// ---------------------------------------------------------------------------

function resolvePrEventType(action: string, merged: boolean): ActivityEventType | null {
  if (action === 'opened') return 'pr_opened';
  if (action === 'closed') return merged ? 'pr_merged' : 'pr_closed';
  return null;
}

function resolveIssueEventType(action: string): ActivityEventType | null {
  if (action === 'opened') return 'issue_opened';
  if (action === 'closed') return 'issue_closed';
  if (action === 'edited' || action === 'labeled' || action === 'assigned') return 'issue_updated';
  return null;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizePullRequest(payload: GitHubPullRequestPayload, userId: string): Activity | null {
  const { action, pull_request: pr } = payload;
  const eventType = resolvePrEventType(action, pr.merged);
  if (eventType === null) return null;

  const occurredAt =
    eventType === 'pr_merged' && pr.merged_at != null ? pr.merged_at : pr.updated_at;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType,
    sourceId: `pr:${pr.id}:${action}`,
    title: `[${payload.repository.full_name}] PR #${pr.number}: ${pr.title}`,
    ...(pr.body != null ? { description: pr.body } : {}),
    url: pr.html_url,
    metadata: {
      prNumber: pr.number,
      repo: payload.repository.full_name,
      author: pr.user.login,
      sender: payload.sender.login,
      state: pr.state,
      baseBranch: pr.base.ref,
    },
    occurredAt,
    ingestedAt: new Date().toISOString(),
  };
}

function normalizePush(payload: GitHubPushPayload, userId: string): Activity | null {
  const { commits } = payload;
  if (commits.length === 0) return null;

  const firstCommit = commits[0]!;
  const count = commits.length;
  const branch = payload.ref.replace('refs/heads/', '');

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType: 'commit_pushed',
    sourceId: `push:${payload.after}`,
    title: `[${payload.repository.full_name}] ${count} commit${count > 1 ? 's' : ''} pushed to ${branch}`,
    description: firstCommit.message,
    url: `${payload.repository.html_url}/commit/${payload.after}`,
    metadata: {
      ref: payload.ref,
      branch,
      commitCount: count,
      headSha: payload.after,
      repo: payload.repository.full_name,
      pusher: payload.pusher.name,
    },
    occurredAt: firstCommit.timestamp,
    ingestedAt: new Date().toISOString(),
  };
}

function normalizeIssue(payload: GitHubIssuePayload, userId: string): Activity | null {
  const { action, issue } = payload;
  const eventType = resolveIssueEventType(action);
  if (eventType === null) return null;

  const occurredAt =
    eventType === 'issue_closed' && issue.closed_at != null ? issue.closed_at : issue.updated_at;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType,
    sourceId: `issue:${issue.id}:${action}`,
    title: `[${payload.repository.full_name}] Issue #${issue.number}: ${issue.title}`,
    ...(issue.body != null ? { description: issue.body } : {}),
    url: issue.html_url,
    metadata: {
      issueNumber: issue.number,
      repo: payload.repository.full_name,
      author: issue.user.login,
      sender: payload.sender.login,
      state: issue.state,
    },
    occurredAt,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw GitHub webhook payload into a unified Activity record.
 * Returns null for unrecognised or unactionable event types — callers should
 * log and skip nulls rather than treating them as errors.
 */
export function normalizeGitHubEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  // Detect event type by shape of the payload.
  if ('pull_request' in payload) {
    return normalizePullRequest(payload as unknown as GitHubPullRequestPayload, userId);
  }

  if ('commits' in payload && 'ref' in payload) {
    return normalizePush(payload as unknown as GitHubPushPayload, userId);
  }

  if ('issue' in payload) {
    return normalizeIssue(payload as unknown as GitHubIssuePayload, userId);
  }

  return null;
}
