// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * API client for the server-backed integration records (FUL-83).
 *
 * Distinct from `hooks/useIntegrations` (a local zustand store of OAuth connect
 * state). These calls hit the persisted integration rows so we can read and edit
 * per-integration config such as the GitHub repo allowlist (FUL-82).
 *
 *   GET   /api/integrations          → { integrations: ApiIntegration[] }
 *   PATCH /api/integrations/:id       → { integration: { id, enabled, repoAllowlist } }
 */

import type { ActivityProvider } from '@niteowl/types';
import { authedFetch } from './auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export interface ApiIntegration {
  id: string;
  provider: ActivityProvider;
  enabled: boolean;
  connectedAt: string;
  lastSyncedAt: string | null;
  /** Normalised `owner/repo` / `owner/*` patterns. [] = ingest all repos. */
  repoAllowlist: string[];
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

/** List the authed user's persisted integrations. */
export async function fetchIntegrations(): Promise<ApiIntegration[]> {
  const res = await authedFetch(`${API_URL}/api/integrations`);
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = (await res.json()) as { integrations: ApiIntegration[] };
  return data.integrations;
}

/**
 * Replace an integration's repo allowlist. Pass `[]` to clear it and restore
 * account-wide aggregation. Returns the server-normalised allowlist so the
 * caller can reconcile what was typed with what is stored.
 */
export async function updateRepoAllowlist(
  id: string,
  repoAllowlist: string[],
): Promise<{ id: string; enabled: boolean; repoAllowlist: string[] }> {
  const res = await authedFetch(`${API_URL}/api/integrations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoAllowlist }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = (await res.json()) as {
    integration: { id: string; enabled: boolean; repoAllowlist: string[] };
  };
  return data.integration;
}
