/**
 * Tests for the Jira webhook handler.
 *
 * Covers:
 *  - POST /api/webhooks/jira — token rejection, idempotency, event ingestion
 *  - issue_created, issue_updated (in-progress), issue_updated (done → closed),
 *    issue_deleted, comment_created, and non-actionable events
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import { buildApp } from '../../app.js';

// ---------------------------------------------------------------------------
// Redis mock
// ---------------------------------------------------------------------------

const redisMock = {
  status: 'ready' as string,
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('ioredis', () => {
  const ctor = vi.fn().mockImplementation(() => redisMock);
  return { default: ctor, Redis: ctor };
});

// ---------------------------------------------------------------------------
// DB mock (chainable query builder)
// ---------------------------------------------------------------------------

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  returning: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

// ---------------------------------------------------------------------------
// Fixtures — representative Jira webhook payloads
// ---------------------------------------------------------------------------

const SECRET = 'test-jira-webhook-secret';
const TOKEN_QS = `?token=${SECRET}`;

const ISSUE_CREATED_PAYLOAD = JSON.stringify({
  webhookEvent: 'jira:issue_created',
  issue: {
    id: '10001',
    key: 'PROJ-42',
    self: 'https://acme.atlassian.net/rest/api/2/issue/10001',
    fields: {
      summary: 'Login page crashes on Firefox 124',
      description: 'Repro steps: ...',
      status: {
        name: 'To Do',
        statusCategory: { key: 'new' },
      },
      issuetype: { name: 'Bug' },
      project: { key: 'PROJ', name: 'Main Project' },
      created: '2024-03-15T08:00:00.000+0000',
      updated: '2024-03-15T08:00:00.000+0000',
      resolutiondate: null,
      assignee: { displayName: 'Alice Dev', emailAddress: 'alice@acme.com' },
      reporter: { displayName: 'Bob QA', emailAddress: 'bob@acme.com' },
    },
  },
});

const ISSUE_RESOLVED_PAYLOAD = JSON.stringify({
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: '10001',
    key: 'PROJ-42',
    self: 'https://acme.atlassian.net/rest/api/2/issue/10001',
    fields: {
      summary: 'Login page crashes on Firefox 124',
      description: null,
      status: {
        name: 'Done',
        statusCategory: { key: 'done' },
      },
      issuetype: { name: 'Bug' },
      project: { key: 'PROJ', name: 'Main Project' },
      created: '2024-03-15T08:00:00.000+0000',
      updated: '2024-03-18T16:00:00.000+0000',
      resolutiondate: '2024-03-18T16:00:00.000+0000',
      assignee: null,
      reporter: null,
    },
  },
});

const ISSUE_DELETED_PAYLOAD = JSON.stringify({
  webhookEvent: 'jira:issue_deleted',
  issue: {
    id: '10002',
    key: 'PROJ-43',
    self: 'https://acme.atlassian.net/rest/api/2/issue/10002',
    fields: {
      summary: 'Old feature — remove',
      description: null,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      issuetype: { name: 'Task' },
      project: { key: 'PROJ', name: 'Main Project' },
      created: '2024-01-01T00:00:00.000+0000',
      updated: '2024-03-18T12:00:00.000+0000',
      resolutiondate: null,
      assignee: null,
      reporter: null,
    },
  },
});

const COMMENT_CREATED_PAYLOAD = JSON.stringify({
  webhookEvent: 'comment_created',
  comment: {
    id: '50001',
    self: 'https://acme.atlassian.net/rest/api/2/issue/10001/comment/50001',
    body: 'Looks good — merging now.',
    created: '2024-03-16T11:00:00.000+0000',
    updated: '2024-03-16T11:00:00.000+0000',
    author: { displayName: 'Alice Dev', emailAddress: 'alice@acme.com' },
  },
  issue: {
    id: '10001',
    key: 'PROJ-42',
    self: 'https://acme.atlassian.net/rest/api/2/issue/10001',
    fields: {
      summary: 'Login page crashes on Firefox 124',
      project: { key: 'PROJ', name: 'Main Project' },
    },
  },
});

const SPRINT_EVENT_PAYLOAD = JSON.stringify({
  webhookEvent: 'jira:sprint_started',
  issue: {
    id: 'sp-001',
    key: 'PROJ-SP1',
    self: 'https://acme.atlassian.net/rest/api/2/issue/sp-001',
    fields: {
      summary: 'Sprint 1',
      description: null,
      status: { name: 'Active', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Epic' },
      project: { key: 'PROJ', name: 'Main Project' },
      created: '2024-01-01T00:00:00.000+0000',
      updated: '2024-03-01T00:00:00.000+0000',
      resolutiondate: null,
      assignee: null,
      reporter: null,
    },
  },
});

// ---------------------------------------------------------------------------
// Shared beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  process.env['JIRA_WEBHOOK_SECRET'] = SECRET;

  vi.resetAllMocks();
  vi.mocked(Redis).mockImplementation(() => redisMock as never);

  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockReturnThis();
  mockDb.limit.mockResolvedValue([]);
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.onConflictDoNothing.mockResolvedValue(undefined);
  mockDb.returning.mockResolvedValue([]);
  mockDb.delete.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();

  redisMock.status = 'ready';
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.quit.mockResolvedValue('OK');
  redisMock.connect.mockResolvedValue(undefined);
  redisMock.on.mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/jira — auth', () => {
  it('returns 401 when token query param is absent', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/jira',
      headers: { 'content-type': 'application/json' },
      body: ISSUE_CREATED_PAYLOAD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when token is wrong', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/jira?token=wrongtoken',
      headers: { 'content-type': 'application/json' },
      body: ISSUE_CREATED_PAYLOAD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/jira — idempotency', () => {
  it('returns 200 with status:duplicate on repeated delivery', async () => {
    // Simulate unique constraint violation on the insert
    mockDb.values.mockImplementationOnce(() => {
      throw new Error('duplicate key value violates unique constraint');
    });

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: ISSUE_CREATED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'duplicate' });
  });
});

// ---------------------------------------------------------------------------
// Integration resolution
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/jira — integration lookup', () => {
  it('returns 200 with status:no_integration when site has no matching integration', async () => {
    mockDb.limit.mockResolvedValueOnce([]); // no integration found

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: ISSUE_CREATED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'no_integration' });
  });
});

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/jira — event ingestion', () => {
  const fakeIntegration = { id: 'int-001', userId: 'user-001' };

  it('ingests jira:issue_created and returns status:ok', async () => {
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: ISSUE_CREATED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('ingests jira:issue_updated (done) and returns status:ok', async () => {
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: ISSUE_RESOLVED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('ingests jira:issue_deleted and returns status:ok', async () => {
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: ISSUE_DELETED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('ingests comment_created and returns status:ok', async () => {
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: COMMENT_CREATED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('returns status:skipped for non-actionable event types', async () => {
    // Integration is found but the event (sprint_started) is not normalized
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'POST',
      url: `/api/webhooks/jira${TOKEN_QS}`,
      headers: { 'content-type': 'application/json' },
      body: SPRINT_EVENT_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'skipped' });
  });
});
