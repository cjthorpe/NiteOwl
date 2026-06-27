// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import { isRepoAllowed, parseRepoAllowlist } from './repo-allowlist.js';

// ---------------------------------------------------------------------------
// parseRepoAllowlist
// ---------------------------------------------------------------------------

describe('parseRepoAllowlist', () => {
  it('returns [] for null / undefined config', () => {
    expect(parseRepoAllowlist(null)).toEqual([]);
    expect(parseRepoAllowlist(undefined)).toEqual([]);
  });

  it('returns [] when repoAllowlist is missing or not an array', () => {
    expect(parseRepoAllowlist({})).toEqual([]);
    expect(parseRepoAllowlist({ repoAllowlist: 'acme/app' })).toEqual([]);
    expect(parseRepoAllowlist({ repoAllowlist: 42 })).toEqual([]);
  });

  it('lower-cases, trims, and drops blank / non-string entries', () => {
    expect(
      parseRepoAllowlist({
        repoAllowlist: ['  Acme/App  ', '', '   ', 7, null, 'OTHER/Repo'],
      }),
    ).toEqual(['acme/app', 'other/repo']);
  });

  it('de-duplicates case-insensitively', () => {
    expect(parseRepoAllowlist({ repoAllowlist: ['acme/app', 'ACME/APP'] })).toEqual(['acme/app']);
  });
});

// ---------------------------------------------------------------------------
// isRepoAllowed
// ---------------------------------------------------------------------------

describe('isRepoAllowed', () => {
  it('allows all when no allowlist is configured (backward-compatible)', () => {
    expect(isRepoAllowed(null, 'acme/app')).toBe(true);
    expect(isRepoAllowed({}, 'acme/app')).toBe(true);
    expect(isRepoAllowed({ repoAllowlist: [] }, 'paperclipai/paperclip')).toBe(true);
  });

  it('allows an exact match (case-insensitive)', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(isRepoAllowed(config, 'acme/app')).toBe(true);
    expect(isRepoAllowed(config, 'ACME/App')).toBe(true);
  });

  it('rejects a repo not on the list', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(isRepoAllowed(config, 'paperclipai/paperclip')).toBe(false);
    expect(isRepoAllowed(config, 'acme/other')).toBe(false);
  });

  it('supports org-wide wildcards (owner/*)', () => {
    const config = { repoAllowlist: ['acme/*'] };
    expect(isRepoAllowed(config, 'acme/app')).toBe(true);
    expect(isRepoAllowed(config, 'ACME/anything')).toBe(true);
    expect(isRepoAllowed(config, 'other/app')).toBe(false);
  });

  it('does not let a wildcard owner match a different owner prefix', () => {
    const config = { repoAllowlist: ['acme/*'] };
    expect(isRepoAllowed(config, 'acme-corp/app')).toBe(false);
  });

  it('rejects missing / malformed repo names when an allowlist is active', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(isRepoAllowed(config, null)).toBe(false);
    expect(isRepoAllowed(config, undefined)).toBe(false);
    expect(isRepoAllowed(config, '')).toBe(false);
  });

  it('allows missing repo names when no allowlist is active', () => {
    expect(isRepoAllowed(null, null)).toBe(true);
    expect(isRepoAllowed({ repoAllowlist: [] }, undefined)).toBe(true);
  });
});
