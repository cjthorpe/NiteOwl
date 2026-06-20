/**
 * Stub auth hook — will be wired to real session logic in a later issue.
 * Currently reads a flag from localStorage so ProtectedRoute can work in dev.
 */
export function useAuth(): { isAuthenticated: boolean } {
  const flag = typeof window !== 'undefined' ? localStorage.getItem('niteowl:auth') : null;
  return { isAuthenticated: flag === 'true' };
}
