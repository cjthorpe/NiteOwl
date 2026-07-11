// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Unit tests for the event-retention worker (FUL-132).
 *
 * The BullMQ Worker constructor is stubbed so no Redis is required; we capture
 * the processor and drive it directly. `runEventRetention` / `resolveRetentionConfig`
 * are mocked so we assert orchestration, not the deletion SQL (covered in
 * event-retention.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let capturedProcessor: ((job: { id?: string }) => Promise<void>) | null = null;

vi.mock('bullmq', () => ({
  // Vitest 4 constructs mocks via Reflect.construct, so the implementation must
  // be a regular function (not an arrow) to be usable behind `new Worker(...)`.
  Worker: vi
    .fn()
    .mockImplementation(function (
      _queue: string,
      processor: (job: { id?: string }) => Promise<void>,
    ) {
      capturedProcessor = processor;
      return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    }),
}));

const mockResolveRetentionConfig = vi.fn();
const mockRunEventRetention = vi.fn();

vi.mock('../lib/event-retention.js', () => ({
  resolveRetentionConfig: () => mockResolveRetentionConfig() as unknown,
  runEventRetention: (...args: unknown[]) => mockRunEventRetention(...args) as unknown,
}));

import { createRetentionWorker } from './retention.worker.js';

const fakeDb = {} as Parameters<typeof createRetentionWorker>[0];
const redis = { host: 'localhost', port: 6379 };

describe('event-retention worker', () => {
  beforeEach(() => {
    capturedProcessor = null;
    mockResolveRetentionConfig.mockReset();
    mockRunEventRetention.mockReset();
  });

  it('runs the sweep with the resolved config', async () => {
    mockResolveRetentionConfig.mockReturnValue({
      activityEventsRetentionDays: 180,
      webhookEventsRetentionDays: 30,
    });
    mockRunEventRetention.mockResolvedValue({
      activityEventsDeleted: 5,
      webhookEventsDeleted: 2,
      activityCutoff: new Date('2026-01-12T00:00:00.000Z'),
      webhookCutoff: new Date('2026-06-11T00:00:00.000Z'),
    });

    createRetentionWorker(fakeDb, redis);
    expect(capturedProcessor).not.toBeNull();

    await capturedProcessor!({ id: 'job-1' });

    expect(mockRunEventRetention).toHaveBeenCalledTimes(1);
    expect(mockRunEventRetention).toHaveBeenCalledWith(fakeDb, {
      activityEventsRetentionDays: 180,
      webhookEventsRetentionDays: 30,
    });
  });

  it('skips the sweep entirely when both windows are disabled', async () => {
    mockResolveRetentionConfig.mockReturnValue({
      activityEventsRetentionDays: 0,
      webhookEventsRetentionDays: 0,
    });

    createRetentionWorker(fakeDb, redis);
    await capturedProcessor!({ id: 'job-2' });

    expect(mockRunEventRetention).not.toHaveBeenCalled();
  });

  it('still sweeps when only one window is disabled', async () => {
    mockResolveRetentionConfig.mockReturnValue({
      activityEventsRetentionDays: 0,
      webhookEventsRetentionDays: 30,
    });
    mockRunEventRetention.mockResolvedValue({
      activityEventsDeleted: 0,
      webhookEventsDeleted: 4,
      activityCutoff: null,
      webhookCutoff: new Date('2026-06-11T00:00:00.000Z'),
    });

    createRetentionWorker(fakeDb, redis);
    await capturedProcessor!({ id: 'job-3' });

    expect(mockRunEventRetention).toHaveBeenCalledTimes(1);
  });
});
