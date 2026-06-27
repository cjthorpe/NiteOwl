// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import './activity-feed.css';
import type { ActivityProvider } from '@niteowl/types';

import { useFeed } from '../../hooks/useFeed';
import { useFilters } from '../../hooks/useFilters';
import type { TimeRange } from '../../types/filters';
import { FilterBar } from '../filter-bar/FilterBar';

import { ActivityCard } from './ActivityCard';
import { ActivityFeedSkeleton } from './ActivityCardSkeleton';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

function timeRangeToHours(range: TimeRange): number {
  switch (range) {
    case '8h':
      return 8;
    case '12h':
      return 12;
    case '24h':
      return 24;
    case 'custom':
      return 24;
  }
}

export function ActivityFeed() {
  const {
    filters,
    setTimeRange,
    toggleIntegration,
    toggleEventType,
    removeIntegration,
    removeEventType,
    clearAll,
    hasActiveFilters,
  } = useFilters();

  const feedFilters = {
    hours: timeRangeToHours(filters.timeRange),
    providers: filters.integrations as ActivityProvider[],
    eventTypes: filters.eventTypes,
  };

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useFeed(feedFilters);

  const allItems = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-label="Activity feed">
      <FilterBar
        filters={filters}
        onTimeRangeChange={setTimeRange}
        onIntegrationToggle={toggleIntegration}
        onEventTypeToggle={toggleEventType}
        onRemoveIntegration={removeIntegration}
        onRemoveEventType={removeEventType}
        onClearAll={clearAll}
        hasActiveFilters={hasActiveFilters}
      />

      {isLoading && <ActivityFeedSkeleton />}

      {isError && !isLoading && <ErrorState onRetry={() => void refetch()} />}

      {!isLoading && !isError && allItems.length === 0 && <EmptyState hours={feedFilters.hours} />}

      {!isLoading && !isError && allItems.length > 0 && (
        <>
          <div
            className="activity-feed"
            role="feed"
            aria-label={`Activity from the last ${feedFilters.hours} hours`}
            aria-busy={isFetchingNextPage}
          >
            {allItems.map((activity) => (
              <ActivityCard key={activity.id} activity={activity} />
            ))}
          </div>

          {isFetchingNextPage && <ActivityFeedSkeleton count={3} />}

          {hasNextPage && !isFetchingNextPage && (
            <div className="feed-load-more">
              <button
                type="button"
                className="feed-load-more-btn"
                onClick={() => void fetchNextPage()}
                aria-label="Load more activity"
              >
                Load more
              </button>
            </div>
          )}

          {!hasNextPage && allItems.length > 0 && (
            <p
              style={{
                textAlign: 'center',
                padding: 'var(--space-6) 0',
                color: 'var(--color-text-subtle)',
                fontSize: 'var(--text-xs)',
              }}
            >
              You&apos;re all caught up
            </p>
          )}
        </>
      )}
    </section>
  );
}
