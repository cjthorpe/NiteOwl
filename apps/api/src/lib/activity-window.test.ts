// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  resolveActivityWindow,
} from './activity-window.js';

const NOW = Date.parse('2026-07-06T09:00:00.000Z');

describe('resolveActivityWindow', () => {
  it('filters on ingested_at for since=last_login (FUL-142)', () => {
    // User last logged in yesterday evening; a 06:00 catch-up backfilled events
    // that occurred earlier. The window must key off ingestion so those events
    // are not silently dropped from the morning briefing.
    const lastSeen = '2026-07-05T20:00:00.000Z';
    const w = resolveActivityWindow({ since: 'last_login' }, lastSeen, NOW);

    expect(w.byIngestion).toBe(true);
    expect(w.since.toISOString()).toBe(lastSeen);
    expect(w.hours).toBe(13);
  });

  it('filters on occurred_at for the hours window (dashboard last-24h)', () => {
    const w = resolveActivityWindow({ hours: '24' }, '2026-07-05T20:00:00.000Z', NOW);

    expect(w.byIngestion).toBe(false);
    expect(w.hours).toBe(24);
    expect(w.since.toISOString()).toBe('2026-07-05T09:00:00.000Z');
  });

  it('falls back to the default occurred_at window when last_login has no lastSeenAt', () => {
    const w = resolveActivityWindow({ since: 'last_login' }, null, NOW);

    expect(w.byIngestion).toBe(false);
    expect(w.hours).toBe(DEFAULT_WINDOW_HOURS);
  });

  it('clamps an over-large hours value to the maximum', () => {
    const w = resolveActivityWindow({ hours: '999' }, null, NOW);
    expect(w.hours).toBe(MAX_WINDOW_HOURS);
    expect(w.byIngestion).toBe(false);
  });

  it('falls back to the default for a non-numeric or sub-hour value', () => {
    expect(resolveActivityWindow({ hours: 'abc' }, null, NOW).hours).toBe(DEFAULT_WINDOW_HOURS);
    expect(resolveActivityWindow({ hours: '0' }, null, NOW).hours).toBe(DEFAULT_WINDOW_HOURS);
  });

  it('never returns a sub-1-hour window for a same-instant last_login', () => {
    const w = resolveActivityWindow({ since: 'last_login' }, new Date(NOW).toISOString(), NOW);
    expect(w.hours).toBe(1);
    expect(w.byIngestion).toBe(true);
  });
});
