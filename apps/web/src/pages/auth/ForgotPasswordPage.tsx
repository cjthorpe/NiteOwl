import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthButton } from '../../components/auth/AuthButton';
import { AuthField } from '../../components/auth/AuthField';
import { AuthShell } from '../../components/auth/AuthShell';
import { requestPasswordReset } from '../../lib/password-reset';

type Status = 'idle' | 'submitting' | 'sent' | 'error';

/**
 * Identical confirmation shown on success regardless of whether the account
 * exists, to prevent account enumeration (mirrors the API's generic 200).
 */
const CONFIRMATION = "If an account exists for that email, we've sent a reset link.";

const linkStyle = { color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' };

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;

    setStatus('submitting');
    try {
      await requestPasswordReset(email.trim());
      setStatus('sent');
    } catch {
      // Only genuine network failures land here — the API returns 200 for both
      // existing and unknown accounts, so any HTTP response is treated as sent.
      setStatus('error');
    }
  }

  const backToLogin = (
    <Link to="/login" style={linkStyle}>
      Back to sign in
    </Link>
  );

  if (status === 'sent') {
    return (
      <AuthShell title="Check your email" footer={backToLogin}>
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            lineHeight: 1.6,
          }}
        >
          {CONFIRMATION}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
          }}
        >
          The link expires in 30 minutes. Didn&apos;t get it? Check your spam folder, or{' '}
          <button
            type="button"
            onClick={() => {
              setStatus('idle');
              requestAnimationFrame(() => emailRef.current?.focus());
            }}
            style={{
              ...linkStyle,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
          >
            try a different email
          </button>
          .
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email for your account and we'll send you a link to choose a new password."
      footer={backToLogin}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
      >
        <AuthField
          ref={emailRef}
          id="forgot-email"
          label="Email address"
          type="email"
          name="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={status === 'submitting'}
        />

        {status === 'error' && (
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}
          >
            Something went wrong sending the link. Please check your connection and try again.
          </p>
        )}

        <AuthButton type="submit" disabled={status === 'submitting' || email.trim().length === 0}>
          {status === 'submitting' ? 'Sending…' : 'Send reset link'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
