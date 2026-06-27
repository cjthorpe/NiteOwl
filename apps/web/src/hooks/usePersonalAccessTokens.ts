// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * usePersonalAccessTokens — load/create/revoke a user's PATs (FUL-93).
 *
 * Owns the token list state and reconciles it locally after each mutation so the
 * UI stays responsive without a full refetch: create prepends the new token
 * (the list shows newest-first), revoke removes it. The raw token value from a
 * create is returned to the caller and never stored in this hook's state.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createToken,
  listTokens,
  revokeToken,
  type CreatedToken,
  type CreateTokenInput,
  type PersonalAccessToken,
} from '../lib/tokens-api';

export interface UsePersonalAccessTokensReturn {
  tokens: PersonalAccessToken[];
  isLoading: boolean;
  error: string | null;
  /** Mint a token; returns the raw value (shown once) and updates the list. */
  create: (input: CreateTokenInput) => Promise<CreatedToken>;
  /** Revoke a token and drop it from the list. */
  revoke: (id: string) => Promise<void>;
}

export function usePersonalAccessTokens(): UsePersonalAccessTokensReturn {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const loaded = await listTokens();
        if (!cancelled) setTokens(loaded);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tokens');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async (input: CreateTokenInput): Promise<CreatedToken> => {
    const created = await createToken(input);
    // Prepend so the list stays newest-first, matching the server ordering.
    setTokens((prev) => [
      {
        id: created.id,
        name: created.name,
        lastUsedAt: null,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
      },
      ...prev,
    ]);
    return created;
  }, []);

  const revoke = useCallback(async (id: string): Promise<void> => {
    await revokeToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { tokens, isLoading, error, create, revoke };
}
