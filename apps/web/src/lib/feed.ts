import type { Activity, ActivityProvider } from '@niteowl/types';
import type { EventType } from '../types/filters';
import { getAuthHeaders } from './auth';

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
    headers: getAuthHeaders(),
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

export interface BriefingFeedParams {
  /** Use 'last_login' to resolve to the user's previous session timestamp */
  since: 'last_login' | number;
}

/**
 * Fetch all activity items for the morning briefing window.
 * Uses `since=last_login` to resolve to the user's previous session or
 * falls back to the provided hours value.
 * Fetches all pages to build a complete picture.
 */
export async function fetchBriefingItems(params: BriefingFeedParams): Promise<Activity[]> {
  const allItems: Activity[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${API_URL}/api/feed`);
    if (params.since === 'last_login') {
      url.searchParams.set('since', 'last_login');
    } else {
      url.searchParams.set('hours', String(params.since));
    }
    url.searchParams.set('limit', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const res = await fetch(url.toString(), { credentials: 'include', headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);

    const json = (await res.json()) as {
      success: boolean;
      data: { items: Activity[]; nextPage: number | null; nextCursor?: string | null };
      error: string | null;
    };

    if (!json.success) throw new Error(json.error ?? 'Unknown error fetching feed');

    allItems.push(...json.data.items);

    // Support cursor-based or page-based pagination termination
    cursor = json.data.nextCursor ?? undefined;
    if (!cursor && !json.data.nextPage) break;
    if (!cursor && json.data.nextPage) break; // page-based: stop at first page for briefing
  } while (cursor);

  return allItems;
}
