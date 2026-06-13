/**
 * Slack outbound alert service.
 *
 * Formats PR merge events as Slack Block Kit messages and delivers them to a
 * configured Incoming Webhook URL.  Failed deliveries are retried up to
 * MAX_RETRIES times with linear back-off before the error is propagated.
 *
 * This module has NO Fastify dependency — it can be called from the BullMQ
 * normalization worker as well as from HTTP route handlers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrMergeAlertData {
  repo: string;
  prNumber: number;
  prTitle: string;
  author: string;
  url: string;
  /** The base branch the PR was merged into, e.g. "main" */
  baseBranch: string;
  occurredAt: string; // ISO 8601
}

/** Minimal Slack Block Kit message shape for an Incoming Webhook. */
export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

export type SlackBlock =
  | { type: "header"; text: SlackTextObject }
  | { type: "section"; text: SlackTextObject; accessory?: SlackButtonElement }
  | { type: "context"; elements: SlackTextObject[] }
  | { type: "divider" };

export interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

export interface SlackButtonElement {
  type: "button";
  text: SlackTextObject;
  url: string;
  action_id: string;
}

export interface SendResult {
  ok: true;
  attempts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
/** Linear back-off: retry_n waits n * RETRY_DELAY_MS before the next attempt. */
const RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Builds a Slack Block Kit message for a GitHub PR merge event.
 *
 * Example render:
 *   🎉 PR merged — owner/repo
 *   ────────────────────────────
 *   *[#42] Add dark mode support*
 *   Merged by octocat into main
 *   [Open PR ↗]
 *   ─────────────────────────────
 *   NiteOwl Alert · 16 Mar 2024
 */
export function formatPrMergeAlert(data: PrMergeAlertData): SlackMessage {
  const ts = new Date(data.occurredAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const fallbackText = `PR #${data.prNumber} merged into ${data.baseBranch} on ${data.repo}: "${data.prTitle}" by ${data.author}`;

  return {
    text: fallbackText,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎉 PR merged — ${data.repo}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${data.url}|#${data.prNumber}: ${escapeMarkdown(data.prTitle)}>*\nMerged by *${escapeMarkdown(data.author)}* into \`${escapeMarkdown(data.baseBranch)}\``,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Open PR ↗", emoji: false },
          url: data.url,
          action_id: "open_pr",
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `NiteOwl Alert · ${ts}`,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Sends a formatted Slack message to the given Incoming Webhook URL.
 *
 * Retries up to {@link MAX_RETRIES} times on transient HTTP errors (5xx or
 * network failures). Throws a {@link SlackAlertError} if all attempts fail.
 */
export async function sendSlackAlert(
  webhookUrl: string,
  message: SlackMessage,
  retries = MAX_RETRIES,
): Promise<SendResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });

      if (response.ok) {
        return { ok: true, attempts: attempt };
      }

      // 4xx errors are permanent — don't retry (bad URL, revoked token, etc.)
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => "");
        throw new SlackAlertError(
          `Slack webhook returned ${response.status}: ${body}`,
          response.status,
          attempt,
          /* permanent */ true,
        );
      }

      // 5xx — transient; fall through to retry
      const body = await response.text().catch(() => "");
      lastError = new SlackAlertError(
        `Slack webhook returned ${response.status}: ${body}`,
        response.status,
        attempt,
        false,
      );
    } catch (err) {
      if (err instanceof SlackAlertError && err.permanent) throw err;
      lastError = err;
    }

    if (attempt <= retries) {
      await sleep(attempt * RETRY_DELAY_MS);
    }
  }

  throw new SlackAlertError(
    `Slack alert failed after ${retries + 1} attempts: ${String(lastError)}`,
    0,
    retries + 1,
    false,
  );
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SlackAlertError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly attempts: number,
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = "SlackAlertError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escape characters that have special meaning in Slack mrkdwn. */
function escapeMarkdown(text: string): string {
  return text.replace(/[&<>]/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    return c;
  });
}
