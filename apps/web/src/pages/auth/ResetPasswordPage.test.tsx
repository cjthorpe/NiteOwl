import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from './ResetPasswordPage';

/** Render the reset page at a given URL, with a stub /login to observe redirects. */
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login screen</div>} />
        <Route path="/forgot-password" element={<div>Forgot screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResetPasswordPage', () => {
  it('shows an invalid-link state with a re-request link when the token is missing', () => {
    renderAt('/reset-password');
    expect(screen.getByText(/invalid reset link/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new reset link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('validates password length before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/reset-password?token=abc');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags mismatched confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderAt('/reset-password?token=abc');
    await userEvent.type(screen.getByLabelText('New password'), 'goodpassword1');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'goodpassword2');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
  });

  it('redirects to login on a successful reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { message: 'Password has been reset.' } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/reset-password?token=abc');
    await userEvent.type(screen.getByLabelText('New password'), 'goodpassword1');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'goodpassword1');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/login screen/i)).toBeInTheDocument();
  });

  it('shows an expired-token state with a re-request link on a 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Invalid or expired reset token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/reset-password?token=stale');
    await userEvent.type(screen.getByLabelText('New password'), 'goodpassword1');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'goodpassword1');
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/link expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new reset link/i })).toBeInTheDocument();
  });
});
