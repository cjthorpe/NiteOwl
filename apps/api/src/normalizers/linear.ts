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
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Linear webhook payload into a unified Activity record.
 * Returns null for unrecognised or unactionable event types.
 */
export function normalizeLinearEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  if (
    typeof payload["type"] !== "string" ||
    payload["type"] !== "Issue" ||
    typeof payload["action"] !== "string" ||
    payload["data"] == null ||
    typeof payload["data"] !== "object"
  ) {
    return null;
  }

  const typed = payload as unknown as LinearIssuePayload;
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
    description: data.description,
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
