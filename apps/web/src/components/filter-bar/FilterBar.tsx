// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import './filter-bar.css';
import { type UseFiltersReturn } from '../../hooks/useFilters';
import {
  EVENT_TYPE_LABELS,
  INTEGRATION_LABELS,
  TIME_RANGE_LABELS,
  type FilterState,
  type Integration,
  type EventType,
  DEFAULT_FILTERS,
} from '../../types/filters';

import { EventTypeFilter } from './EventTypeFilter';
import { FilterChip } from './FilterChip';
import { IntegrationFilter } from './IntegrationFilter';
import { TextFilter } from './TextFilter';
import { TimeRangeSelector } from './TimeRangeSelector';

interface FilterBarProps {
  filters: FilterState;
  onTimeRangeChange: UseFiltersReturn['setTimeRange'];
  onIntegrationToggle: UseFiltersReturn['toggleIntegration'];
  onEventTypeToggle: UseFiltersReturn['toggleEventType'];
  onRemoveIntegration: UseFiltersReturn['removeIntegration'];
  onRemoveEventType: UseFiltersReturn['removeEventType'];
  onRepoChange: UseFiltersReturn['setRepo'];
  onAuthorChange: UseFiltersReturn['setAuthor'];
  onClearAll: UseFiltersReturn['clearAll'];
  hasActiveFilters: boolean;
}

export function FilterBar({
  filters,
  onTimeRangeChange,
  onIntegrationToggle,
  onEventTypeToggle,
  onRemoveIntegration,
  onRemoveEventType,
  onRepoChange,
  onAuthorChange,
  onClearAll,
  hasActiveFilters,
}: FilterBarProps) {
  const activeChips: React.ReactNode[] = [];

  if (filters.timeRange !== DEFAULT_FILTERS.timeRange) {
    activeChips.push(
      <FilterChip
        key={`time-${filters.timeRange}`}
        label={TIME_RANGE_LABELS[filters.timeRange]}
        onRemove={() => onTimeRangeChange(DEFAULT_FILTERS.timeRange)}
      />,
    );
  }

  filters.integrations.forEach((integration: Integration) => {
    activeChips.push(
      <FilterChip
        key={`integration-${integration}`}
        label={INTEGRATION_LABELS[integration]}
        onRemove={() => onRemoveIntegration(integration)}
      />,
    );
  });

  filters.eventTypes.forEach((eventType: EventType) => {
    activeChips.push(
      <FilterChip
        key={`event-${eventType}`}
        label={EVENT_TYPE_LABELS[eventType]}
        onRemove={() => onRemoveEventType(eventType)}
      />,
    );
  });

  if (filters.repo) {
    activeChips.push(
      <FilterChip
        key={`repo-${filters.repo}`}
        label={`Repo: ${filters.repo}`}
        onRemove={() => onRepoChange('')}
      />,
    );
  }

  if (filters.author) {
    activeChips.push(
      <FilterChip
        key={`author-${filters.author}`}
        label={`Author: ${filters.author}`}
        onRemove={() => onAuthorChange('')}
      />,
    );
  }

  return (
    <section className="filter-bar" aria-label="Activity filters">
      <div className="filter-bar__controls">
        <TimeRangeSelector value={filters.timeRange} onChange={onTimeRangeChange} />
        <div className="filter-bar__divider" role="separator" aria-hidden="true" />
        <IntegrationFilter value={filters.integrations} onChange={onIntegrationToggle} />
        <div className="filter-bar__divider" role="separator" aria-hidden="true" />
        <EventTypeFilter value={filters.eventTypes} onChange={onEventTypeToggle} />
        <div className="filter-bar__divider" role="separator" aria-hidden="true" />
        <TextFilter
          label="Repo"
          value={filters.repo}
          onCommit={onRepoChange}
          placeholder="owner/repo"
        />
        <TextFilter
          label="Author"
          value={filters.author}
          onCommit={onAuthorChange}
          placeholder="username"
        />
      </div>

      {hasActiveFilters && (
        <div className="filter-bar__chips" aria-label="Active filters" role="group">
          {activeChips}
          <button
            type="button"
            className="filter-bar__clear-all"
            onClick={onClearAll}
            aria-label="Clear all filters"
          >
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}
