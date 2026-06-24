import type { ReactNode } from 'react';

interface AuthShellProps {
  /** Short heading shown under the NiteOwl wordmark (e.g. "Reset your password"). */
  title: string;
  /** Optional supporting line under the title. */
  subtitle?: ReactNode;
  /** Card body — the form or confirmation content. */
  children: ReactNode;
  /** Optional footer rendered below the card (e.g. a "Back to sign in" link). */
  footer?: ReactNode;
}

/**
 * Shared centered-card chrome for the standalone auth screens (login, forgot /
 * reset password). Mirrors the original Login layout so every auth surface
 * reads as one family. Pure presentation — no motion, so it is reduced-motion
 * safe by construction.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-surface)',
        padding: 'var(--space-8)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-8)',
        }}
      >
        <header>
          <p
            style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            Nite<span style={{ color: 'var(--color-accent)' }}>Owl</span>
          </p>
          <h1
            style={{
              marginTop: 'var(--space-3)',
              marginBottom: 0,
              fontSize: 'var(--text-lg)',
              fontWeight: 600,
              color: 'var(--color-text)',
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                marginTop: 'var(--space-2)',
                marginBottom: 0,
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          )}
        </header>

        <div
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
