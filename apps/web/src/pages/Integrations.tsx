// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useEffect } from 'react';

import { IntegrationCard } from '../components/integration-card/IntegrationCard';
import { RepoAllowlistControl } from '../components/integration-card/RepoAllowlistControl';
import { useIntegrations } from '../hooks/useIntegrations';
import { INTEGRATIONS } from '../lib/integrations';

export function Integrations() {
  const { isConnected, hydrateFromServer, hydrated } = useIntegrations();

  // Reconcile the optimistic localStorage cache with the authoritative server
  // list on mount, so connected providers show "Connected" on every fresh
  // session — not just the browser/incognito window that completed OAuth.
  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  const connectedCount = INTEGRATIONS.filter((m) => isConnected(m.provider)).length;

  return (
    <section aria-labelledby="integrations-heading">
      {/* Page header */}
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1
              id="integrations-heading"
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              Integrations
            </h1>
            <p
              style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}
            >
              Connect your tools to surface activity in NiteOwl.
            </p>
          </div>

          {/* Connected count badge */}
          {connectedCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: 'oklch(68% 0.18 145 / 0.1)',
                color: 'var(--color-success)',
                border: '1px solid oklch(68% 0.18 145 / 0.2)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--color-success)' }}
                aria-hidden
              />
              {connectedCount} connected
            </span>
          )}
        </div>
      </header>

      {/* Integration cards. Until the first server reconciliation resolves we
          show skeletons rather than risk a flash of "Connect" on a provider the
          server actually has connected (the localStorage cache may be empty on
          a fresh session). */}
      <div className="flex flex-col gap-3" aria-busy={!hydrated}>
        {!hydrated
          ? INTEGRATIONS.map((meta) => <IntegrationCardSkeleton key={meta.provider} />)
          : INTEGRATIONS.map((meta) => (
              <div key={meta.provider} className="flex flex-col gap-3">
                <IntegrationCard meta={meta} />
                {/* GitHub gets a repo-allowlist control directly beneath its card.
                    The control self-gates: it renders nothing until a persisted
                    GitHub integration exists (i.e. once connected). */}
                {meta.provider === 'github' && isConnected('github') && (
                  <RepoAllowlistControl provider="github" />
                )}
              </div>
            ))}
      </div>

      {/* Footer note */}
      <p className="mt-8 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
        More integrations — Slack, Jira — coming soon.
      </p>
    </section>
  );
}

/** Placeholder card shown while the server reconciliation is in flight. */
function IntegrationCardSkeleton() {
  return (
    <div
      className="flex gap-4 rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface-raised)',
        animation: 'pulse 1.4s ease-in-out infinite',
      }}
      aria-hidden
    >
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }`}</style>
      <div
        className="h-12 w-12 shrink-0 rounded-lg"
        style={{ backgroundColor: 'var(--color-surface-overlay)' }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div
          className="h-3.5 w-28 rounded"
          style={{ backgroundColor: 'var(--color-surface-overlay)' }}
        />
        <div
          className="h-3 w-48 rounded"
          style={{ backgroundColor: 'var(--color-surface-overlay)' }}
        />
      </div>
      <div
        className="h-7 w-20 shrink-0 rounded-lg"
        style={{ backgroundColor: 'var(--color-surface-overlay)' }}
      />
    </div>
  );
}
