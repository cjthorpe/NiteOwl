// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Core Jira catch-up logic — fetches issues updated in the last N hours via the
 * Jira REST search API, normalizes them through the SHARED canonical core
 * (`normalizers/jira.ts`) so their external ids collide with the webhook path,
 * and inserts any missing ones into activity_events.
 *
 * Used by:
 *  - POST /api/integrations/jira/catchup  (per-user HTTP endpoint)
 *  - overnight-catchup BullMQ repeating job (FUL-60)
 *
 * Three constraints from the FUL-123 plan are enforced here:
 *  1. Dedup — external ids are synthesized via the shared `normalizers/jira.ts`
 *     core, choosing `jira:issue_created` for issues created inside the window
 *     and `jira:issue_updated` otherwise, matching the webhook `sourceId`.
 *  2. Token lifecycle — Atlassian access tokens expire (~1h) and refresh tokens
 *     rotate on every use. Before hitting REST we refresh when near expiry and
 *     PERSIST the rotated refresh token (AES-GCM via @niteowl/db).
 *  3. cloudId vs siteUrl — REST calls use cloudId; the browse URL + external-id
 *     parity use siteUrl (the webhook matches on siteUrl host).
 */

import type { Db } from '@niteowl/db';
import { schema, decryptToken, encrypt } from '@niteowl/db';
import { and, eq } from 'drizzle-orm';

import { canonicalJiraIssueToActivity, type CanonicalJiraIssue } from '../normalizers/jira.js';

import { refreshJiraToken } from './jira-oauth.js';

// ---------------------------------------------------------------------------
// Jira REST search types (minimal)
// ---------------------------------------------------------------------------

export interface JiraRestIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: { key: string };
    };
    issuetype: { name: string };
    project: { key: string; name: string };
    created: string;
    updated: string;
    resolutiondate?: string | null;
    assignee?: { displayName: string } | null;
    reporter?: { displayName: string } | null;
  };
}

interface JiraSearchResponse {
  issues?: JiraRestIssue[];
}

// Fields requested from the REST search — kept minimal and, crucially, WITHOUT
// `description` (v3 returns it as an ADF document, not plain text).
const SEARCH_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'project',
  'created',
  'updated',
  'resolutiondate',
  'assignee',
  'reporter',
];

/** Refresh the access token when it expires within this window. */
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// REST issue → canonical shape
// ---------------------------------------------------------------------------

/**
 * Map a REST search issue to the shared canonical shape. The chosen
 * `webhookEvent` is what makes the external id collide with the webhook path:
 * an issue whose `created` timestamp falls inside the lookback window is treated
 * as `jira:issue_created`; anything else as `jira:issue_updated`.
 */
export function restIssueToCanonical(
  issue: JiraRestIssue,
  siteUrl: string,
  since: Date,
): CanonicalJiraIssue {
  const fields = issue.fields;
  const createdMs = Date.parse(fields.created);
  const webhookEvent =
    Number.isFinite(createdMs) && createdMs >= since.getTime()
      ? 'jira:issue_created'
      : 'jira:issue_updated';

  // Normalize the site base (strip any trailing slash) so /browse joins cleanly.
  const base = siteUrl.replace(/\/+$/, '');

  return {
    id: issue.id,
    key: issue.key,
    webhookEvent,
    browseUrl: `${base}/browse/${issue.key}`,
    // REST v3 description is ADF, not text — omit rather than dump JSON.
    description: null,
    summary: fields.summary,
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

// ---------------------------------------------------------------------------
// REST fetch
// ---------------------------------------------------------------------------

/**
 * Fetch issues updated within the lookback window via the enhanced JQL search
 * endpoint. `since` is expressed to Jira as a relative `-Nh` duration.
 */
export async function fetchRecentlyUpdatedIssues(
  cloudId: string,
  accessToken: string,
  lookbackHours: number,
): Promise<JiraRestIssue[]> {
  const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jql: `updated >= -${lookbackHours}h ORDER BY updated DESC`,
      fields: SEARCH_FIELDS,
      maxResults: 100,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status}`);
  }

  const body = (await res.json()) as JiraSearchResponse;
  return body.issues ?? [];
}

// ---------------------------------------------------------------------------
// Token freshness
// ---------------------------------------------------------------------------

interface FreshTokenResult {
  accessToken: string;
}

/**
 * Ensure a usable access token, refreshing (and persisting the ROTATED refresh
 * token) when the current one is at/near expiry. Returns the plaintext access
 * token to use for REST calls.
 */
async function ensureFreshAccessToken(
  db: Db,
  userId: string,
  accessTokenEncrypted: string,
  refreshTokenEncrypted: string | null,
  expiresAt: Date | null,
  now: Date,
): Promise<FreshTokenResult> {
  const stillValid =
    expiresAt != null && expiresAt.getTime() - now.getTime() > TOKEN_REFRESH_SKEW_MS;

  if (stillValid || refreshTokenEncrypted == null) {
    // Either the token is comfortably valid, or we have no refresh token to
    // rotate with — use what we have and let the API surface a 401 if stale.
    return { accessToken: decryptToken(accessTokenEncrypted) };
  }

  const refreshToken = decryptToken(refreshTokenEncrypted);
  const refreshed = await refreshJiraToken(refreshToken);

  const newExpiresAt =
    refreshed.expires_in != null ? new Date(now.getTime() + refreshed.expires_in * 1000) : null;

  // Persist the new access token AND the rotated refresh token. Dropping the
  // rotated refresh token would 400 the next run (plan trap #2).
  await db
    .update(schema.oauthTokens)
    .set({
      accessTokenEncrypted: encrypt(refreshed.access_token),
      // Atlassian returns a fresh refresh_token on every refresh; fall back to
      // re-storing the current one only if (unexpectedly) absent.
      refreshTokenEncrypted: encrypt(refreshed.refresh_token ?? refreshToken),
      ...(newExpiresAt != null ? { expiresAt: newExpiresAt } : {}),
      ...(refreshed.scope != null ? { scopes: refreshed.scope } : {}),
      updatedAt: now,
    })
    .where(and(eq(schema.oauthTokens.userId, userId), eq(schema.oauthTokens.provider, 'jira')));

  return { accessToken: refreshed.access_token };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface JiraCatchupOptions {
  db: Db;
  userId: string;
  integrationId: string;
  /** Atlassian cloudId for REST calls (`configJson.cloudId`). */
  cloudId: string;
  /** Site base URL for browse links + webhook external-id parity (`configJson.siteUrl`). */
  siteUrl: string;
  /** AES-GCM encrypted OAuth access token (`oauth_tokens.access_token_encrypted`). */
  accessTokenEncrypted: string;
  /** AES-GCM encrypted rotating refresh token, if present. */
  refreshTokenEncrypted: string | null;
  /** Access-token expiry, if known. */
  expiresAt: Date | null;
  /** How many hours to look back — default 24. */
  lookbackHours?: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface JiraCatchupResult {
  /** Number of activity_events rows offered for insert (pre-dedup). */
  ingested: number;
}

/**
 * Fetches Jira issues updated in the last `lookbackHours` hours and inserts any
 * missing ones into activity_events.
 *
 * Idempotent — duplicate externalIds are silently ignored via ON CONFLICT DO
 * NOTHING against the (integration_id, external_id) unique constraint.
 */
export async function runJiraCatchup(opts: JiraCatchupOptions): Promise<JiraCatchupResult> {
  const {
    db,
    userId,
    integrationId,
    cloudId,
    siteUrl,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    expiresAt,
    lookbackHours = 24,
    now = new Date(),
  } = opts;

  const { accessToken } = await ensureFreshAccessToken(
    db,
    userId,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    expiresAt,
    now,
  );

  const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const issues = await fetchRecentlyUpdatedIssues(cloudId, accessToken, lookbackHours);

  if (issues.length === 0) {
    await db
      .update(schema.integrations)
      .set({ lastSyncedAt: now })
      .where(eq(schema.integrations.id, integrationId));
    return { ingested: 0 };
  }

  const rows = issues
    .map((issue) => {
      const activity = canonicalJiraIssueToActivity(
        restIssueToCanonical(issue, siteUrl, since),
        userId,
      );
      if (activity === null) return null;
      return {
        userId,
        integrationId,
        provider: 'jira' as const,
        eventType: activity.eventType,
        externalId: activity.sourceId,
        title: activity.title,
        url: activity.url,
        metadata: activity.metadata,
        occurredAt: new Date(activity.occurredAt),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    await db.insert(schema.activityEvents).values(rows).onConflictDoNothing();
  }

  await db
    .update(schema.integrations)
    .set({ lastSyncedAt: now })
    .where(eq(schema.integrations.id, integrationId));

  return { ingested: rows.length };
}
