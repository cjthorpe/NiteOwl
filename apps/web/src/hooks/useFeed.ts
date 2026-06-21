import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchFeedPage } from '../lib/feed';
import type { ActivityProvider } from '@niteowl/types';
import type { EventType } from '../types/filters';

export interface FeedQueryFilters {
  hours: number;
  providers: ActivityProvider[];
  eventTypes: EventType[];
}

export function useFeed(filters: FeedQueryFilters) {
  return useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) =>
      fetchFeedPage({
        hours: filters.hours,
        providers: filters.providers,
        eventTypes: filters.eventTypes,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 30 * 1000,
    retry: 2,
  });
}
