// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/**
 * Client for the self-service password reset flow (FUL-86).
 *
 * Contract (FUL-85 / apps/api/src/routes/auth/password-reset.ts):
 *   POST /auth/forgot-password  body { email }
 *     → always 200 { success, data: { message }, error: null }
 *   POST /auth/reset-password   body { token, password }  (password 8–72 chars)
 *     → 200 { success: true, data: { message } }
 *     → 400 { success: false, error: 'Invalid or expired reset token' }
 */

/** Password length bounds — must match the register/reset API rule (bcrypt's 72-byte ceiling). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string | null;
}

/**
 * Request a reset link for an email address.
 *
 * Resolves on any HTTP response — including 429 (rate limited) — because the UI
 * must show an identical generic confirmation regardless of whether the account
 * exists or the request was throttled, to avoid account enumeration. Only a
 * genuine network failure rejects, so the caller can offer a retry.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await fetch(`${API_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export type ResetPasswordResult = { ok: true; message: string } | { ok: false; error: string };

/** Fallback message when the API returns an error without a body we can read. */
const GENERIC_RESET_ERROR = 'Invalid or expired reset token.';

/**
 * Redeem a reset token and set a new password. Distinguishes success from an
 * invalid/expired token so the reset screen can route to login on success or
 * surface a re-request prompt on failure.
 */
export async function resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    return { ok: false, error: 'Network error — please check your connection and try again.' };
  }

  let body: ApiEnvelope<{ message: string }> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<{ message: string }>;
  } catch {
    // Non-JSON response (e.g. a proxy error page); fall through to status check.
  }

  if (res.ok && body?.success) {
    return { ok: true, message: body.data?.message ?? 'Your password has been reset.' };
  }

  return { ok: false, error: body?.error ?? GENERIC_RESET_ERROR };
}
