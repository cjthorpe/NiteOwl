// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { ActivityProvider } from '@niteowl/types';
import { act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ApiIntegration } from '../lib/integrations-api';

// Mock the server API client. The store reconciles against whatever this returns.
const fetchIntegrations = vi.fn<() => Promise<ApiIntegration[]>>();
vi.mock('../lib/integrations-api', () => ({
  fetchIntegrations: () => fetchIntegrations(),
}));

// Imported after the mock so the store binds to the mocked client. The
// `ConnectedIntegration` type rides along inline to keep it out of the top
// import block (a separate parent+sibling type-import pair trips import/order).
import { useIntegrations, type ConnectedIntegration } from './useIntegrations';

const emptyConnections = {} as Record<ActivityProvider, ConnectedIntegration | undefined>;

function row(
  overrides: Partial<ApiIntegration> & { provider: ApiIntegration['provider'] },
): ApiIntegration {
  return {
    id: `id-${overrides.provider}`,
    enabled: true,
    connectedAt: '2026-01-01T00:00:00.000Z',
    lastSyncedAt: '2026-01-02T00:00:00.000Z',
    repoAllowlist: [],
    ...overrides,
  };
}

describe('useIntegrations.hydrateFromServer', () => {
  beforeEach(() => {
    fetchIntegrations.mockReset();
    localStorage.clear();
    // Reset the singleton store to a clean, un-hydrated state between tests.
    useIntegrations.setState({ connections: emptyConnections, hydrating: false, hydrated: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks enabled server rows as connected even when localStorage is empty', async () => {
    fetchIntegrations.mockResolvedValue([row({ provider: 'jira' })]);

    await act(async () => {
      await useIntegrations.getState().hydrateFromServer();
    });

    const state = useIntegrations.getState();
    expect(state.isConnected('jira')).toBe(true);
    expect(state.getConnection('jira')).toMatchObject({
      provider: 'jira',
      connectedAt: '2026-01-01T00:00:00.000Z',
      lastSyncedAt: '2026-01-02T00:00:00.000Z',
      eventCount: 0,
    });
    expect(state.hydrated).toBe(true);
    expect(state.hydrating).toBe(false);
  });

  it('ignores disabled server rows', async () => {
    fetchIntegrations.mockResolvedValue([row({ provider: 'github', enabled: false })]);

    await act(async () => {
      await useIntegrations.getState().hydrateFromServer();
    });

    expect(useIntegrations.getState().isConnected('github')).toBe(false);
  });

  it('drops a stale local connection the server no longer reports as enabled', async () => {
    // Simulate a connection cached locally (e.g. disconnected on another device).
    act(() => {
      useIntegrations.getState().connect('linear', 42);
    });
    expect(useIntegrations.getState().isConnected('linear')).toBe(true);

    fetchIntegrations.mockResolvedValue([]); // server reports nothing enabled

    await act(async () => {
      await useIntegrations.getState().hydrateFromServer();
    });

    expect(useIntegrations.getState().isConnected('linear')).toBe(false);
  });

  it('preserves an optimistic eventCount from the local cache on reconcile', async () => {
    act(() => {
      useIntegrations.getState().connect('github', 128);
    });

    fetchIntegrations.mockResolvedValue([row({ provider: 'github' })]);

    await act(async () => {
      await useIntegrations.getState().hydrateFromServer();
    });

    expect(useIntegrations.getState().getConnection('github')?.eventCount).toBe(128);
  });

  it('keeps the optimistic cache when the server request fails', async () => {
    act(() => {
      useIntegrations.getState().connect('jira', 5);
    });

    fetchIntegrations.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await useIntegrations.getState().hydrateFromServer();
    });

    const state = useIntegrations.getState();
    // Non-fatal: cache retained so we don't wrongly flip a real connection to "Connect".
    expect(state.isConnected('jira')).toBe(true);
    // Still marks hydration complete so the loading gate resolves.
    expect(state.hydrated).toBe(true);
    expect(state.hydrating).toBe(false);
  });
});
