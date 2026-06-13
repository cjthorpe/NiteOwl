import type { Activity, ActivityEventType } from "@niteowl/types";

// ---------------------------------------------------------------------------
// Linear webhook payload types (minimal)
// ---------------------------------------------------------------------------

interface LinearIssuePayload {
  action: string;
  type: "Issue";
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    url: string;
    state: { name: string; type: string };
    team: { name: string; key: string };
    createdAt: string;
    updatedAt: string;
    completedAt?: string | null;
    canceledAt?: string | null;
    assignee?: { name: string; email: string } | null;
    creator?: { name: string; email: string } | null;
  };
  organizationId: string;
}

interface LinearCommentPayload {
  action: string;
  type: "Comment";
  data: {
    id: string;
    body: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    issue: {
      id: string;
      identifier: string;
      title: string;
      team: { name: string; key: string };
    };
    user?: { id: string; name: string; email: string } | null;
  };
  organizationId: string;
}

// ---------------------------------------------------------------------------
// Event type resolution
// ---------------------------------------------------------------------------

function resolveLinearIssueEventType(
  action: string,
  stateType: string,
): ActivityEventType | null {
  if (action === "create") return "issue_opened";
  if (action === "remove") return "issue_closed";
  if (action === "update") {
    if (stateType === "completed" || stateType === "cancelled")
      return "issue_closed";
    return "issue_updated";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Issue normalizer
// ---------------------------------------------------------------------------

function normalizeIssue(
  typed: LinearIssuePayload,
  userId: string,
): Activity | null {
  const { action, data } = typed;
  const stateType = data.state.type;
  const eventType = resolveLinearIssueEventType(action, stateType);
  if (eventType === null) return null;

  const occurredAt =
    eventType === "issue_closed"
      ? (data.completedAt ?? data.canceledAt ?? data.updatedAt)
      : data.updatedAt;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: "linear",
    eventType,
    sourceId: `issue:${data.id}:${action}`,
    title: `[${data.team.key}] ${data.identifier}: ${data.title}`,
    ...(data.description != null ? { description: data.description } : {}),
    url: data.url,
    metadata: {
      identifier: data.identifier,
      teamKey: data.team.key,
      teamName: data.team.name,
      state: data.state.name,
      stateType,
      assignee: data.assignee?.name ?? null,
      creator: data.creator?.name ?? null,
      organizationId: typed.organizationId,
    },
    occurredAt,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Comment normalizer
// ---------------------------------------------------------------------------

function normalizeComment(
  typed: LinearCommentPayload,
  userId: string,
): Activity | null {
  if (typed.action !== "create") return null;

  const { data } = typed;
  const { issue } = data;

  // Guard: issue metadata is required to build a meaningful title
  if (issue == null || issue.team == null) return null;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: "linear",
    eventType: "comment_created",
    sourceId: `comment:${data.id}`,
    title: `[${issue.team.key}] Comment on ${issue.identifier}: ${issue.title}`,
    description: data.body,
    url: data.url,
    metadata: {
      commentId: data.id,
      issueId: issue.id,
      identifier: issue.identifier,
      teamKey: issue.team.key,
      teamName: issue.team.name,
      author: data.user?.name ?? null,
      authorEmail: data.user?.email ?? null,
      organizationId: typed.organizationId,
    },
    occurredAt: data.createdAt,
    ingestedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Linear webhook payload into a unified Activity record.
 * Returns null for unrecognised or unactionable event types.
 *
 * Handles:
 *   - type: "Issue" — create / update / remove actions
 *   - type: "Comment" — create action only
 */
export function normalizeLinearEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  if (
    typeof payload["type"] !== "string" ||
    typeof payload["action"] !== "string" ||
    payload["data"] == null ||
    typeof payload["data"] !== "object"
  ) {
    return null;
  }

  const type = payload["type"];

  if (type === "Issue") {
    return normalizeIssue(payload as unknown as LinearIssuePayload, userId);
  }

  if (type === "Comment") {
    return normalizeComment(payload as unknown as LinearCommentPayload, userId);
  }

  return null;
}
