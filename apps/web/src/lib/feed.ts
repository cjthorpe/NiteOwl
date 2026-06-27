// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Activity, ActivityProvider } from '@niteowl/types';
import type { EventType } from '../types/filters';
import { authedFetch } from './auth';

/**
 * Maps UI-level event category shorthand to the DB-level event type strings
 * the feed API understands.
 */
const EVENT_TYPE_DB_MAP: Record<EventType, string[]> = {
  prs: ['pr_opened', 'pr_merged', 'pr_closed'],
  commits: ['commit_pushed'],
  issues: ['issue_opened', 'issue_closed', 'issue_updated'],
  reviews: [],
  comments: ['comment_created'],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

export interface FeedParams {
  hours: number;
  providers: ActivityProvider[];
  eventTypes: EventType[];
  cursor?: string;
}

export interface FeedPage {
  items: Activity[];
  nextCursor: string | null;
  total: number;
}

export async function fetchFeedPage(params: FeedParams): Promise<FeedPage> {
  const url = new URL(`${API_URL}/api/feed`);
  url.searchParams.set('hours', String(params.hours));
  if (params.providers.length > 0) {
    url.searchParams.set('provider', params.providers.join(','));
  }
  if (params.eventTypes.length > 0) {
    const dbTypes = params.eventTypes.flatMap((t) => EVENT_TYPE_DB_MAP[t] ?? []);
    if (dbTypes.length > 0) {
      url.searchParams.set('eventType', dbTypes.join(','));
    }
  }
  if (params.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }

  const res = await authedFetch(url.toString());

  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }

  const json = (await res.json()) as {
    activities: Activity[];
    nextCursor: string | null;
    total: number;
  };

  return {
    items: json.activities,
    nextCursor: json.nextCursor,
    total: json.total,
  };
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

    const res = await authedFetch(url.toString());
    if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);

    const json = (await res.json()) as {
      activities: Activity[];
      nextCursor: string | null;
      total: number;
    };

    allItems.push(...json.activities);

    cursor = json.nextCursor ?? undefined;
    if (!cursor) break;
  } while (cursor);

  return allItems;
}
