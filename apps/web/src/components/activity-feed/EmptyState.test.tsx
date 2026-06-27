// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the hours in the message', () => {
    render(<EmptyState hours={8} />);
    expect(screen.getByText(/all quiet in the last 8h/i)).toBeInTheDocument();
  });

  it('adapts to different hour values', () => {
    render(<EmptyState hours={24} />);
    expect(screen.getByText(/all quiet in the last 24h/i)).toBeInTheDocument();
  });

  it('has a status role for accessibility', () => {
    render(<EmptyState hours={8} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
