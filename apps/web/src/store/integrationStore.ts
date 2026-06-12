import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type IntegrationId = 'github' | 'linear' | 'slack';
export type IntegrationStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Integration {
  id: IntegrationId;
  name: string;
  description: string;
  status: IntegrationStatus;
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** Never stored or shown in plaintext — only a masked indicator */
  hasToken: boolean;
  error: string | null;
}

export interface IntegrationState {
  integrations: Record<IntegrationId, Integration>;
}

interface IntegrationActions {
  setStatus: (id: IntegrationId, status: IntegrationStatus) => void;
  markConnected: (id: IntegrationId) => void;
  markError: (id: IntegrationId, error: string) => void;
  disconnect: (id: IntegrationId) => void;
  updateLastSync: (id: IntegrationId) => void;
}

const defaultIntegrations: Record<IntegrationId, Integration> = {
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Sync repositories, pull requests, and commit activity.',
    status: 'disconnected',
    connectedAt: null,
    lastSyncAt: null,
    hasToken: false,
    error: null,
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Import issues, cycles, and team workspaces.',
    status: 'disconnected',
    connectedAt: null,
    lastSyncAt: null,
    hasToken: false,
    error: null,
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Post digest notifications to your team channels.',
    status: 'disconnected',
    connectedAt: null,
    lastSyncAt: null,
    hasToken: false,
    error: null,
  },
};

export const useIntegrationStore = create<IntegrationState & IntegrationActions>()(
  persist(
    (set) => ({
      integrations: defaultIntegrations,

      setStatus: (id, status) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            [id]: { ...state.integrations[id], status, error: null },
          },
        })),

      markConnected: (id) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            [id]: {
              ...state.integrations[id],
              status: 'connected',
              connectedAt: new Date().toISOString(),
              lastSyncAt: new Date().toISOString(),
              hasToken: true,
              error: null,
            },
          },
        })),

      markError: (id, error) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            [id]: {
              ...state.integrations[id],
              status: 'error',
              error,
            },
          },
        })),

      disconnect: (id) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            [id]: {
              ...defaultIntegrations[id],
            },
          },
        })),

      updateLastSync: (id) =>
        set((state) => ({
          integrations: {
            ...state.integrations,
            [id]: {
              ...state.integrations[id],
              lastSyncAt: new Date().toISOString(),
            },
          },
        })),
    }),
    {
      name: 'niteowl:integrations',
      // Only persist status + timestamps, never token values
      partialize: (state) => ({
        integrations: Object.fromEntries(
          Object.entries(state.integrations).map(([k, v]) => [
            k,
            {
              id: v.id,
              name: v.name,
              description: v.description,
              status: v.status,
              connectedAt: v.connectedAt,
              lastSyncAt: v.lastSyncAt,
              hasToken: v.hasToken,
              error: v.error,
            },
          ]),
        ),
      }),
    },
  ),
);
