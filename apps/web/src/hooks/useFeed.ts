// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { ActivityProvider } from '@niteowl/types';
import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchFeedPage } from '../lib/feed';
import type { EventType } from '../types/filters';

export interface FeedQueryFilters {
  hours: number;
  providers: ActivityProvider[];
  eventTypes: EventType[];
  repo?: string;
  author?: string;
}

export function useFeed(filters: FeedQueryFilters) {
  return useInfiniteQuery({
    queryKey: ['feed', filters],
    queryFn: ({ pageParam }) =>
      fetchFeedPage({
        hours: filters.hours,
        providers: filters.providers,
        eventTypes: filters.eventTypes,
        ...(filters.repo ? { repo: filters.repo } : {}),
        ...(filters.author ? { author: filters.author } : {}),
        ...(pageParam !== undefined && { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 30 * 1000,
    retry: 2,
  });
}
