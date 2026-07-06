// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { ActivityProvider } from '@niteowl/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { authedFetch } from '../lib/auth';
import { fetchIntegrations } from '../lib/integrations-api';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export interface ConnectedIntegration {
  provider: ActivityProvider;
  connectedAt: string; // ISO timestamp
  lastSyncedAt: string | null;
  eventCount: number;
}

interface IntegrationsState {
  connections: Record<ActivityProvider, ConnectedIntegration | undefined>;
  /** True while the first server reconciliation is in flight. */
  hydrating: boolean;
  /** True once `hydrateFromServer` has resolved at least once (success or failure). */
  hydrated: boolean;
  connect: (provider: ActivityProvider, eventCount?: number) => void;
  disconnect: (provider: ActivityProvider) => void;
  getConnection: (provider: ActivityProvider) => ConnectedIntegration | undefined;
  isConnected: (provider: ActivityProvider) => boolean;
  /**
   * Reconcile the local (localStorage-backed) store with the authoritative
   * server list from `GET /api/integrations`. The server is the source of
   * truth for "connected": every enabled row becomes a connection, and any
   * local connection the server no longer reports as enabled is dropped.
   *
   * The local store remains an optimistic cache so the post-OAuth redirect
   * still feels instant; this call corrects it on every fresh session.
   */
  hydrateFromServer: () => Promise<void>;
}

export const useIntegrations = create<IntegrationsState>()(
  persist(
    (set, get) => ({
      connections: {} as Record<ActivityProvider, ConnectedIntegration | undefined>,
      hydrating: false,
      hydrated: false,

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

      hydrateFromServer: async () => {
        set({ hydrating: true });
        try {
          const rows = await fetchIntegrations();
          set((state) => {
            const next = { ...state.connections };
            const enabled = new Set<ActivityProvider>();

            for (const row of rows) {
              if (!row.enabled) continue;
              enabled.add(row.provider);
              const existing = state.connections[row.provider];
              next[row.provider] = {
                provider: row.provider,
                connectedAt: row.connectedAt,
                lastSyncedAt: row.lastSyncedAt,
                // The server list does not carry an event count; preserve any
                // value already in the optimistic cache, otherwise default to 0.
                eventCount: existing?.eventCount ?? 0,
              };
            }

            // Drop stale local connections the server no longer reports as
            // enabled, so a disconnect on another device/browser reconciles too.
            for (const provider of Object.keys(next) as ActivityProvider[]) {
              if (next[provider] && !enabled.has(provider)) delete next[provider];
            }

            return { connections: next };
          });
        } catch {
          // Non-fatal: keep the optimistic cache. The badge may remain stale
          // until the next successful reconciliation.
        } finally {
          set({ hydrating: false, hydrated: true });
        }
      },
    }),
    {
      name: 'niteowl-integrations',
      // Only the connections map is durable. `hydrating`/`hydrated` are
      // per-session transient flags and must not survive a reload, or the
      // loading gate would never show on a fresh session.
      partialize: (state) => ({ connections: state.connections }),
    },
  ),
);
