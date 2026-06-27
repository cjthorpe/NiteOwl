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
  payload: JiraIssuePayload,
  base: ActivityEventType,
): ActivityEventType {
  if (base !== 'issue_updated') return base;
  const statusCategoryKey = payload.issue.fields.status.statusCategory.key.toLowerCase();
  if (statusCategoryKey === 'done') return 'issue_closed';
  return 'issue_updated';
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Comment normalizer
// ---------------------------------------------------------------------------

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
// Public entry point
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
  const baseEventType = resolveJiraIssueEventType(typed.webhookEvent);
  if (baseEventType === null) return null;

  const eventType = refineJiraUpdateType(typed, baseEventType);
  const { issue } = typed;
  const fields = issue.fields;

  const occurredAt =
    eventType === 'issue_closed' && fields.resolutiondate != null
      ? fields.resolutiondate
      : fields.updated;

  // Jira issue URL: derive from self (API URL) → browser URL not in payload,
  // so we reconstruct from the self host + /browse/<key>.
  const selfUrl = new URL(issue.self);
  const browseUrl = `${selfUrl.protocol}//${selfUrl.host}/browse/${issue.key}`;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: 'jira',
    eventType,
    sourceId: `issue:${issue.id}:${typed.webhookEvent}`,
    title: `[${fields.project.key}] ${issue.key}: ${fields.summary}`,
    ...(fields.description != null ? { description: fields.description } : {}),
    url: browseUrl,
    metadata: {
      issueKey: issue.key,
      issueType: fields.issuetype.name,
      projectKey: fields.project.key,
      projectName: fields.project.name,
      status: fields.status.name,
      statusCategory: fields.status.statusCategory.key,
      assignee: fields.assignee?.displayName ?? null,
      reporter: fields.reporter?.displayName ?? null,
      webhookEvent: typed.webhookEvent,
    },
    occurredAt,
    ingestedAt: new Date().toISOString(),
  };
}
