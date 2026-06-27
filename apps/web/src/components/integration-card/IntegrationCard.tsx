// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useIntegrations } from '../../hooks/useIntegrations';
import { buildOAuthStartUrl, type IntegrationMeta } from '../../lib/integrations';
import { ProviderLogo } from '../ui/ProviderLogo';

interface IntegrationCardProps {
  meta: IntegrationMeta;
  /** Show the card in a more compact layout (settings page) */
  compact?: boolean;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function IntegrationCard({ meta, compact = false }: IntegrationCardProps) {
  const { getConnection, disconnect, isConnected } = useIntegrations();
  const connection = getConnection(meta.provider);
  const connected = isConnected(meta.provider);

  const handleConnect = () => {
    window.location.href = buildOAuthStartUrl(meta.provider);
  };

  const handleDisconnect = () => {
    disconnect(meta.provider);
  };

  return (
    <article
      className={[
        'group relative flex gap-4 rounded-xl border transition-all',
        'border-[var(--color-border)] bg-[var(--color-surface-raised)]',
        'hover:border-[var(--color-border-focus)]/40',
        connected
          ? 'ring-1 ring-[var(--color-success)]/20'
          : 'hover:bg-[var(--color-surface-overlay)]',
        compact ? 'p-4' : 'p-5',
      ].join(' ')}
      style={{
        transition: `border-color var(--duration-normal) var(--ease-out-expo), background-color var(--duration-normal) var(--ease-out-expo)`,
      }}
    >
      {/* Logo */}
      <div
        className={[
          'flex shrink-0 items-center justify-center rounded-lg',
          'ring-1 ring-inset',
          meta.accentClass,
          compact ? 'h-10 w-10' : 'h-12 w-12',
        ].join(' ')}
        style={{ backgroundColor: `${meta.brandColor}12` }}
        aria-hidden
      >
        <ProviderLogo
          provider={meta.provider}
          size={compact ? 20 : 24}
          style={{ color: meta.brandColor }}
        />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              className="text-sm font-semibold leading-tight"
              style={{ color: 'var(--color-text)' }}
            >
              {meta.name}
            </h3>
            {!compact && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {meta.description}
              </p>
            )}
          </div>

          {/* Status badge */}
          {connected && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'oklch(68% 0.18 145 / 0.12)',
                color: 'var(--color-success)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--color-success)' }}
                aria-hidden
              />
              Connected
            </span>
          )}
        </div>

        {/* Captured data chips */}
        {!compact && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {meta.captures.map((cap) => (
              <span
                key={cap}
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: 'var(--color-surface-overlay)',
                  color: 'var(--color-text-subtle)',
                }}
              >
                {cap}
              </span>
            ))}
          </div>
        )}

        {/* Connected stats */}
        {connected && connection && (
          <div
            className="mt-2 flex flex-wrap gap-3 text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <span>
              <span style={{ color: 'var(--color-text)' }} className="font-semibold tabular-nums">
                {connection.eventCount.toLocaleString()}
              </span>{' '}
              events
            </span>
            {connection.lastSyncedAt && (
              <span>Last sync {formatRelativeTime(connection.lastSyncedAt)}</span>
            )}
          </div>
        )}
      </div>

      {/* Action */}
      <div className="flex shrink-0 items-start">
        {connected ? (
          <button
            type="button"
            onClick={handleDisconnect}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-surface-overlay)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-danger)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: 'oklch(12% 0.01 260)',
              cursor: 'pointer',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            Connect
          </button>
        )}
      </div>
    </article>
  );
}
