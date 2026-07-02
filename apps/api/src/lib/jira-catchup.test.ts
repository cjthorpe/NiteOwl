// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { decrypt, encrypt } from '@niteowl/db';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';


import { normalizeJiraEvent , canonicalJiraIssueToActivity } from '../normalizers/jira.js';

import { restIssueToCanonical, runJiraCatchup, type JiraRestIssue } from './jira-catchup.js';

// ---------------------------------------------------------------------------
// Env — encryption key + OAuth creds for the refresh path
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env['DB_ENCRYPTION_KEY'] = 'a'.repeat(64); // 32 bytes hex
  process.env['JIRA_CLIENT_ID'] = 'jira-client-id';
  process.env['JIRA_CLIENT_SECRET'] = 'jira-client-secret';
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response;
}

const USER_ID = 'user-abc-123';
const INTEGRATION_ID = 'int-1';
const CLOUD_ID = 'cloud-xyz';
const SITE_URL = 'https://acme.atlassian.net';

// A REST search issue that mirrors the webhook fixture (same id/key).
function restIssue(overrides: Partial<JiraRestIssue['fields']> = {}): JiraRestIssue {
  return {
    id: '10001',
    key: 'PROJ-42',
    fields: {
      summary: 'Login page crashes on Firefox 124',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Bug' },
      project: { key: 'PROJ', name: 'Main Project' },
      created: '2024-03-15T08:00:00.000+0000',
      updated: '2024-03-16T10:00:00.000+0000',
      resolutiondate: null,
      assignee: { displayName: 'Alice Dev' },
      reporter: null,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Shared-normalizer parity — webhook vs REST produce identical external id
// ---------------------------------------------------------------------------

describe('shared normalizer parity', () => {
  const NOW = new Date('2024-03-16T12:00:00.000Z');
  const SINCE = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

  it('webhook issue_updated and REST catch-up synthesize the SAME external id', () => {
    const webhookActivity = normalizeJiraEvent(
      {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10001',
          key: 'PROJ-42',
          self: 'https://acme.atlassian.net/rest/api/2/issue/10001',
          fields: {
            summary: 'Login page crashes on Firefox 124',
            description: null,
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Bug' },
            project: { key: 'PROJ', name: 'Main Project' },
            created: '2024-03-15T08:00:00.000+0000',
            updated: '2024-03-16T10:00:00.000+0000',
            resolutiondate: null,
            assignee: { displayName: 'Alice Dev', emailAddress: 'alice@acme.com' },
            reporter: null,
          },
        },
      },
      USER_ID,
    );

    // `created` is before the window → catch-up classifies as issue_updated.
    const restActivity = canonicalJiraIssueToActivity(
      restIssueToCanonical(restIssue(), SITE_URL, SINCE),
      USER_ID,
    );

    expect(webhookActivity?.sourceId).toBe('issue:10001:jira:issue_updated');
    expect(restActivity?.sourceId).toBe(webhookActivity?.sourceId);
    // Same event classification and browse URL too, so the feed rows are equivalent.
    expect(restActivity?.eventType).toBe(webhookActivity?.eventType);
    expect(restActivity?.url).toBe(webhookActivity?.url);
  });

  it('classifies an issue created inside the window as jira:issue_created', () => {
    const created = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago
    const canonical = restIssueToCanonical(
      restIssue({ created, updated: created }),
      SITE_URL,
      SINCE,
    );
    expect(canonical.webhookEvent).toBe('jira:issue_created');
    expect(canonicalJiraIssueToActivity(canonical, USER_ID)?.sourceId).toBe(
      'issue:10001:jira:issue_created',
    );
  });
});

// ---------------------------------------------------------------------------
// In-memory activity store modelling the (integration_id, external_id) unique
// constraint so `onConflictDoNothing` can be asserted end-to-end.
// ---------------------------------------------------------------------------

interface CapturedUpdate {
  table: string;
  values: Record<string, unknown>;
}

function makeStore(tableNameOf: (t: unknown) => string) {
  const rows = new Map<string, Record<string, unknown>>();
  const updates: CapturedUpdate[] = [];

  const db = {
    insert() {
      return {
        values(vals: Array<Record<string, unknown>>) {
          return {
            onConflictDoNothing() {
              for (const r of vals) {
                const key = `${String(r['integrationId'])}::${String(r['externalId'])}`;
                if (!rows.has(key)) rows.set(key, r);
              }
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updates.push({ table: tableNameOf(table), values });
          return { where: () => Promise.resolve(undefined) };
        },
      };
    },
  };

  return { db, rows, updates };
}

// ---------------------------------------------------------------------------
// 2. Dedup — same issue via webhook then catch-up ⇒ exactly one row
// ---------------------------------------------------------------------------

describe('webhook + catch-up dedup', () => {
  it('does not double-ingest an issue seen by both paths', async () => {
    const { db, rows } = makeStore(() => 'integrations');

    // (a) Webhook ingests the issue first.
    const webhookActivity = normalizeJiraEvent(
      {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10001',
          key: 'PROJ-42',
          self: 'https://acme.atlassian.net/rest/api/2/issue/10001',
          fields: {
            summary: 'Login page crashes on Firefox 124',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Bug' },
            project: { key: 'PROJ', name: 'Main Project' },
            created: '2024-03-15T08:00:00.000+0000',
            updated: '2024-03-16T10:00:00.000+0000',
            resolutiondate: null,
            assignee: null,
            reporter: null,
          },
        },
      },
      USER_ID,
    );
    await db
      .insert()
      .values([
        {
          userId: USER_ID,
          integrationId: INTEGRATION_ID,
          provider: 'jira',
          eventType: webhookActivity!.eventType,
          externalId: webhookActivity!.sourceId,
          title: webhookActivity!.title,
        },
      ])
      .onConflictDoNothing();

    expect(rows.size).toBe(1);

    // (b) Catch-up runs for the same issue — access token valid (no refresh).
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/search/jql')) return jsonResponse({ issues: [restIssue()] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await runJiraCatchup({
      db: db as never,
      userId: USER_ID,
      integrationId: INTEGRATION_ID,
      cloudId: CLOUD_ID,
      siteUrl: SITE_URL,
      accessTokenEncrypted: 'plaintext-access-token', // decryptToken tolerates plaintext
      refreshTokenEncrypted: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // valid → no refresh
    });

    expect(result.ingested).toBe(1); // one row offered…
    expect(rows.size).toBe(1); // …but deduped: still exactly one stored row
  });
});

// ---------------------------------------------------------------------------
// 3. Token refresh — rotated refresh token is persisted (encrypted)
// ---------------------------------------------------------------------------

describe('token refresh persistence', () => {
  it('refreshes a near-expiry token and persists the ROTATED refresh token', async () => {
    const { db, updates } = makeStore((t) =>
      // crude table discriminator: the oauth update carries token fields.
      String(t) === '[object Object]' ? 'unknown' : 'unknown',
    );

    // Access token expiring in 10s → below the 60s skew → must refresh.
    const expiringAt = new Date(Date.now() + 10 * 1000);

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/oauth/token')) {
        return jsonResponse({
          access_token: 'new-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
          scope: 'read:jira-work offline_access',
          token_type: 'Bearer',
        });
      }
      if (url.includes('/search/jql')) return jsonResponse({ issues: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await runJiraCatchup({
      db: db as never,
      userId: USER_ID,
      integrationId: INTEGRATION_ID,
      cloudId: CLOUD_ID,
      siteUrl: SITE_URL,
      accessTokenEncrypted: encrypt('old-access-token'),
      refreshTokenEncrypted: encrypt('old-refresh-token'),
      expiresAt: expiringAt,
    });

    // The oauth_tokens update captures the rotated, RE-ENCRYPTED refresh token.
    const tokenUpdate = updates.find(
      (u) => 'refreshTokenEncrypted' in u.values && 'accessTokenEncrypted' in u.values,
    );
    expect(tokenUpdate).toBeDefined();

    const persistedRefresh = tokenUpdate!.values['refreshTokenEncrypted'] as string;
    const persistedAccess = tokenUpdate!.values['accessTokenEncrypted'] as string;

    // Stored ciphertext must NOT equal plaintext, and must decrypt to the rotated values.
    expect(persistedRefresh).not.toBe('rotated-refresh-token');
    expect(decrypt(persistedRefresh)).toBe('rotated-refresh-token');
    expect(decrypt(persistedAccess)).toBe('new-access-token');

    // The refresh call was made with the OLD refresh token.
    const refreshCall = mockFetch.mock.calls.find((c) => String(c[0]).includes('/oauth/token'));
    expect(refreshCall).toBeDefined();
    expect(String(refreshCall![1].body)).toContain('old-refresh-token');
    expect(String(refreshCall![1].body)).toContain('refresh_token');
  });
});
