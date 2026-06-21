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
    // Set the real token key so getAccessToken() returns a value immediately.
    localStorage.setItem('niteowl:access_token', 'fake-token-for-test');
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });
});
