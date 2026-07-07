// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { AuthButton } from '../../components/auth/AuthButton';
import { AuthField } from '../../components/auth/AuthField';
import { AuthShell } from '../../components/auth/AuthShell';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, resetPassword } from '../../lib/password-reset';

type Status = 'idle' | 'submitting' | 'tokenError';

const linkStyle = { color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' };

/** Local field-level validation mirroring the API rule (8–72 chars) + confirm match. */
function validate(password: string, confirm: string): { password?: string; confirm?: string } {
  const errors: { password?: string; confirm?: string } = {};
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (confirm !== password) {
    errors.confirm = 'Passwords do not match.';
  }
  return errors;
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Field errors are only surfaced after the first submit attempt to avoid
  // shouting at the user while they are still typing.
  const [showErrors, setShowErrors] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const reRequestFooter = (
    <Link to="/forgot-password" style={linkStyle}>
      Request a new reset link
    </Link>
  );

  // No token in the URL → the link was malformed or truncated. Send the user
  // straight to re-request rather than letting them fill out a doomed form.
  if (!token) {
    return (
      <AuthShell
        title="Invalid reset link"
        subtitle="This password reset link is missing or incomplete."
        footer={reRequestFooter}
      >
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            lineHeight: 1.6,
          }}
        >
          Reset links expire after 30 minutes and can only be used once. Request a fresh link to
          continue.
        </p>
      </AuthShell>
    );
  }

  if (status === 'tokenError') {
    return (
      <AuthShell
        title="Link expired"
        subtitle="This reset link is no longer valid."
        footer={reRequestFooter}
      >
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            lineHeight: 1.6,
          }}
        >
          {submitError ?? 'Invalid or expired reset token.'} Reset links expire after 30 minutes and
          can only be used once.
        </p>
      </AuthShell>
    );
  }

  const fieldErrors = validate(password, confirm);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;

    setShowErrors(true);
    setSubmitError(null);
    if (fieldErrors.password || fieldErrors.confirm) return;

    setStatus('submitting');
    const result = await resetPassword(token, password);

    if (result.ok) {
      // Hand the success notice to the login screen and route there.
      void navigate('/login', { replace: true, state: { notice: result.message } });
      return;
    }

    // Distinguish a bad/expired token (terminal — offer re-request) from a
    // transient error the user can retry in place.
    if (/invalid|expired|token/i.test(result.error)) {
      setSubmitError(result.error);
      setStatus('tokenError');
    } else {
      setSubmitError(result.error);
      setStatus('idle');
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your new password must be 8–72 characters."
      footer={
        <Link to="/login" style={linkStyle}>
          Back to sign in
        </Link>
      }
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <AuthField
          ref={passwordRef}
          id="reset-password"
          label="New password"
          type="password"
          name="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          disabled={status === 'submitting'}
          invalid={showErrors && Boolean(fieldErrors.password)}
          errorId="reset-password-error"
        />
        {showErrors && fieldErrors.password && (
          <p
            id="reset-password-error"
            role="alert"
            style={{
              margin: 'calc(-1 * var(--space-2)) 0 0',
              color: 'var(--color-danger)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {fieldErrors.password}
          </p>
        )}

        <AuthField
          id="reset-confirm"
          label="Confirm new password"
          type="password"
          name="confirm-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          disabled={status === 'submitting'}
          invalid={showErrors && Boolean(fieldErrors.confirm)}
          errorId="reset-confirm-error"
        />
        {showErrors && fieldErrors.confirm && (
          <p
            id="reset-confirm-error"
            role="alert"
            style={{
              margin: 'calc(-1 * var(--space-2)) 0 0',
              color: 'var(--color-danger)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {fieldErrors.confirm}
          </p>
        )}

        {submitError && status === 'idle' && (
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}
          >
            {submitError}
          </p>
        )}

        <AuthButton type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Resetting…' : 'Reset password'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
