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
    // Optional: the GitHub Events API (catchup) can omit `user` for ghost /
    // deleted authors, and `base` is not present on every event subtype.
    user?: { login: string } | null;
    base?: { ref: string; repo: { full_name: string } } | null;
  };
  // The Events API (catchup) can omit `repository` for malformed / repo-less
  // events; guard reads with a fallback rather than dereferencing blindly.
  repository?: { full_name: string } | null;
  sender?: { login: string } | null;
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
  repository?: { full_name: string; html_url: string } | null;
  pusher?: { name: string } | null;
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
    user?: { login: string } | null;
  };
  repository?: { full_name: string } | null;
  sender?: { login: string } | null;
}

// ---------------------------------------------------------------------------
// Event type resolution
// ---------------------------------------------------------------------------

/** Fallback repo slug when an Events API item omits `repository`. */
const UNKNOWN_REPO = 'unknown/unknown';

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

  const repoName = payload.repository?.full_name ?? UNKNOWN_REPO;
  const occurredAt =
    eventType === 'pr_merged' && pr.merged_at != null ? pr.merged_at : pr.updated_at;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType,
    sourceId: `pr:${pr.id}:${action}`,
    title: `[${repoName}] PR #${pr.number}: ${pr.title}`,
    ...(pr.body != null ? { description: pr.body } : {}),
    url: pr.html_url,
    metadata: {
      prNumber: pr.number,
      repo: repoName,
      author: pr.user?.login ?? null,
      sender: payload.sender?.login ?? null,
      state: pr.state,
      baseBranch: pr.base?.ref ?? null,
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
  const repoName = payload.repository?.full_name ?? UNKNOWN_REPO;
  const repoUrl = payload.repository?.html_url ?? `https://github.com/${repoName}`;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType: 'commit_pushed',
    sourceId: `push:${payload.after}`,
    title: `[${repoName}] ${count} commit${count > 1 ? 's' : ''} pushed to ${branch}`,
    description: firstCommit.message,
    url: `${repoUrl}/commit/${payload.after}`,
    metadata: {
      ref: payload.ref,
      branch,
      commitCount: count,
      headSha: payload.after,
      repo: repoName,
      pusher: payload.pusher?.name ?? null,
    },
    occurredAt: firstCommit.timestamp,
    ingestedAt: new Date().toISOString(),
  };
}

function normalizeIssue(payload: GitHubIssuePayload, userId: string): Activity | null {
  const { action, issue } = payload;
  const eventType = resolveIssueEventType(action);
  if (eventType === null) return null;

  const repoName = payload.repository?.full_name ?? UNKNOWN_REPO;
  const occurredAt =
    eventType === 'issue_closed' && issue.closed_at != null ? issue.closed_at : issue.updated_at;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'github',
    eventType,
    sourceId: `issue:${issue.id}:${action}`,
    title: `[${repoName}] Issue #${issue.number}: ${issue.title}`,
    ...(issue.body != null ? { description: issue.body } : {}),
    url: issue.html_url,
    metadata: {
      issueNumber: issue.number,
      repo: repoName,
      author: issue.user?.login ?? null,
      sender: payload.sender?.login ?? null,
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
