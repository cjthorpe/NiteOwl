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
  });

  it('renders the login page on /login', () => {
    renderApp('/login');
    expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument();
  });

  it('renders the onboarding page on /onboarding', () => {
    renderApp('/onboarding');
    expect(screen.getByText(/set up your workspace/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated users from /dashboard to /login', () => {
    renderApp('/dashboard');
    expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument();
  });

  it('renders dashboard for authenticated users', () => {
    localStorage.setItem('niteowl:auth', 'true');
    renderApp('/dashboard');
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });
});
