// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { IntegrationCard } from '../components/integration-card/IntegrationCard';
import { RepoAllowlistControl } from '../components/integration-card/RepoAllowlistControl';
import { useIntegrations } from '../hooks/useIntegrations';
import { INTEGRATIONS } from '../lib/integrations';

export function Integrations() {
  const { isConnected } = useIntegrations();
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

      {/* Integration cards */}
      <div className="flex flex-col gap-3">
        {INTEGRATIONS.map((meta) => (
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
