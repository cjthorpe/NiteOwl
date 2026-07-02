// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Activity, ActivityEventType } from '@niteowl/types';

// ---------------------------------------------------------------------------
// Jira webhook payload types (minimal)
// ---------------------------------------------------------------------------

interface JiraCommentPayload {
  webhookEvent: 'comment_created' | 'comment_updated' | 'comment_deleted';
  comment: {
    id: string;
    self: string;
    body: string;
    created: string;
    updated: string;
    author?: { displayName: string; emailAddress: string } | null;
  };
  issue: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      project: { key: string; name: string };
    };
  };
}

interface JiraIssuePayload {
  webhookEvent: string;
  issue: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      description?: string | null;
      status: {
        name: string;
        statusCategory: { key: string };
      };
      issuetype: { name: string };
      project: { key: string; name: string };
      created: string;
      updated: string;
      resolutiondate?: string | null;
      assignee?: { displayName: string; emailAddress: string } | null;
      reporter?: { displayName: string; emailAddress: string } | null;
    };
  };
  user?: { displayName: string; emailAddress: string };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string | null;
      toString: string | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Shared canonical issue shape
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic-within-Jira issue shape. BOTH the webhook path and the REST
 * catch-up poller build one of these and feed it through
 * {@link canonicalJiraIssueToActivity}, guaranteeing they synthesize the SAME
 * `activity_events.external_id` for the same state transition. Divergence here
 * is the GitHub Events-API-vs-repo-scan double-ingest bug class (FUL-98/99);
 * routing both paths through one core is what keeps dedup honest (FUL-123
 * plan, trap #1).
 */
export interface CanonicalJiraIssue {
  id: string;
  key: string;
  /**
   * The webhook event string this state maps to — the tail of the external id.
   * Catch-up chooses `jira:issue_created` for issues created inside the lookback
   * window, else `jira:issue_updated`, so it collides with the webhook rows.
   */
  webhookEvent: string;
  /** Browser URL, e.g. https://acme.atlassian.net/browse/PROJ-42 */
  browseUrl: string;
  summary: string;
  description?: string | null;
  issueType: string;
  projectKey: string;
  projectName: string;
  statusName: string;
  statusCategoryKey: string;
  assignee?: string | null;
  reporter?: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionDate?: string | null;
}

// ---------------------------------------------------------------------------
// Event type resolution
// ---------------------------------------------------------------------------

function resolveJiraIssueEventType(webhookEvent: string): ActivityEventType | null {
  switch (webhookEvent) {
    case 'jira:issue_created':
      return 'issue_opened';
    case 'jira:issue_deleted':
      return 'issue_closed';
    case 'jira:issue_updated':
      // Classify as closed when transitioning to a "done" category.
      return 'issue_updated';
    default:
      return null;
  }
}

function refineJiraUpdateType(
  statusCategoryKey: string,
  base: ActivityEventType,
): ActivityEventType {
  if (base !== 'issue_updated') return base;
  if (statusCategoryKey.toLowerCase() === 'done') return 'issue_closed';
  return 'issue_updated';
}

/**
 * Deterministic external id for an issue event. MUST match the webhook path's
 * `sourceId` so `ON CONFLICT DO NOTHING` dedups webhook + catch-up rows.
 */
export function jiraIssueExternalId(issueId: string, webhookEvent: string): string {
  return `issue:${issueId}:${webhookEvent}`;
}

// ---------------------------------------------------------------------------
// Shared core: canonical issue → Activity
// ---------------------------------------------------------------------------

/**
 * The single source of truth for turning a Jira issue (from any path) into a
 * normalized Activity. Returns null only if the webhook event string is not an
 * issue event we track.
 */
export function canonicalJiraIssueToActivity(
  issue: CanonicalJiraIssue,
  userId: string,
): Activity | null {
  const baseEventType = resolveJiraIssueEventType(issue.webhookEvent);
  if (baseEventType === null) return null;

  const eventType = refineJiraUpdateType(issue.statusCategoryKey, baseEventType);

  const occurredAt =
    eventType === 'issue_closed' && issue.resolutionDate != null
      ? issue.resolutionDate
      : issue.updatedAt;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'jira',
    eventType,
    sourceId: jiraIssueExternalId(issue.id, issue.webhookEvent),
    title: `[${issue.projectKey}] ${issue.key}: ${issue.summary}`,
    ...(issue.description != null ? { description: issue.description } : {}),
    url: issue.browseUrl,
    metadata: {
      issueKey: issue.key,
      issueType: issue.issueType,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      status: issue.statusName,
      statusCategory: issue.statusCategoryKey,
      assignee: issue.assignee ?? null,
      reporter: issue.reporter ?? null,
      webhookEvent: issue.webhookEvent,
    },
    occurredAt,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Webhook → canonical adapters
// ---------------------------------------------------------------------------

function webhookIssueToCanonical(typed: JiraIssuePayload): CanonicalJiraIssue {
  const { issue } = typed;
  const fields = issue.fields;

  // Jira issue URL: derive from self (API URL) → browser URL not in payload,
  // so we reconstruct from the self host + /browse/<key>.
  const selfUrl = new URL(issue.self);
  const browseUrl = `${selfUrl.protocol}//${selfUrl.host}/browse/${issue.key}`;

  return {
    id: issue.id,
    key: issue.key,
    webhookEvent: typed.webhookEvent,
    browseUrl,
    summary: fields.summary,
    description: fields.description ?? null,
    issueType: fields.issuetype.name,
    projectKey: fields.project.key,
    projectName: fields.project.name,
    statusName: fields.status.name,
    statusCategoryKey: fields.status.statusCategory.key,
    assignee: fields.assignee?.displayName ?? null,
    reporter: fields.reporter?.displayName ?? null,
    createdAt: fields.created,
    updatedAt: fields.updated,
    resolutionDate: fields.resolutiondate ?? null,
  };
}

function normalizeJiraComment(typed: JiraCommentPayload, userId: string): Activity | null {
  if (typed.webhookEvent !== 'comment_created') return null;

  const { comment, issue } = typed;

  // Derive the browser URL for the comment from issue.self
  let commentUrl: string;
  try {
    const parsed = new URL(issue.self);
    commentUrl = `${parsed.protocol}//${parsed.host}/browse/${issue.key}?focusedCommentId=${comment.id}`;
  } catch {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'jira',
    eventType: 'comment_created',
    sourceId: `comment:${comment.id}`,
    title: `[${issue.fields.project.key}] Comment on ${issue.key}: ${issue.fields.summary}`,
    description: comment.body,
    url: commentUrl,
    metadata: {
      commentId: comment.id,
      issueKey: issue.key,
      projectKey: issue.fields.project.key,
      projectName: issue.fields.project.name,
      author: comment.author?.displayName ?? null,
      authorEmail: comment.author?.emailAddress ?? null,
    },
    occurredAt: comment.created,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public entry point (webhook path)
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Jira webhook payload into a unified Activity record.
 * Returns null for unrecognised or unactionable event types.
 *
 * Handles:
 *   - webhookEvent: "jira:issue_created" / "jira:issue_updated" / "jira:issue_deleted"
 *   - webhookEvent: "comment_created"
 */
export function normalizeJiraEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  if (typeof payload['webhookEvent'] !== 'string') {
    return null;
  }

  const webhookEvent = payload['webhookEvent'];

  // ── Comment events ────────────────────────────────────────────────────────
  if (
    webhookEvent === 'comment_created' ||
    webhookEvent === 'comment_updated' ||
    webhookEvent === 'comment_deleted'
  ) {
    if (
      payload['comment'] == null ||
      typeof payload['comment'] !== 'object' ||
      payload['issue'] == null ||
      typeof payload['issue'] !== 'object'
    ) {
      return null;
    }
    return normalizeJiraComment(payload as unknown as JiraCommentPayload, userId);
  }

  // ── Issue events ──────────────────────────────────────────────────────────
  if (payload['issue'] == null || typeof payload['issue'] !== 'object') {
    return null;
  }

  const typed = payload as unknown as JiraIssuePayload;
  if (resolveJiraIssueEventType(typed.webhookEvent) === null) return null;

  return canonicalJiraIssueToActivity(webhookIssueToCanonical(typed), userId);
}
