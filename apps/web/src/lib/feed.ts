import type { Activity, ActivityProvider } from '@niteowl/types';
import type { EventType } from '../types/filters';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export interface FeedParams {
  hours: number;
  providers: ActivityProvider[];
  eventTypes: EventType[];
  page: number;
}

export interface FeedPage {
  items: Activity[];
  nextPage: number | null;
  total: number;
}

export async function fetchFeedPage(params: FeedParams): Promise<FeedPage> {
  const url = new URL(`${API_URL}/api/feed`);
  url.searchParams.set('hours', String(params.hours));
  if (params.providers.length > 0) {
    url.searchParams.set('provider', params.providers.join(','));
  }
  if (params.eventTypes.length > 0) {
    url.searchParams.set('events', params.eventTypes.join(','));
  }
  url.searchParams.set('page', String(params.page));

  const res = await fetch(url.toString(), {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }

  const json = (await res.json()) as { success: boolean; data: FeedPage; error: string | null };

  if (!json.success) {
    throw new Error(json.error ?? 'Unknown error fetching feed');
  }

  return json.data;
}
