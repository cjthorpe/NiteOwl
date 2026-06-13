import type { Activity, ActivityEventType } from "@niteowl/types";

// ---------------------------------------------------------------------------
// Jira webhook payload types (minimal)
// ---------------------------------------------------------------------------

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

function resolveJiraEventType(webhookEvent: string): ActivityEventType | null {
  switch (webhookEvent) {
    case "jira:issue_created":
      return "issue_opened";
    case "jira:issue_deleted":
      return "issue_closed";
    case "jira:issue_updated":
      // Classify as closed when transitioning to a "done" category.
      return "issue_updated";
    default:
      return null;
  }
}

function refineJiraUpdateType(
  payload: JiraIssuePayload,
  base: ActivityEventType,
): ActivityEventType {
  if (base !== "issue_updated") return base;
  const statusCategoryKey =
    payload.issue.fields.status.statusCategory.key.toLowerCase();
  if (statusCategoryKey === "done") return "issue_closed";
  return "issue_updated";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Jira webhook payload into a unified Activity record.
 * Returns null for unrecognised or unactionable event types.
 */
export function normalizeJiraEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  if (
    typeof payload["webhookEvent"] !== "string" ||
    payload["issue"] == null ||
    typeof payload["issue"] !== "object"
  ) {
    return null;
  }

  const typed = payload as unknown as JiraIssuePayload;
  const baseEventType = resolveJiraEventType(typed.webhookEvent);
  if (baseEventType === null) return null;

  const eventType = refineJiraUpdateType(typed, baseEventType);
  const { issue } = typed;
  const fields = issue.fields;

  const occurredAt =
    eventType === "issue_closed" && fields.resolutiondate != null
      ? fields.resolutiondate
      : fields.updated;

  // Jira issue URL: derive from self (API URL) → browser URL not in payload,
  // so we reconstruct from the self host + /browse/<key>.
  const selfUrl = new URL(issue.self);
  const browseUrl = `${selfUrl.protocol}//${selfUrl.host}/browse/${issue.key}`;

  return {
    id: crypto.randomUUID(),
    userId,
    provider: "jira",
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
