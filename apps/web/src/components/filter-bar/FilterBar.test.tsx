// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { FilterState } from '../../types/filters';
import { DEFAULT_FILTERS } from '../../types/filters';

import { FilterBar } from './FilterBar';

const defaultProps = {
  filters: DEFAULT_FILTERS,
  onTimeRangeChange: vi.fn(),
  onIntegrationToggle: vi.fn(),
  onEventTypeToggle: vi.fn(),
  onRemoveIntegration: vi.fn(),
  onRemoveEventType: vi.fn(),
  onClearAll: vi.fn(),
  hasActiveFilters: false,
};

function renderFilterBar(overrides: Partial<typeof defaultProps> = {}) {
  return render(
    <MemoryRouter>
      <FilterBar {...defaultProps} {...overrides} />
    </MemoryRouter>,
  );
}

describe('FilterBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the time range selector', () => {
    renderFilterBar();
    expect(screen.getByRole('group', { name: /time range/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /last 8h/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /last 12h/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /last 24h/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /custom/i })).toBeInTheDocument();
  });

  it('calls onTimeRangeChange when a time option is clicked', async () => {
    const user = userEvent.setup();
    const onTimeRangeChange = vi.fn();
    renderFilterBar({ onTimeRangeChange });

    await user.click(screen.getByRole('radio', { name: /last 24h/i }));
    expect(onTimeRangeChange).toHaveBeenCalledWith('24h');
  });

  it('marks the active time range as checked', () => {
    const filters: FilterState = { ...DEFAULT_FILTERS, timeRange: '12h' };
    renderFilterBar({ filters });
    expect(screen.getByRole('radio', { name: /last 12h/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /last 8h/i })).not.toBeChecked();
  });

  it('renders the event type pills', () => {
    renderFilterBar();
    expect(screen.getByRole('button', { name: /prs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /commits/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /issues/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reviews/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /comments/i })).toBeInTheDocument();
  });

  it('calls onEventTypeToggle when an event type pill is clicked', async () => {
    const user = userEvent.setup();
    const onEventTypeToggle = vi.fn();
    renderFilterBar({ onEventTypeToggle });

    await user.click(screen.getByRole('button', { name: /^prs$/i }));
    expect(onEventTypeToggle).toHaveBeenCalledWith('prs');
  });

  it('does not render chips or clear all when no active filters', () => {
    renderFilterBar();
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('renders active filter chips and clear all when hasActiveFilters', () => {
    const filters: FilterState = {
      timeRange: '24h',
      integrations: ['github'],
      eventTypes: ['prs'],
    };
    renderFilterBar({ filters, hasActiveFilters: true });

    // Chips appear as groups with aria-label "Active filter: X"
    expect(screen.getByRole('group', { name: 'Active filter: Last 24h' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Active filter: GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Active filter: PRs' })).toBeInTheDocument();
    // Clear all button
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
  });

  it('calls onClearAll when clear all is clicked', async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    const filters: FilterState = {
      timeRange: '24h',
      integrations: ['github'],
      eventTypes: [],
    };
    renderFilterBar({ filters, hasActiveFilters: true, onClearAll });

    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveIntegration when integration chip X is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveIntegration = vi.fn();
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      integrations: ['slack'],
    };
    renderFilterBar({ filters, hasActiveFilters: true, onRemoveIntegration });

    await user.click(screen.getByRole('button', { name: /remove filter: slack/i }));
    expect(onRemoveIntegration).toHaveBeenCalledWith('slack');
  });

  it('calls onRemoveEventType when event type chip X is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveEventType = vi.fn();
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      eventTypes: ['commits'],
    };
    renderFilterBar({ filters, hasActiveFilters: true, onRemoveEventType });

    await user.click(screen.getByRole('button', { name: /remove filter: commits/i }));
    expect(onRemoveEventType).toHaveBeenCalledWith('commits');
  });

  it('calls onTimeRangeChange with default when time chip X is clicked', async () => {
    const user = userEvent.setup();
    const onTimeRangeChange = vi.fn();
    const filters: FilterState = { ...DEFAULT_FILTERS, timeRange: '24h' };
    renderFilterBar({ filters, hasActiveFilters: true, onTimeRangeChange });

    await user.click(screen.getByRole('button', { name: /remove filter: last 24h/i }));
    expect(onTimeRangeChange).toHaveBeenCalledWith('8h');
  });
});
