// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Core Linear catch-up logic — fetches issues completed in the last N hours
 * and inserts any missing ones into activity_events.
 *
 * Used by:
 *  - POST /api/integrations/linear/catchup  (per-user HTTP endpoint)
 *  - overnight-catchup BullMQ repeating job  (FUL-60)
 */

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Linear GraphQL types (minimal)
// ---------------------------------------------------------------------------

export interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  team: { name: string; key: string };
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { name: string; email: string } | null;
  creator: { name: string; email: string } | null;
}

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes: LinearIssueNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

const CATCHUP_QUERY = `
  query RecentCompleted($since: DateTimeOrDuration!) {
    issues(
      filter: {
        completedAt: { gte: $since }
      }
      orderBy: updatedAt
      first: 100
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        team { name key }
        completedAt
        canceledAt
        createdAt
        updatedAt
        assignee { name email }
        creator { name email }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

export async function fetchRecentlyCompletedIssues(
  accessToken: string,
  since: Date,
): Promise<LinearIssueNode[]> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: CATCHUP_QUERY,
      variables: { since: since.toISOString() },
    }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status}`);
  }

  const body = (await res.json()) as LinearIssuesResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${body.errors.map((e) => e.message).join(', ')}`);
  }

  return body.data?.issues?.nodes ?? [];
}

export function issueToExternalId(issue: LinearIssueNode): string {
  // Stable external ID: maps to the "update completed" action in the normalizer.
  return `issue:${issue.id}:update`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LinearCatchupOptions {
  db: Db;
  userId: string;
  integrationId: string;
  /**
   * Plaintext Linear OAuth access token.
   * NOTE: current implementation stores tokens without app-layer encryption;
   * read directly from oauth_tokens.access_token_encrypted.
   */
  accessToken: string;
  /** How many hours to look back — default 24 */
  lookbackHours?: number;
}

export interface LinearCatchupResult {
  /** Number of activity_events rows inserted (deduped rows excluded) */
  ingested: number;
}

/**
 * Fetches Linear issues completed in the last `lookbackHours` hours and
 * inserts any missing ones into activity_events.
 *
 * Idempotent — duplicate externalIds are silently ignored via ON CONFLICT DO NOTHING.
 */
export async function runLinearCatchup(opts: LinearCatchupOptions): Promise<LinearCatchupResult> {
  const { db, userId, integrationId, accessToken, lookbackHours = 24 } = opts;

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const issues = await fetchRecentlyCompletedIssues(accessToken, since);

  if (issues.length === 0) {
    await db
      .update(schema.integrations)
      .set({ lastSyncedAt: new Date() })
      .where(eq(schema.integrations.id, integrationId));
    return { ingested: 0 };
  }

  const rows = issues.map((issue) => {
    const stateType = issue.state.type;
    const occurredAt = new Date(issue.completedAt ?? issue.canceledAt ?? issue.updatedAt);
    const eventType =
      stateType === 'completed' || stateType === 'cancelled' ? 'issue_closed' : 'issue_updated';

    return {
      userId,
      integrationId,
      provider: 'linear' as const,
      eventType,
      externalId: issueToExternalId(issue),
      title: `[${issue.team.key}] ${issue.identifier}: ${issue.title}`,
      url: issue.url,
      metadata: {
        identifier: issue.identifier,
        teamKey: issue.team.key,
        teamName: issue.team.name,
        state: issue.state.name,
        stateType,
        assignee: issue.assignee?.name ?? null,
        creator: issue.creator?.name ?? null,
      },
      occurredAt,
    };
  });

  // Batch insert — duplicate externalIds are silently skipped via unique constraint.
  await db.insert(schema.activityEvents).values(rows).onConflictDoNothing();

  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.integrations.id, integrationId));

  return { ingested: rows.length };
}
