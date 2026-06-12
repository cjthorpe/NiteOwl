import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityProvider } from '@niteowl/types';

export interface ConnectedIntegration {
  provider: ActivityProvider;
  connectedAt: string; // ISO timestamp
  lastSyncedAt: string | null;
  eventCount: number;
}

interface IntegrationsState {
  connections: Record<ActivityProvider, ConnectedIntegration | undefined>;
  connect: (provider: ActivityProvider, eventCount?: number) => void;
  disconnect: (provider: ActivityProvider) => void;
  getConnection: (provider: ActivityProvider) => ConnectedIntegration | undefined;
  isConnected: (provider: ActivityProvider) => boolean;
}

export const useIntegrations = create<IntegrationsState>()(
  persist(
    (set, get) => ({
      connections: {} as Record<ActivityProvider, ConnectedIntegration | undefined>,

      connect: (provider, eventCount = 0) => {
        const now = new Date().toISOString();
        set((state) => ({
          connections: {
            ...state.connections,
            [provider]: {
              provider,
              connectedAt: now,
              lastSyncedAt: now,
              eventCount,
            },
          },
        }));
      },

      disconnect: (provider) => {
        set((state) => {
          const next = { ...state.connections };
          delete next[provider];
          return { connections: next };
        });
      },

      getConnection: (provider) => get().connections[provider],

      isConnected: (provider) => Boolean(get().connections[provider]),
    }),
    {
      name: 'niteowl-integrations',
    },
  ),
);
