// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import {
  EXPIRY_OPTIONS,
  MAX_NAME_LENGTH,
  formatExpiry,
  formatLastUsed,
  validateTokenName,
} from './tokens';

/**
 * The PAT panel helpers (FUL-93) drive expiry/last-used display and client-side
 * name validation. These pin the contract so the UI matches the FUL-91 backend
 * bounds (name 1..100 chars, expiry up to 365 days) and never mislabels a token.
 */

const NOW = new Date('2026-06-26T12:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('formatExpiry', () => {
  it('reports a null expiry as never expiring', () => {
    expect(formatExpiry(null, NOW)).toEqual({
      label: 'Never expires',
      tone: 'neutral',
      isExpired: false,
    });
  });

  it('flags a past expiry as expired/danger', () => {
    const result = formatExpiry(new Date(NOW - DAY).toISOString(), NOW);
    expect(result).toEqual({ label: 'Expired', tone: 'danger', isExpired: true });
  });

  it('warns when expiry is within a week', () => {
    const result = formatExpiry(new Date(NOW + 3 * DAY).toISOString(), NOW);
    expect(result.label).toBe('Expires in 3 days');
    expect(result.tone).toBe('warning');
    expect(result.isExpired).toBe(false);
  });

  it('stays neutral when expiry is comfortably far off', () => {
    const result = formatExpiry(new Date(NOW + 30 * DAY).toISOString(), NOW);
    expect(result.label).toBe('Expires in 30 days');
    expect(result.tone).toBe('neutral');
  });

  it('singularises a one-day expiry', () => {
    expect(formatExpiry(new Date(NOW + DAY + 1000).toISOString(), NOW).label).toBe(
      'Expires in 1 day',
    );
  });

  it('falls back to hours under a day', () => {
    const result = formatExpiry(new Date(NOW + 5 * 60 * 60 * 1000).toISOString(), NOW);
    expect(result.label).toBe('Expires in 5 hours');
    expect(result.tone).toBe('warning');
  });
});

describe('formatLastUsed', () => {
  it('reports never-used tokens', () => {
    expect(formatLastUsed(null, NOW)).toBe('Never used');
  });

  it('formats recent usage in minutes/hours/days', () => {
    expect(formatLastUsed(new Date(NOW - 30 * 1000).toISOString(), NOW)).toBe('Used just now');
    expect(formatLastUsed(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW)).toBe('Used 5m ago');
    expect(formatLastUsed(new Date(NOW - 3 * 60 * 60 * 1000).toISOString(), NOW)).toBe(
      'Used 3h ago',
    );
    expect(formatLastUsed(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe('Used 2d ago');
  });
});

describe('validateTokenName', () => {
  it('rejects blank names', () => {
    expect(validateTokenName('')).not.toBeNull();
    expect(validateTokenName('   ')).not.toBeNull();
  });

  it('rejects names over the backend max length', () => {
    expect(validateTokenName('a'.repeat(MAX_NAME_LENGTH + 1))).not.toBeNull();
  });

  it('accepts a trimmed, in-bounds name', () => {
    expect(validateTokenName('  CI pipeline  ')).toBeNull();
    expect(validateTokenName('a'.repeat(MAX_NAME_LENGTH))).toBeNull();
  });
});

describe('EXPIRY_OPTIONS', () => {
  it('defaults to 30 days and offers a no-expiry choice within backend bounds', () => {
    expect(EXPIRY_OPTIONS[0]).toEqual({ label: '30 days', days: 30 });
    expect(EXPIRY_OPTIONS.some((o) => o.days === null)).toBe(true);
    for (const opt of EXPIRY_OPTIONS) {
      if (opt.days !== null) expect(opt.days).toBeLessThanOrEqual(365);
    }
  });
});
