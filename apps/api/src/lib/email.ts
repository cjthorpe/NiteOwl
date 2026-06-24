/**
 * Outbound email service.
 *
 * Provider-agnostic sender abstraction so the transport is swappable without
 * touching call sites. The default backend is Resend (HTTPS JSON API — no SMTP
 * connection management), selected because it mirrors the existing slack-alert
 * delivery style (fetch → retry transient failures → throw on permanent).
 *
 * Configuration (env):
 *   EMAIL_PROVIDER   — 'resend' (default). Reserved for future SMTP backend.
 *   RESEND_API_KEY   — Resend API key. Required to actually send.
 *   RESEND_FROM      — verified "From" address, e.g. "NiteOwl <no-reply@…>".
 *   APP_BASE_URL     — web origin used to build links (falls back to
 *                      CORS_ORIGIN, then http://localhost:5173).
 *
 * No secrets are committed — these are read from the environment at send time.
 * This module has NO Fastify dependency so it can be called from route handlers
 * or background workers alike.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body — always provided as the accessible fallback. */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

export interface SendEmailResult {
  ok: true;
  attempts: number;
  /** Provider message id, when the backend returns one. */
  id?: string;
}

export class EmailError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly attempts: number,
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Web origin used to build user-facing links (e.g. the reset URL). */
export function appBaseUrl(): string {
  return (
    process.env['APP_BASE_URL'] ??
    process.env['CORS_ORIGIN'] ??
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}

/**
 * Assert email transport is configured. Call once at startup in production so
 * the service fails fast instead of silently dropping reset emails. In
 * development/test the env vars are optional — sendEmail throws a clear error
 * only if it is actually invoked without configuration.
 */
export function assertEmailConfigured(): void {
  const missing: string[] = [];
  if (!process.env['RESEND_API_KEY']) missing.push('RESEND_API_KEY');
  if (!process.env['RESEND_FROM']) missing.push('RESEND_FROM');
  if (missing.length > 0) {
    throw new Error(`Email transport not configured — missing env: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

/**
 * Send an email via the configured provider.
 *
 * Retries up to {@link MAX_RETRIES} times on transient (5xx / network) errors
 * with linear back-off. Throws {@link EmailError} on permanent failure (4xx) or
 * after exhausting retries. Throws a plain Error if transport is unconfigured.
 */
export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['RESEND_FROM'];
  if (!apiKey || !from) {
    assertEmailConfigured(); // throws with the precise missing var(s)
  }

  const payload = {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html !== undefined ? { html: message.html } : {}),
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey ?? ''}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, attempts: attempt, ...(body.id ? { id: body.id } : {}) };
      }

      // 4xx — permanent (bad key, unverified sender, invalid recipient). Don't
      // retry. Never include the response body verbatim in a thrown message
      // that could surface upstream — keep it to status + provider text only.
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text().catch(() => '');
        throw new EmailError(
          `Email provider returned ${response.status}: ${body}`,
          response.status,
          attempt,
          /* permanent */ true,
        );
      }

      // 5xx — transient; fall through to retry.
      const body = await response.text().catch(() => '');
      lastError = new EmailError(
        `Email provider returned ${response.status}: ${body}`,
        response.status,
        attempt,
        false,
      );
    } catch (err) {
      if (err instanceof EmailError && err.permanent) throw err;
      lastError = err;
    }

    if (attempt <= MAX_RETRIES) {
      await sleep(attempt * RETRY_DELAY_MS);
    }
  }

  throw new EmailError(
    `Email send failed after ${MAX_RETRIES + 1} attempts: ${String(lastError)}`,
    0,
    MAX_RETRIES + 1,
    false,
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Build the password-reset email. The reset link points the user at the web
 * app's reset page with the raw token as a query param.
 */
export function buildPasswordResetEmail(to: string, resetUrl: string): EmailMessage {
  const subject = 'Reset your NiteOwl password';
  const text = [
    'We received a request to reset your NiteOwl password.',
    '',
    'Reset it using the link below (valid for 30 minutes):',
    resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email — your",
    'password will not change.',
  ].join('\n');

  const safeUrl = escapeHtml(resetUrl);
  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">',
    '<h2 style="margin:0 0 16px">Reset your NiteOwl password</h2>',
    '<p>We received a request to reset your NiteOwl password.</p>',
    `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Reset password</a></p>`,
    '<p style="color:#555;font-size:14px">This link is valid for 30 minutes. If the button does not work, paste this URL into your browser:</p>',
    `<p style="word-break:break-all;font-size:13px;color:#555">${safeUrl}</p>`,
    '<p style="color:#555;font-size:14px">If you didn\'t request this, you can safely ignore this email — your password will not change.</p>',
    '</div>',
  ].join('');

  return { to, subject, text, html };
}

/** Minimal HTML escaping for values interpolated into email markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
