import { useState, useEffect } from 'react';
import { getAccessToken, refreshAccessToken } from '../lib/auth';

export function useAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const [isAuthenticated, setIsAuthenticated] = useState(!!getAccessToken());
  const [isLoading, setIsLoading] = useState(!getAccessToken());

  useEffect(() => {
    if (getAccessToken()) {
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }
    // No token in memory — attempt a silent refresh via the HttpOnly cookie.
    // This re-establishes the session after a page reload.
    refreshAccessToken().then((token) => {
      setIsAuthenticated(!!token);
      setIsLoading(false);
    });
  }, []);

  return { isAuthenticated, isLoading };
}
