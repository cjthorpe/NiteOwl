/**
 * useAgentLogins — CRUD for the /api/agent-logins registry (FUL-59)
 *
 * Persists to the server and keeps a local reactive copy so the UI
 * stays in sync without a full page reload.
 */

import { useState, useEffect, useCallback } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000';

export type AgentIntegration = 'github' | 'linear' | 'jira';

export interface AgentLogin {
  id: string;
  integration: AgentIntegration;
  login: string;
  createdAt: string;
}

export interface UseAgentLoginsReturn {
  logins: AgentLogin[];
  isLoading: boolean;
  error: string | null;
  addLogin: (integration: AgentIntegration, login: string) => Promise<void>;
  removeLogin: (id: string) => Promise<void>;
  /** All logins for a given integration — convenience selector */
  byIntegration: (integration: AgentIntegration) => AgentLogin[];
  /** All github logins — used to pre-fill Slack botUserLogins */
  githubLogins: string[];
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('niteowl:access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useAgentLogins(): UseAgentLoginsReturn {
  const [logins, setLogins] = useState<AgentLogin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch all logins on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchLogins() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/agent-logins`, {
          credentials: 'include',
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { logins: AgentLogin[] };
        if (!cancelled) setLogins(data.logins);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load agent logins');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchLogins();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Add login ─────────────────────────────────────────────────────────────
  const addLogin = useCallback(async (integration: AgentIntegration, login: string) => {
    const res = await fetch(`${API_URL}/api/agent-logins`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ integration, login }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { login: AgentLogin };
    // Upsert into local state (avoid duplicates if server returned existing row)
    setLogins((prev) => {
      const exists = prev.some((l) => l.id === data.login.id);
      return exists ? prev : [...prev, data.login];
    });
  }, []);

  // ── Remove login ──────────────────────────────────────────────────────────
  const removeLogin = useCallback(async (id: string) => {
    const res = await fetch(`${API_URL}/api/agent-logins/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`HTTP ${res.status}`);
    }

    setLogins((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // ── Derived selectors ─────────────────────────────────────────────────────
  const byIntegration = useCallback(
    (integration: AgentIntegration) => logins.filter((l) => l.integration === integration),
    [logins],
  );

  const githubLogins = logins.filter((l) => l.integration === 'github').map((l) => l.login);

  return { logins, isLoading, error, addLogin, removeLogin, byIntegration, githubLogins };
}
