// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isRepoAllowed } from '../../lib/repo-allowlist.js';

import { extractRepoFullName, verifyGitHubSignature } from './github.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-webhook-secret-abc123';

function sign(body: Buffer | string, secret = SECRET): string {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const hex = createHmac('sha256', secret).update(buf).digest('hex');
  return `sha256=${hex}`;
}

// ---------------------------------------------------------------------------
// verifyGitHubSignature
// ---------------------------------------------------------------------------

describe('verifyGitHubSignature', () => {
  it('returns true for a valid signature', () => {
    const body = Buffer.from('{"action":"opened"}');
    const sig = sign(body);
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(true);
  });

  it('returns false when signature is undefined', () => {
    const body = Buffer.from('{}');
    expect(verifyGitHubSignature(body, undefined, SECRET)).toBe(false);
  });

  it('returns false when signature prefix is missing', () => {
    const body = Buffer.from('{}');
    const hmac = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyGitHubSignature(body, hmac, SECRET)).toBe(false);
  });

  it('returns false for a tampered body', () => {
    const original = Buffer.from('{"action":"opened"}');
    const tampered = Buffer.from('{"action":"closed"}');
    const sig = sign(original);
    expect(verifyGitHubSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const body = Buffer.from('{"action":"opened"}');
    const sig = sign(body, 'correct-secret');
    expect(verifyGitHubSignature(body, sig, 'wrong-secret')).toBe(false);
  });

  it('is timing-safe: returns false when lengths differ', () => {
    const body = Buffer.from('{}');
    // Provide a valid-format but short signature
    expect(verifyGitHubSignature(body, 'sha256=abc', SECRET)).toBe(false);
  });

  it('accepts a real multi-byte body', () => {
    const body = Buffer.from(
      JSON.stringify({
        action: 'opened',
        pull_request: { id: 1, title: 'Test PR', number: 1 },
        repository: { full_name: 'acme/app' },
      }),
    );
    const sig = sign(body);
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractRepoFullName — webhook repo extraction (FUL-82)
// ---------------------------------------------------------------------------

describe('extractRepoFullName', () => {
  it('extracts repository.full_name from a repo-scoped payload', () => {
    expect(extractRepoFullName({ repository: { full_name: 'acme/app' } })).toBe('acme/app');
  });

  it('returns undefined when there is no repository (e.g. ping)', () => {
    expect(extractRepoFullName({ zen: 'Keep it logically awesome.' })).toBeUndefined();
  });

  it('returns undefined when full_name is missing or non-string', () => {
    expect(extractRepoFullName({ repository: {} })).toBeUndefined();
    expect(extractRepoFullName({ repository: { full_name: 42 } })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Webhook ingestion drop decision (FUL-82)
//
// The handler drops before enqueue when a repo-scoped event's repository is
// not on the integration allowlist. This mirrors that decision: a payload is
// ingested when it has no repository OR the repo is allowed.
// ---------------------------------------------------------------------------

describe('webhook allowlist drop decision', () => {
  const ingests = (
    config: { repoAllowlist?: unknown } | null,
    payload: Record<string, unknown>,
  ) => {
    const repo = extractRepoFullName(payload);
    return repo === undefined || isRepoAllowed(config, repo);
  };

  it('ingests every repo when no allowlist is set', () => {
    expect(ingests(null, { repository: { full_name: 'paperclipai/paperclip' } })).toBe(true);
  });

  it('drops a repo-scoped event when its repo is not on the allowlist', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(ingests(config, { repository: { full_name: 'paperclipai/paperclip' } })).toBe(false);
  });

  it('ingests a repo-scoped event when its repo is on the allowlist (case-insensitive)', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(ingests(config, { repository: { full_name: 'ACME/App' } })).toBe(true);
  });

  it('leaves repo-less events (e.g. ping) for the normalizer even with an allowlist', () => {
    const config = { repoAllowlist: ['acme/app'] };
    expect(ingests(config, { zen: 'Anything you build will inevitably break.' })).toBe(true);
  });
});
