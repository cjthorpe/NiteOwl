// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { Link, useLocation } from 'react-router-dom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

interface LoginLocationState {
  /** Success notice handed over by the reset-password flow on completion. */
  notice?: string;
}

export function Login() {
  const location = useLocation();
  const notice = (location.state as LoginLocationState | null)?.notice;

  function handleGitHubLogin() {
    window.location.href = `${API_URL}/auth/github`;
  }

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
          <h1
            style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            Nite<span style={{ color: 'var(--color-accent)' }}>Owl</span>
          </h1>
          <p
            style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Sign in to your workspace
          </p>
        </header>

        {notice && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'oklch(68% 0.18 145 / 0.12)',
              border: '1px solid var(--color-success)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.5,
            }}
          >
            {notice}
          </p>
        )}

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
          <button
            type="button"
            onClick={handleGitHubLogin}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--color-surface-overlay)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              transition:
                'border-color var(--duration-fast) var(--ease-in-out), background-color var(--duration-fast) var(--ease-in-out)',
              width: '100%',
            }}
          >
            Continue with GitHub
          </button>

          <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--text-sm)' }}>
            <Link
              to="/forgot-password"
              style={{ color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none' }}
            >
              Forgot your password?
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
