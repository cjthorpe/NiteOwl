import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  appBaseUrl,
  assertEmailConfigured,
  buildPasswordResetEmail,
  EmailError,
  sendEmail,
} from './email.js';

// ---------------------------------------------------------------------------
// Env helpers — snapshot and restore the vars these functions read.
// ---------------------------------------------------------------------------

const EMAIL_ENV = ['RESEND_API_KEY', 'RESEND_FROM', 'APP_BASE_URL', 'CORS_ORIGIN'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of EMAIL_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of EMAIL_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// appBaseUrl
// ---------------------------------------------------------------------------

describe('appBaseUrl', () => {
  it('prefers APP_BASE_URL and strips a trailing slash', () => {
    process.env['APP_BASE_URL'] = 'https://app.niteowl.dev/';
    expect(appBaseUrl()).toBe('https://app.niteowl.dev');
  });

  it('falls back to CORS_ORIGIN when APP_BASE_URL is unset', () => {
    process.env['CORS_ORIGIN'] = 'https://web.example.com';
    expect(appBaseUrl()).toBe('https://web.example.com');
  });

  it('defaults to localhost when nothing is configured', () => {
    expect(appBaseUrl()).toBe('http://localhost:5173');
  });
});

// ---------------------------------------------------------------------------
// assertEmailConfigured
// ---------------------------------------------------------------------------

describe('assertEmailConfigured', () => {
  it('throws naming every missing var when transport is unconfigured', () => {
    expect(() => assertEmailConfigured()).toThrow(/RESEND_API_KEY/);
    expect(() => assertEmailConfigured()).toThrow(/RESEND_FROM/);
  });

  it('does not throw once both vars are present', () => {
    process.env['RESEND_API_KEY'] = 're_test_key';
    process.env['RESEND_FROM'] = 'NiteOwl <no-reply@niteowl.dev>';
    expect(() => assertEmailConfigured()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildPasswordResetEmail
// ---------------------------------------------------------------------------

describe('buildPasswordResetEmail', () => {
  const resetUrl = 'http://localhost:5173/reset-password?token=abc123';

  it('addresses the recipient and includes the reset URL in both bodies', () => {
    const msg = buildPasswordResetEmail('alice@example.com', resetUrl);
    expect(msg.to).toBe('alice@example.com');
    expect(msg.subject).toMatch(/reset/i);
    expect(msg.text).toContain(resetUrl);
    expect(msg.html).toContain(resetUrl);
  });

  it('mentions the 30-minute expiry window', () => {
    const msg = buildPasswordResetEmail('alice@example.com', resetUrl);
    expect(msg.text).toMatch(/30 minutes/i);
  });

  it('HTML-escapes a URL carrying special characters', () => {
    const dangerous = 'http://localhost:5173/reset-password?token=a&b"<x>';
    const msg = buildPasswordResetEmail('alice@example.com', dangerous);
    expect(msg.html).not.toContain('"<x>');
    expect(msg.html).toContain('&amp;');
    expect(msg.html).toContain('&quot;');
    expect(msg.html).toContain('&lt;x&gt;');
  });
});

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  const message = {
    to: 'alice@example.com',
    subject: 'Reset your NiteOwl password',
    text: 'reset link',
    html: '<p>reset link</p>',
  };

  function configure(): void {
    process.env['RESEND_API_KEY'] = 're_test_key';
    process.env['RESEND_FROM'] = 'NiteOwl <no-reply@niteowl.dev>';
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('throws (not sends) when transport is unconfigured', async () => {
    await expect(sendEmail(message)).rejects.toThrow(/not configured/i);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('posts to the Resend API with a bearer token and resolves on 200', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );

    const result = await sendEmail(message);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.id).toBe('msg_123');

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer re_test_key');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.to).toBe('alice@example.com');
    expect(sentBody.from).toBe('NiteOwl <no-reply@niteowl.dev>');
  });

  it('retries on a 5xx and succeeds on the next attempt', async () => {
    configure();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'm2' }), { status: 200 }));

    const result = await sendEmail(message);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a 4xx and throws a permanent EmailError', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid sender', { status: 422 }));

    const err = await sendEmail(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailError);
    if (err instanceof EmailError) {
      expect(err.permanent).toBe(true);
      expect(err.statusCode).toBe(422);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('throws EmailError after exhausting retries on persistent 5xx', async () => {
    configure();
    vi.mocked(fetch).mockResolvedValue(new Response('still down', { status: 500 }));

    await expect(sendEmail(message)).rejects.toBeInstanceOf(EmailError);
    // 1 initial + 2 retries = 3 attempts.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});
