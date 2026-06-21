import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderApp(initialPath = '/login') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App smoke tests', () => {
  beforeEach(() => {
    localStorage.removeItem('niteowl:auth');
    localStorage.removeItem('niteowl:access_token');
  });

  it('renders the login page on /login', () => {
    renderApp('/login');
    expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument();
  });

  it('renders the onboarding page on /onboarding', () => {
    renderApp('/onboarding');
    expect(screen.getByText(/connect github to get started/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated users from /dashboard to /login', async () => {
    renderApp('/dashboard');
    // ProtectedRoute attempts a silent token refresh before redirecting — wait for it.
    expect(await screen.findByText(/sign in to your workspace/i)).toBeInTheDocument();
  });

  it('renders dashboard for authenticated users', async () => {
    // useAuth now checks the JWT exp claim before treating a cached token as
    // valid.  Use a properly-shaped token (header.payload.sig) with exp far in
    // the future so isTokenExpiringSoon() returns false and the dashboard
    // renders immediately without triggering a silent refresh.
    const payload = btoa(
      JSON.stringify({
        sub: 'test-user',
        email: 'test@example.com',
        lastSeenAt: null,
        exp: 9999999999,
      }),
    );
    const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.fakesig`;
    localStorage.setItem('niteowl:access_token', fakeJwt);
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });
});
