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
