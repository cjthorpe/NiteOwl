/**
 * Tests for the Linear webhook handler.
 *
 * Covers:
 *  - verifyLinearSignature (unit)
 *  - POST /api/webhooks/linear — signature rejection, idempotency, event ingestion
 *  - normalizeLinearEvent — Comment.create events
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";
import { buildApp } from "../../app.js";
import { verifyLinearSignature } from "./linear.js";

// ---------------------------------------------------------------------------
// Redis mock
// ---------------------------------------------------------------------------

const redisMock = {
  status: "ready" as string,
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  sadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue("OK"),
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock("ioredis", () => {
  const ctor = vi.fn().mockImplementation(() => redisMock);
  return { default: ctor, Redis: ctor };
});

// ---------------------------------------------------------------------------
// DB mock
//
// All query builder methods return `this` so chains can be freely appended.
// Terminal methods (limit, onConflictDoNothing) return Promises.
// `await mockDb` resolves to mockDb itself because it is not a thenable —
// this satisfies `await db.insert().values()` and `await db.update().set().where()`.
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
// Test fixtures
// ---------------------------------------------------------------------------

const SECRET = "test-linear-webhook-secret";

function makeSignature(body: string): string {
  return createHmac("sha256", SECRET).update(Buffer.from(body)).digest("hex");
}

const ISSUE_COMPLETED_PAYLOAD = JSON.stringify({
  type: "Issue",
  action: "update",
  organizationId: "org-abc-123",
  data: {
    id: "issue-id-001",
    identifier: "ENG-42",
    title: "Fix the thing",
    description: null,
    url: "https://linear.app/acme/issue/ENG-42",
    state: { name: "Done", type: "completed" },
    team: { name: "Engineering", key: "ENG" },
    createdAt: "2024-06-01T10:00:00.000Z",
    updatedAt: "2024-06-10T15:00:00.000Z",
    completedAt: "2024-06-10T15:00:00.000Z",
    canceledAt: null,
    assignee: null,
    creator: { name: "Alice", email: "alice@acme.com" },
  },
});

const COMMENT_PAYLOAD = JSON.stringify({
  type: "Comment",
  action: "create",
  organizationId: "org-abc-123",
  data: {
    id: "comment-id-001",
    body: "Deployed to staging.",
    url: "https://linear.app/acme/issue/ENG-42#comment-001",
    createdAt: "2024-06-10T16:00:00.000Z",
    updatedAt: "2024-06-10T16:00:00.000Z",
    issue: {
      id: "issue-id-001",
      identifier: "ENG-42",
      title: "Fix the thing",
      team: { name: "Engineering", key: "ENG" },
    },
    user: { id: "user-bot-001", name: "Deploy Bot", email: "bot@acme.com" },
  },
});

// ---------------------------------------------------------------------------
// Unit tests — verifyLinearSignature
// ---------------------------------------------------------------------------

describe("verifyLinearSignature", () => {
  it("returns true for a correct signature", () => {
    const body = Buffer.from('{"type":"Issue"}');
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyLinearSignature(body, sig, SECRET)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const body = Buffer.from('{"type":"Issue"}');
    expect(verifyLinearSignature(body, "deadbeef", SECRET)).toBe(false);
  });

  it("returns false when signature has correct length but wrong content", () => {
    const body = Buffer.from('{"type":"Issue"}');
    const wrongSig = createHmac("sha256", "wrong-secret")
      .update(body)
      .digest("hex");
    expect(verifyLinearSignature(body, wrongSig, SECRET)).toBe(false);
  });

  it("returns false for empty signature", () => {
    const body = Buffer.from('{"type":"Issue"}');
    expect(verifyLinearSignature(body, "", SECRET)).toBe(false);
  });

  it("rejects when body is modified after signing", () => {
    const original = Buffer.from('{"type":"Issue","action":"create"}');
    const modified = Buffer.from('{"type":"Issue","action":"update"}');
    const sig = createHmac("sha256", SECRET).update(original).digest("hex");
    expect(verifyLinearSignature(modified, sig, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — POST /api/webhooks/linear
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/linear", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = "test-secret-at-least-32-chars-long!!";
    process.env["COOKIE_SECRET"] = "test-cookie-secret-32-chars-long!!";
    process.env["LINEAR_WEBHOOK_SECRET"] = SECRET;

    // resetAllMocks clears call history AND the one-time implementation queue
    // (mockReturnValueOnce / mockImplementationOnce items).
    vi.resetAllMocks();

    // vi.resetAllMocks() clears the ioredis constructor implementation too.
    // Re-apply it so new Redis() still returns redisMock.
    vi.mocked(Redis).mockImplementation(() => redisMock as never);

    // Re-apply default chainable implementations after the reset.
    // values() returns `this` so that .onConflictDoNothing() can be chained.
    // `await mockDb` on a plain non-thenable object resolves to mockDb itself,
    // which satisfies `await db.insert().values()` patterns.
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

    redisMock.status = "ready";
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue("OK");
    redisMock.quit.mockResolvedValue("OK");
    redisMock.connect.mockResolvedValue(undefined);
    redisMock.on.mockImplementation(() => undefined);
  });

  it("returns 400 when linear-signature header is missing", async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json" },
      body: ISSUE_COMPLETED_PAYLOAD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Missing linear-signature header" });
  });

  it("returns 401 when signature is invalid", async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: {
        "content-type": "application/json",
        "linear-signature": "badhashvalue",
      },
      body: ISSUE_COMPLETED_PAYLOAD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Invalid signature" });
  });

  it("returns 200 with status:duplicate when payload hash already exists", async () => {
    // Simulate unique constraint violation on the webhookEvents insert.
    // The handler calls db.insert(...).values(...) — values() is the single
    // terminal call that needs to throw for the idempotency check to trigger.
    mockDb.values.mockImplementationOnce(() => {
      throw new Error(
        "duplicate key value violates unique constraint",
      );
    });

    const app = buildApp({ db: mockDb as never });
    const sig = makeSignature(ISSUE_COMPLETED_PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json", "linear-signature": sig },
      body: ISSUE_COMPLETED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "duplicate" });
  });

  it("returns 200 with status:no_integration when org is not connected", async () => {
    // webhookEvents insert succeeds, integration lookup returns nothing
    mockDb.limit.mockResolvedValueOnce([]); // no integration found

    const app = buildApp({ db: mockDb as never });
    const sig = makeSignature(ISSUE_COMPLETED_PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json", "linear-signature": sig },
      body: ISSUE_COMPLETED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "no_integration" });
  });

  it("returns 200 with status:ok when a completed issue is ingested", async () => {
    const fakeIntegration = { id: "int-001", userId: "user-001" };
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const sig = makeSignature(ISSUE_COMPLETED_PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json", "linear-signature": sig },
      body: ISSUE_COMPLETED_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("returns 200 with status:ok when a bot comment is ingested", async () => {
    const fakeIntegration = { id: "int-001", userId: "user-001" };
    mockDb.limit.mockResolvedValueOnce([fakeIntegration]);

    const app = buildApp({ db: mockDb as never });
    const sig = makeSignature(COMMENT_PAYLOAD);

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json", "linear-signature": sig },
      body: COMMENT_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("returns 200 with status:skipped for non-actionable event types", async () => {
    const unknownPayload = JSON.stringify({
      type: "Project",
      action: "create",
      organizationId: "org-abc-123",
      data: { id: "proj-001" },
    });

    // Integration is found, but the event type cannot be normalized
    mockDb.limit.mockResolvedValueOnce([{ id: "int-001", userId: "user-001" }]);

    const app = buildApp({ db: mockDb as never });
    const sig = makeSignature(unknownPayload);

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/linear",
      headers: { "content-type": "application/json", "linear-signature": sig },
      body: unknownPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "skipped" });
  });
});

// ---------------------------------------------------------------------------
// Normalizer tests — Comment.create (via normalizeLinearEvent)
// ---------------------------------------------------------------------------

import { normalizeLinearEvent } from "../../normalizers/linear.js";

describe("normalizeLinearEvent — Comment.create", () => {
  const USER_ID = "user-abc-123";

  const validCommentPayload = {
    type: "Comment",
    action: "create",
    organizationId: "org-xyz-999",
    data: {
      id: "comment-001",
      body: "Looks good, merging.",
      url: "https://linear.app/acme/issue/ENG-99#comment-001",
      createdAt: "2024-06-12T10:00:00.000Z",
      updatedAt: "2024-06-12T10:00:00.000Z",
      issue: {
        id: "issue-id-099",
        identifier: "ENG-99",
        title: "Add feature X",
        team: { name: "Engineering", key: "ENG" },
      },
      user: { id: "user-bot", name: "Deploy Bot", email: "bot@acme.com" },
    },
  };

  it("normalizes a Comment.create event to comment_created", () => {
    const result = normalizeLinearEvent(validCommentPayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("linear");
    expect(result?.eventType).toBe("comment_created");
    expect(result?.userId).toBe(USER_ID);
    expect(result?.sourceId).toBe("comment:comment-001");
    expect(result?.title).toBe("[ENG] Comment on ENG-99: Add feature X");
    expect(result?.description).toBe("Looks good, merging.");
    expect(result?.url).toBe(
      "https://linear.app/acme/issue/ENG-99#comment-001",
    );
    expect(result?.occurredAt).toBe("2024-06-12T10:00:00.000Z");
    expect(result?.metadata).toMatchObject({
      commentId: "comment-001",
      identifier: "ENG-99",
      teamKey: "ENG",
      author: "Deploy Bot",
      authorEmail: "bot@acme.com",
    });
  });

  it("returns null for Comment actions other than create", () => {
    const updatePayload = { ...validCommentPayload, action: "update" };
    expect(normalizeLinearEvent(updatePayload, USER_ID)).toBeNull();
  });

  it("returns null for a Comment with missing issue data", () => {
    const badPayload = {
      type: "Comment",
      action: "create",
      organizationId: "org-xyz",
      data: {
        id: "c-01",
        body: "hi",
        url: "https://linear.app/...",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        // `issue` is deliberately absent
      },
    };
    expect(normalizeLinearEvent(badPayload, USER_ID)).toBeNull();
  });

  it("returns null for a completely empty payload", () => {
    expect(normalizeLinearEvent({}, USER_ID)).toBeNull();
  });

  it("produces stable non-volatile fields across two calls", () => {
    const a = normalizeLinearEvent(validCommentPayload, USER_ID);
    const b = normalizeLinearEvent(validCommentPayload, USER_ID);

    const { id: _ia, ingestedAt: _iiA, ...restA } = a!;
    const { id: _ib, ingestedAt: _iiB, ...restB } = b!;
    expect(restA).toEqual(restB);
  });
});
