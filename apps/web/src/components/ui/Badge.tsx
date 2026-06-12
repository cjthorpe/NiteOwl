import type { ReactNode } from 'react';
import type { IntegrationStatus } from '../../store/integrationStore';

interface BadgeProps {
  status: IntegrationStatus;
  children?: ReactNode;
}

const statusConfig: Record<IntegrationStatus, { label: string; className: string }> = {
  connected: {
    label: 'Connected',
    className: 'bg-[oklch(68%_0.18_145_/_0.15)] text-[var(--color-success)] border-[oklch(68%_0.18_145_/_0.3)]',
  },
  connecting: {
    label: 'Connecting…',
    className: 'bg-[oklch(72%_0.19_55_/_0.15)] text-[var(--color-warning)] border-[oklch(72%_0.19_55_/_0.3)]',
  },
  disconnected: {
    label: 'Not connected',
    className: 'bg-[var(--color-surface-overlay)] text-[var(--color-text-subtle)] border-[var(--color-border)]',
  },
  error: {
    label: 'Error',
    className: 'bg-[oklch(62%_0.23_25_/_0.15)] text-[var(--color-danger)] border-[oklch(62%_0.23_25_/_0.3)]',
  },
};

export function StatusBadge({ status, children }: BadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[var(--text-xs)] font-medium',
        config.className,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'h-1.5 w-1.5 rounded-full',
          status === 'connected' ? 'bg-[var(--color-success)]' : '',
          status === 'connecting' ? 'bg-[var(--color-warning)] animate-pulse' : '',
          status === 'disconnected' ? 'bg-[var(--color-text-subtle)]' : '',
          status === 'error' ? 'bg-[var(--color-danger)]' : '',
        ].join(' ')}
      />
      {children ?? config.label}
    </span>
  );
}
