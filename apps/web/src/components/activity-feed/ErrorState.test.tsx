import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders an error message', () => {
    render(<ErrorState onRetry={vi.fn()} />);
    expect(screen.getByText(/couldn't load your feed/i)).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has an alert role for accessibility', () => {
    render(<ErrorState onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
