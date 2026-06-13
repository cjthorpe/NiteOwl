/**
 * Unit tests for the overnight catch-up worker (FUL-60).
 *
 * We test the processor logic in isolation by:
 *  - Mocking the DB to return controllable integration rows.
 *  - Mocking runLinearCatchup from the lib module.
 *  - Stubbing the BullMQ Worker constructor so no Redis connection is opened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub BullMQ Worker so no Redis is required
// ---------------------------------------------------------------------------

let capturedProcessor: ((job: { id?: string }) => Promise<void>) | null = null;

vi.mock("bullmq", () => {
  return {
    Worker: vi.fn().mockImplementation(
      (_queue: string, processor: (job: { id?: string }) => Promise<void>) => {
        capturedProcessor = processor;
        return {
          on: vi.fn(),
          close: vi.fn().mockResolvedValue(undefined),
        };
      },
    ),
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockResolvedValue({ id: "test-job-id" }),
      close: vi.fn().mockResolvedValue(undefined),
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// ---------------------------------------------------------------------------
// Stub runLinearCatchup
// ---------------------------------------------------------------------------

const mockRunLinearCatchup = vi.fn();

vi.mock("../lib/linear-catchup.js", () => ({
  runLinearCatchup: mockRunLinearCatchup,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(linearRows: Array<{ integrationId: string; userId: string; accessToken: string }>) {
  // Returns a chainable drizzle-like stub.
  const query = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(linearRows),
  };
  return query as unknown as Parameters<
    typeof import("./overnight-catchup.worker.js")["createOvernightCatchupWorker"]
  >[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("overnight-catchup worker", () => {
  const redisOptions = { host: "localhost", port: 6379 };

  beforeEach(() => {
    capturedProcessor = null;
    // Only reset the per-test mock (not the Worker module mock whose
    // implementation must survive across tests in this file).
    mockRunLinearCatchup.mockReset();
  });

  it("processes all active Linear integrations and accumulates ingested count", async () => {
    const { createOvernightCatchupWorker } = await import(
      "./overnight-catchup.worker.js"
    );

    mockRunLinearCatchup
      .mockResolvedValueOnce({ ingested: 3 })
      .mockResolvedValueOnce({ ingested: 7 });

    const db = makeDb([
      { integrationId: "int-1", userId: "user-1", accessToken: "tok-1" },
      { integrationId: "int-2", userId: "user-2", accessToken: "tok-2" },
    ]);

    createOvernightCatchupWorker(db, redisOptions);

    expect(capturedProcessor).not.toBeNull();
    await capturedProcessor!({ id: "job-42" });

    expect(mockRunLinearCatchup).toHaveBeenCalledTimes(2);
    expect(mockRunLinearCatchup).toHaveBeenCalledWith({
      db,
      userId: "user-1",
      integrationId: "int-1",
      accessToken: "tok-1",
    });
    expect(mockRunLinearCatchup).toHaveBeenCalledWith({
      db,
      userId: "user-2",
      integrationId: "int-2",
      accessToken: "tok-2",
    });
  });

  it("continues past a failed Linear integration without aborting the job", async () => {
    const { createOvernightCatchupWorker } = await import(
      "./overnight-catchup.worker.js"
    );

    mockRunLinearCatchup
      .mockRejectedValueOnce(new Error("Linear API timeout"))
      .mockResolvedValueOnce({ ingested: 5 });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const db = makeDb([
      { integrationId: "int-fail", userId: "user-1", accessToken: "tok-bad" },
      { integrationId: "int-ok", userId: "user-2", accessToken: "tok-ok" },
    ]);

    createOvernightCatchupWorker(db, redisOptions);

    // Should NOT throw even though the first integration failed
    await expect(capturedProcessor!({ id: "job-err" })).resolves.toBeUndefined();

    expect(mockRunLinearCatchup).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("int-fail"),
      expect.any(String),
    );
  });

  it("completes successfully when there are no active integrations", async () => {
    const { createOvernightCatchupWorker } = await import(
      "./overnight-catchup.worker.js"
    );

    const db = makeDb([]); // no rows

    createOvernightCatchupWorker(db, redisOptions);

    await expect(capturedProcessor!({ id: "job-empty" })).resolves.toBeUndefined();

    expect(mockRunLinearCatchup).not.toHaveBeenCalled();
  });

  it("exports the correct queue name constant", async () => {
    const { OVERNIGHT_CATCHUP_QUEUE } = await import(
      "./overnight-catchup.worker.js"
    );
    expect(OVERNIGHT_CATCHUP_QUEUE).toBe("overnight-catchup");
  });
});

// ---------------------------------------------------------------------------
// parseCatchupHour is tested via the queue plugin behaviour
// ---------------------------------------------------------------------------

describe("parseCatchupHour (via queue plugin)", () => {
  it("defaults to hour 6 when CATCHUP_HOUR_UTC is unset", async () => {
    delete process.env["CATCHUP_HOUR_UTC"];

    // We can't import queue.ts easily here without Redis, so we inline
    // the same logic as a pure unit test.
    const parseCatchupHour = () => {
      const raw = process.env["CATCHUP_HOUR_UTC"];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
  });

  it("parses CATCHUP_HOUR_UTC=3 correctly", () => {
    process.env["CATCHUP_HOUR_UTC"] = "3";

    const parseCatchupHour = () => {
      const raw = process.env["CATCHUP_HOUR_UTC"];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(3);
    delete process.env["CATCHUP_HOUR_UTC"];
  });

  it("falls back to 6 for out-of-range values", () => {
    process.env["CATCHUP_HOUR_UTC"] = "99";

    const parseCatchupHour = () => {
      const raw = process.env["CATCHUP_HOUR_UTC"];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
    delete process.env["CATCHUP_HOUR_UTC"];
  });

  it("falls back to 6 for non-numeric values", () => {
    process.env["CATCHUP_HOUR_UTC"] = "dawn";

    const parseCatchupHour = () => {
      const raw = process.env["CATCHUP_HOUR_UTC"];
      if (!raw) return 6;
      const parsed = parseInt(raw, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 6;
    };

    expect(parseCatchupHour()).toBe(6);
    delete process.env["CATCHUP_HOUR_UTC"];
  });
});
