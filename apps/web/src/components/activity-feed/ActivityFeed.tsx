import './activity-feed.css';
import { useFeed } from '../../hooks/useFeed';
import { useFeedFilters } from '../../hooks/useFeedFilters';
import { ActivityCard } from './ActivityCard';
import { ActivityFeedSkeleton } from './ActivityCardSkeleton';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { FeedFilterBar } from './FeedFilterBar';

export function ActivityFeed() {
  const { filters, setHours, toggleProvider, setRepo } = useFeedFilters();

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFeed(filters);

  const allItems = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-label="Activity feed">
      <FeedFilterBar
        hours={filters.hours}
        providers={filters.providers}
        repo={filters.repo}
        onHoursChange={setHours}
        onProviderToggle={toggleProvider}
        onRepoChange={setRepo}
      />

      {isLoading && <ActivityFeedSkeleton />}

      {isError && !isLoading && (
        <ErrorState onRetry={() => void refetch()} />
      )}

      {!isLoading && !isError && allItems.length === 0 && (
        <EmptyState hours={filters.hours} />
      )}

      {!isLoading && !isError && allItems.length > 0 && (
        <>
          <div
            className="activity-feed"
            role="feed"
            aria-label={`Activity from the last ${filters.hours} hours`}
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
              You're all caught up
            </p>
          )}
        </>
      )}
    </section>
  );
}
