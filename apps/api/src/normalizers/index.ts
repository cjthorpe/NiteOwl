export { normalizeGitHubEvent } from "./github.js";
export { normalizeJiraEvent } from "./jira.js";
export { normalizeLinearEvent } from "./linear.js";
export { normalizeSlackEvent } from "./slack.js";

import type { Activity, ActivityProvider } from "@niteowl/types";
import { normalizeGitHubEvent } from "./github.js";
import { normalizeJiraEvent } from "./jira.js";
import { normalizeLinearEvent } from "./linear.js";
import { normalizeSlackEvent } from "./slack.js";

/**
 * Dispatch table — routes raw payloads to the correct normalizer.
 * Returns null when the event type is unrecognised or not actionable.
 */
export function normalizeEvent(
  provider: ActivityProvider,
  payload: Record<string, unknown>,
  userId: string,
): Activity | null {
  switch (provider) {
    case "github":
      return normalizeGitHubEvent(payload, userId);
    case "linear":
      return normalizeLinearEvent(payload, userId);
    case "jira":
      return normalizeJiraEvent(payload, userId);
    case "slack":
      return normalizeSlackEvent(payload, userId);
  }
}
