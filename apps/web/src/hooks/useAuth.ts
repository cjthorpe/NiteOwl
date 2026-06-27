// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { useState, useEffect } from 'react';

import { getAccessToken, refreshAccessToken } from '../lib/auth';

/**
 * Decode the JWT expiry claim client-side (no signature verification needed —
 * the server verifies on every request).  Returns true when the token is
 * missing, malformed, or within 60 seconds of expiry.
 */
function isTokenExpiringSoon(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]!)) as Record<string, unknown>;
    const exp = payload['exp'];
    if (typeof exp !== 'number') return true;
    // Refresh if expired or expiring within 60 s
    return Date.now() / 1000 >= exp - 60;
  } catch {
    return true;
  }
}

function hasValidToken(): boolean {
  const token = getAccessToken();
  return !!token && !isTokenExpiringSoon(token);
}

export function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const [isAuthenticated, setIsAuthenticated] = useState(hasValidToken);
  const [isLoading, setIsLoading] = useState(() => !hasValidToken());

  useEffect(() => {
    if (hasValidToken()) {
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }
    // No token, or it has expired / is expiring — attempt a silent refresh via
    // the HttpOnly cookie.  This re-establishes the session after a page reload
    // or when the 1-hour access token has expired.
    void refreshAccessToken().then((token) => {
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  return { isAuthenticated, isLoading };
}
