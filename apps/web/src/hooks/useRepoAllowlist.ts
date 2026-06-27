// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * useRepoAllowlist — read/edit a provider's repo allowlist (FUL-83).
 *
 * Fetches the persisted integration record for `provider`, exposes its current
 * (server-normalised) allowlist, and a `save` that PATCHes a new list and
 * reconciles local state with the server's normalised response.
 *
 * Returns `integration: null` when the provider has no persisted integration
 * (e.g. not connected yet) so the caller can hide the control.
 */

import type { ActivityProvider } from '@niteowl/types';
import { useState, useEffect, useCallback } from 'react';

import {
  fetchIntegrations,
  updateRepoAllowlist,
  type ApiIntegration,
} from '../lib/integrations-api';

export interface UseRepoAllowlistReturn {
  integration: ApiIntegration | null;
  isLoading: boolean;
  error: string | null;
  /** Persist a new allowlist; resolves with the server-normalised list. */
  save: (entries: string[]) => Promise<string[]>;
}

export function useRepoAllowlist(provider: ActivityProvider): UseRepoAllowlistReturn {
  const [integration, setIntegration] = useState<ApiIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const integrations = await fetchIntegrations();
        if (cancelled) return;
        setIntegration(integrations.find((i) => i.provider === provider) ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load integration');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const save = useCallback(
    async (entries: string[]): Promise<string[]> => {
      if (!integration) throw new Error('No integration to update');
      const updated = await updateRepoAllowlist(integration.id, entries);
      setIntegration((prev) =>
        prev ? { ...prev, repoAllowlist: updated.repoAllowlist, enabled: updated.enabled } : prev,
      );
      return updated.repoAllowlist;
    },
    [integration],
  );

  return { integration, isLoading, error, save };
}
