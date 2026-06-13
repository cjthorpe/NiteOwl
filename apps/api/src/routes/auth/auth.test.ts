/**
 * Integration tests for auth routes — use Fastify inject so no real HTTP
 * server or Postgres connection is needed.  DB calls are intercepted via
 * vi.mock so every code-path in the route handlers is exercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildApp } from "../../app.js";

// ── DB mock ────────────────────────────────────────────────────────────────
// Each test controls what the mock DB returns by reassigning these vars.
let selectRows: unknown[] = [];
let insertedRows: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockImplementation(() => Promise.resolve(selectRows)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockImplementation(() => Promise.resolve(insertedRows)),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

beforeEach(() => {
  process.env["JWT_SECRET"] = "test-secret-at-least-32-chars-long!!";
  process.env["COOKIE_SECRET"] = "test-cookie-secret-32-chars-long!!";
  selectRows = [];
  insertedRows = [];
  vi.clearAllMocks();
  // Re-wire chainable mocks after clearAllMocks
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));
  mockDb.insert.mockReturnThis();
  mockDb.values.mockReturnThis();
  mockDb.returning.mockImplementation(() => Promise.resolve(insertedRows));
  mockDb.delete.mockReturnThis();
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
});

// ── Tests: POST /auth/register ─────────────────────────────────────────────
describe("POST /auth/register", () => {
  it("creates a user and returns an access token", async () => {
    selectRows = []; // no existing user
    insertedRows = [{ id: "user-001", email: "alice@example.com" }];
    // Second insert (refresh token) also needs to resolve
    mockDb.returning
      .mockImplementationOnce(() => Promise.resolve(insertedRows))
      .mockImplementationOnce(() => Promise.resolve([]));

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "alice@example.com", password: "hunter2hunter2" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ success: boolean; data: { accessToken: string } }>();
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe("string");
    expect(body.data.accessToken.split(".")).toHaveLength(3);
  });

  it("returns 409 when the email is already registered", async () => {
    selectRows = [{ id: "existing-user" }];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "taken@example.com", password: "hunter2hunter2" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ success: boolean; error: string }>();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/already registered/i);
  });

  it("returns 400 for invalid email format", async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "hunter2hunter2" },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── Tests: POST /auth/login ────────────────────────────────────────────────
describe("POST /auth/login", () => {
  it("returns 401 for unknown email", async () => {
    selectRows = [];

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "ghost@example.com", password: "irrelevant" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    // Pre-hash a known password so we can test mismatch
    const { hashPassword } = await import("../../lib/password.js");
    const hash = await hashPassword("correct-password");
    selectRows = [{ id: "u1", email: "bob@example.com", passwordHash: hash }];
    mockDb.limit.mockImplementation(() => Promise.resolve(selectRows));

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "bob@example.com", password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Tests: POST /auth/logout ───────────────────────────────────────────────
describe("POST /auth/logout", () => {
  it("clears the refresh cookie and returns success", async () => {
    mockDb.delete.mockReturnThis();
    mockDb.where.mockImplementation(() => Promise.resolve());

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { niteowl_refresh: "some-fake-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean }>();
    expect(body.success).toBe(true);

    // Cookie should be cleared
    const setCookieHeader = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join("; ")
      : (setCookieHeader ?? "");
    expect(cookieStr).toMatch(/niteowl_refresh/);
  });
});

// ── Tests: POST /auth/refresh ──────────────────────────────────────────────
describe("POST /auth/refresh", () => {
  it("returns 401 with no cookie", async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: "POST", url: "/auth/refresh" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for an unknown/expired refresh token", async () => {
    selectRows = []; // no matching token in DB

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { niteowl_refresh: "stale-token" },
    });

    expect(res.statusCode).toBe(401);
  });
});
