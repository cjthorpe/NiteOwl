import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGitHubSignature } from './github.js';

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
