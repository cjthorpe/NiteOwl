import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchFeedPage } from '../lib/feed';
import type { FeedFilters } from './useFeedFilters';

export function useFeed(filters: FeedFilters) {
  return useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) =>
      fetchFeedPage({
        hours: filters.hours,
        providers: filters.providers,
        repo: filters.repo,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  });
}
