// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

import { eventReads } from './schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../migrations');

describe('event_reads table (schema)', () => {
  it('defines id, userId, eventId and readAt columns', () => {
    expect(eventReads.id).toBeDefined();
    expect(eventReads.userId.name).toBe('user_id');
    expect(eventReads.eventId.name).toBe('event_id');
    expect(eventReads.readAt.name).toBe('read_at');
  });

  it('marks userId, eventId and readAt as NOT NULL', () => {
    expect(eventReads.userId.notNull).toBe(true);
    expect(eventReads.eventId.notNull).toBe(true);
    expect(eventReads.readAt.notNull).toBe(true);
  });
});

describe('0010_event_reads migration', () => {
  const sql = readFileSync(path.join(migrationsDir, '0010_event_reads.sql'), 'utf8');

  it('creates the event_reads table', () => {
    expect(sql).toMatch(/CREATE TABLE "event_reads"/);
  });

  it('enforces a UNIQUE (user_id, event_id) constraint for idempotent marks', () => {
    expect(sql).toMatch(
      /CONSTRAINT "event_reads_user_id_event_id_uniq" UNIQUE\("user_id","event_id"\)/,
    );
  });

  it('cascades both foreign keys on delete', () => {
    expect(sql).toMatch(
      /"event_reads_user_id_users_id_fk".*REFERENCES "public"\."users".*ON DELETE cascade/s,
    );
    expect(sql).toMatch(
      /"event_reads_event_id_activity_events_id_fk".*REFERENCES "public"\."activity_events".*ON DELETE cascade/s,
    );
  });

  it('indexes user_id to back unread counts / existence joins', () => {
    expect(sql).toMatch(/CREATE INDEX "event_reads_user_id_idx" ON "event_reads"/);
  });

  it('is registered as idx 10 in the migration journal', () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.tag === '0010_event_reads');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(10);
  });
});
