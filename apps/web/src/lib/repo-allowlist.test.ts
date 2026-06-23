import { describe, expect, it } from 'vitest';
import {
  allowlistsEqual,
  isValidEntry,
  isWildcardEntry,
  normalizeAllowlist,
  normalizeEntry,
  splitInput,
} from './repo-allowlist';

/**
 * The client allowlist helpers (FUL-83) must mirror the backend's normalization
 * (trim → lowercase → dedupe) and accept exactly the entry shapes the backend
 * matcher supports (`owner/repo`, `owner/*`). These tests pin that contract so
 * the UI preview never drifts from what the server stores.
 */

describe('normalizeEntry', () => {
  it('trims and lowercases', () => {
    expect(normalizeEntry('  Owner/Repo  ')).toBe('owner/repo');
    expect(normalizeEntry('ACME/*')).toBe('acme/*');
  });
});

describe('isValidEntry', () => {
  it('accepts owner/repo and owner/* (normalized)', () => {
    expect(isValidEntry('owner/repo')).toBe(true);
    expect(isValidEntry('owner/*')).toBe(true);
    expect(isValidEntry('my-org/my.repo_name')).toBe(true);
    expect(isValidEntry('a1/b2')).toBe(true);
  });

  it('rejects malformed entries', () => {
    expect(isValidEntry('')).toBe(false);
    expect(isValidEntry('owner')).toBe(false); // no slash
    expect(isValidEntry('owner/')).toBe(false); // empty repo
    expect(isValidEntry('/repo')).toBe(false); // empty owner
    expect(isValidEntry('owner/repo/extra')).toBe(false); // too many segments
    expect(isValidEntry('owner repo')).toBe(false); // space
    expect(isValidEntry('*/repo')).toBe(false); // owner wildcard unsupported
    expect(isValidEntry('-owner/repo')).toBe(false); // leading hyphen owner
  });

  it('expects already-lowercased input (callers normalize first)', () => {
    // Uppercase fails by design — validation runs on normalized values.
    expect(isValidEntry('Owner/Repo')).toBe(false);
    expect(isValidEntry(normalizeEntry('Owner/Repo'))).toBe(true);
  });
});

describe('isWildcardEntry', () => {
  it('detects org-wide wildcards', () => {
    expect(isWildcardEntry('owner/*')).toBe(true);
    expect(isWildcardEntry('owner/repo')).toBe(false);
  });
});

describe('normalizeAllowlist', () => {
  it('normalizes, drops blanks, and dedupes preserving order', () => {
    expect(normalizeAllowlist(['B/Y', 'a/x', '  ', 'A/X', 'b/y'])).toEqual(['b/y', 'a/x']);
  });

  it('returns [] for an empty list (allow-all default)', () => {
    expect(normalizeAllowlist([])).toEqual([]);
  });
});

describe('splitInput', () => {
  it('splits on commas, whitespace, and newlines', () => {
    expect(splitInput('a/b, c/d\ne/f  g/*')).toEqual(['a/b', 'c/d', 'e/f', 'g/*']);
  });

  it('drops empty fragments', () => {
    expect(splitInput('  ,, \n ')).toEqual([]);
  });
});

describe('allowlistsEqual', () => {
  it('compares as normalized sets, order-insensitive', () => {
    expect(allowlistsEqual(['a/b', 'c/d'], ['C/D', 'A/B'])).toBe(true);
    expect(allowlistsEqual([], [])).toBe(true);
    expect(allowlistsEqual(['a/b'], [])).toBe(false);
    expect(allowlistsEqual(['a/b', 'c/d'], ['a/b'])).toBe(false);
  });
});
