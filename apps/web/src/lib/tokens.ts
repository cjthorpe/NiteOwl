// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Pure presentation helpers for the Personal Access Token panel (FUL-93).
 *
 * Kept separate from `tokens-api.ts` (which performs network calls) so the
 * expiry/last-used formatting and the create-form expiry presets can be unit
 * tested without mocking fetch — mirroring the `repo-allowlist.ts` /
 * `integrations-api.ts` split from FUL-83.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/** Backend's hard ceiling on a token lifetime (see tokens route). */
export const MAX_EXPIRES_IN_DAYS = 365;
/** Backend's max token name length (see tokens route). */
export const MAX_NAME_LENGTH = 100;

/** A selectable expiry preset for the create form. `days: null` = no expiry. */
export interface ExpiryOption {
  label: string;
  days: number | null;
}

/**
 * Expiry presets offered in the create form. The default (first) is 30 days —
 * a sensible balance between convenience and limiting the blast radius of a
 * leaked token. "No expiry" is offered last and intentionally de-emphasised.
 */
export const EXPIRY_OPTIONS: readonly ExpiryOption[] = [
  { label: '30 days', days: 30 },
  { label: '7 days', days: 7 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'No expiry', days: null },
];

export type ExpiryTone = 'neutral' | 'warning' | 'danger';

export interface ExpiryStatus {
  label: string;
  tone: ExpiryTone;
  isExpired: boolean;
}

/**
 * Human-readable status for a token's `expiresAt`. Tokens expiring within a
 * week are flagged `warning` so the user can rotate them ahead of time; already
 * expired tokens are `danger`. A `null` expiry reads "Never expires".
 */
export function formatExpiry(expiresAt: string | null, now: number = Date.now()): ExpiryStatus {
  if (expiresAt === null) {
    return { label: 'Never expires', tone: 'neutral', isExpired: false };
  }

  const diff = new Date(expiresAt).getTime() - now;

  if (diff <= 0) {
    return { label: 'Expired', tone: 'danger', isExpired: true };
  }

  const days = Math.floor(diff / MS_PER_DAY);
  const tone: ExpiryTone = days < 7 ? 'warning' : 'neutral';

  if (days >= 1) {
    return { label: `Expires in ${days} day${days === 1 ? '' : 's'}`, tone, isExpired: false };
  }

  const hours = Math.max(1, Math.floor(diff / MS_PER_HOUR));
  return { label: `Expires in ${hours} hour${hours === 1 ? '' : 's'}`, tone, isExpired: false };
}

/** "Never used" when a token has never authenticated, else a relative time. */
export function formatLastUsed(lastUsedAt: string | null, now: number = Date.now()): string {
  if (lastUsedAt === null) return 'Never used';

  const diff = now - new Date(lastUsedAt).getTime();
  if (diff < MS_PER_HOUR) {
    const minutes = Math.floor(diff / (60 * 1000));
    if (minutes < 1) return 'Used just now';
    return `Used ${minutes}m ago`;
  }
  if (diff < MS_PER_DAY) {
    return `Used ${Math.floor(diff / MS_PER_HOUR)}h ago`;
  }
  const days = Math.floor(diff / MS_PER_DAY);
  return `Used ${days}d ago`;
}

/**
 * Validate a token name client-side, matching the backend's `minLength: 1`,
 * `maxLength: 100` after trimming. Returns an error string, or null if valid.
 */
export function validateTokenName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'Give the token a name so you can recognise it later.';
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  return null;
}
