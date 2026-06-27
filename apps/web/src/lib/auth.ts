// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'niteowl:access_token';
const AUTH_KEY = 'niteowl:auth';

export function getAccessToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}

export function setAccessToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(AUTH_KEY, 'true');
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_KEY);
  }
}

export function getAuthHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Exchange the HttpOnly refresh cookie for a new access token. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const data = (await res.json()) as { success: boolean; data?: { accessToken: string } };
    if (!data.success || !data.data?.accessToken) {
      setAccessToken(null);
      return null;
    }
    setAccessToken(data.data.accessToken);
    return data.data.accessToken;
  } catch {
    return null;
  }
}

export function signOut(): void {
  setAccessToken(null);
  fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {
    // Non-fatal
  });
}

/**
 * Authenticated fetch with automatic 401 recovery.
 *
 * The 1-hour access token frequently outlives a browser tab (it expires while
 * the SPA is open, or is stale after a long idle period). Data calls that fire
 * with such a token get a 401, and without recovery the dashboard wedges into
 * "Couldn't load your feed" even though a valid 7-day refresh cookie is sitting
 * right there. This wrapper attempts one silent refresh on a 401 and retries
 * the request with the freshly minted token, so the session self-heals. If the
 * refresh also fails the original 401 is returned for the caller to surface,
 * and the access token has been cleared so route guards send the user to login.
 */
export async function authedFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const send = (auth: HeadersInit): Promise<Response> =>
    fetch(input, {
      ...init,
      credentials: 'include',
      headers: { ...(init.headers ?? {}), ...auth },
    });

  const res = await send(getAuthHeaders());
  if (res.status !== 401) return res;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;

  return send({ Authorization: `Bearer ${refreshed}` });
}
