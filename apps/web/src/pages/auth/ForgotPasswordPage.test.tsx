import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('shows the generic confirmation after submitting (no enumeration leak)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps the disabled submit button until an email is entered', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/email address/i), 'a@b.co');
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeEnabled();
  });

  it('surfaces a retryable error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderPage();
    await userEvent.type(screen.getByLabelText(/email address/i), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  it('links back to sign in', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
