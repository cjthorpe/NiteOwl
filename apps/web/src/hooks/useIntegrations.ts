// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityProvider } from '@niteowl/types';
import { authedFetch } from '../lib/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

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
        // Clear local state immediately for responsive UI
        set((state) => {
          const next = { ...state.connections };
          delete next[provider];
          return { connections: next };
        });

        // Delete tokens from the database (AC: tokens must be cleared on disconnect)
        authedFetch(`${API_URL}/api/integrations/providers/${provider}`, {
          method: 'DELETE',
        }).catch(() => {
          // Non-fatal: local state is already cleared. Log silently.
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
