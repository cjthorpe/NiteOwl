// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import { allowedOrigins, isOriginAllowed } from './origin-check.js';

describe('allowedOrigins', () => {
  it('derives origins from CORS_ORIGIN (single value)', () => {
    const set = allowedOrigins({ CORS_ORIGIN: 'https://app.niteowl.dev' } as NodeJS.ProcessEnv);
    expect([...set]).toEqual(['https://app.niteowl.dev']);
  });

  it('parses a comma-separated CORS_ORIGIN list', () => {
    const set = allowedOrigins({
      CORS_ORIGIN: 'https://app.niteowl.dev, https://staging.niteowl.dev',
    } as NodeJS.ProcessEnv);
    expect(set.has('https://app.niteowl.dev')).toBe(true);
    expect(set.has('https://staging.niteowl.dev')).toBe(true);
  });

  it('includes WEB_URL and normalizes to origin (strips path)', () => {
    const set = allowedOrigins({
      WEB_URL: 'https://app.niteowl.dev/dashboard',
    } as NodeJS.ProcessEnv);
    expect(set.has('https://app.niteowl.dev')).toBe(true);
  });

  it('merges CORS_ORIGIN and WEB_URL, de-duplicating', () => {
    const set = allowedOrigins({
      CORS_ORIGIN: 'https://app.niteowl.dev',
      WEB_URL: 'https://app.niteowl.dev',
    } as NodeJS.ProcessEnv);
    expect([...set]).toEqual(['https://app.niteowl.dev']);
  });

  it('falls back to the dev SPA origin when nothing is configured', () => {
    const set = allowedOrigins({} as NodeJS.ProcessEnv);
    expect([...set]).toEqual(['http://localhost:5173']);
  });

  it('ignores unparseable entries', () => {
    const set = allowedOrigins({ CORS_ORIGIN: 'not a url' } as NodeJS.ProcessEnv);
    // Nothing parseable → dev fallback.
    expect([...set]).toEqual(['http://localhost:5173']);
  });
});

describe('isOriginAllowed', () => {
  const allowed = new Set(['https://app.niteowl.dev']);

  it('allows a request whose Origin is on the allowlist', () => {
    expect(isOriginAllowed({ origin: 'https://app.niteowl.dev' }, allowed)).toBe(true);
  });

  it('rejects a request whose Origin is not on the allowlist', () => {
    expect(isOriginAllowed({ origin: 'https://evil.example' }, allowed)).toBe(false);
  });

  it('compares only the origin, ignoring path/query on Origin', () => {
    // Browsers never send a path in Origin, but be robust: only origin matters.
    expect(isOriginAllowed({ origin: 'https://app.niteowl.dev/x?y=1' }, allowed)).toBe(true);
  });

  it('rejects opaque `Origin: null` (sandboxed/redirected contexts)', () => {
    expect(isOriginAllowed({ origin: 'null' }, allowed)).toBe(false);
  });

  it('falls back to Referer when Origin is absent — allowed origin passes', () => {
    expect(isOriginAllowed({ referer: 'https://app.niteowl.dev/login' }, allowed)).toBe(true);
  });

  it('falls back to Referer when Origin is absent — foreign origin rejected', () => {
    expect(isOriginAllowed({ referer: 'https://evil.example/login' }, allowed)).toBe(false);
  });

  it('prefers Origin over Referer when both are present', () => {
    // Foreign Origin must reject even if Referer happens to be allowlisted.
    expect(
      isOriginAllowed(
        { origin: 'https://evil.example', referer: 'https://app.niteowl.dev/login' },
        allowed,
      ),
    ).toBe(false);
  });

  it('allows when neither Origin nor Referer is present (non-browser client)', () => {
    expect(isOriginAllowed({}, allowed)).toBe(true);
  });
});
