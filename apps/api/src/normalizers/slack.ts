import type { Activity } from "@niteowl/types";

// ---------------------------------------------------------------------------
// Slack event payload types (minimal)
// ---------------------------------------------------------------------------

interface SlackEventCallback {
  type: "event_callback";
  event: {
    type: string;
    channel?: string;
    channel_type?: string;
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    subtype?: string;
    item?: {
      type: string;
      channel?: string;
      ts?: string;
    };
    reaction?: string;
    item_user?: string;
    permalink?: string;
  };
  team_id: string;
  api_app_id: string;
  event_id: string;
  event_time: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsToIso(ts: string): string {
  // Slack timestamps are Unix epoch seconds with microseconds: "1234567890.123456"
  const seconds = parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}

function buildSlackUrl(teamId: string, channel: string, ts: string): string {
  // Standard Slack deep-link format. Requires the team URL which isn't in the
  // payload, so we use the Slack archive format.
  const anchor = ts.replace(".", "");
  return `https://slack.com/archives/${channel}/p${anchor}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw Slack event callback payload into a unified Activity record.
 *
 * Slack events don't cleanly map to the PR/commit/issue taxonomy, so we surface
 * them as `issue_updated` (a catch-all for "something happened in a channel").
 * Only `message` and `message.channel_message` subtypes are normalised; all
 * others are skipped.
 *
 * Returns null for unrecognised or unactionable event types.
 */
export function normalizeSlackEvent(
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  if (
    typeof payload["type"] !== "string" ||
    payload["type"] !== "event_callback" ||
    payload["event"] == null ||
    typeof payload["event"] !== "object"
  ) {
    return null;
  }

  const typed = payload as unknown as SlackEventCallback;
  const { event } = typed;

  // Only handle plain messages (no bot messages, joins, etc.)
  if (event.type !== "message") return null;
  if (event.subtype != null && event.subtype !== "me_message") return null;

  const channel = event.channel ?? "unknown";
  const text = event.text ?? "";
  const truncated = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const url =
    event.permalink ?? buildSlackUrl(typed.team_id, channel, event.ts);

  return {
    id: crypto.randomUUID(),
    userId,
    provider: "slack",
    eventType: "issue_updated",
    sourceId: `message:${typed.event_id}`,
    title: `Slack message in #${channel}`,
    description: truncated || undefined,
    url,
    metadata: {
      channelId: channel,
      channelType: event.channel_type ?? null,
      slackUserId: event.user ?? null,
      threadTs: event.thread_ts ?? null,
      teamId: typed.team_id,
      eventId: typed.event_id,
    },
    occurredAt: tsToIso(event.ts),
    ingestedAt: new Date().toISOString(),
  };
}
