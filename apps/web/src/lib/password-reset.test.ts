// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPasswordReset, resetPassword } from './password-reset';

/**
 * Coverage for the FUL-86 password reset client.
 *
 * forgot-password must never reject on an HTTP response (enumeration safety),
 * and reset-password must cleanly separate the success path from an
 * invalid/expired-token failure.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestPasswordReset', () => {
  it('POSTs the email to /auth/forgot-password', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: { message: 'ok' }, error: null }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await requestPasswordReset('user@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/auth/forgot-password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'user@example.com' });
  });

  it('resolves on a 429 rate-limit response (no enumeration leak)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'Too Many Requests' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestPasswordReset('user@example.com')).resolves.toBeUndefined();
  });

  it('rejects on a genuine network failure so the caller can retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestPasswordReset('user@example.com')).rejects.toThrow();
  });
});

describe('resetPassword', () => {
  it('returns the success message on a 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { message: 'Password has been reset. Please sign in with your new password.' },
        error: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetPassword('raw-token', 'newpassword1');

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('reset') });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'raw-token',
      password: 'newpassword1',
    });
  });

  it('returns the API error on an invalid/expired token (400)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { success: false, error: 'Invalid or expired reset token' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetPassword('stale', 'newpassword1');

    expect(result).toEqual({ ok: false, error: 'Invalid or expired reset token' });
  });

  it('falls back to a generic error when the body is unreadable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('<html>502</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetPassword('x', 'newpassword1');

    expect(result.ok).toBe(false);
  });

  it('returns a network error result when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await resetPassword('x', 'newpassword1');

    expect(result).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
  });
});
