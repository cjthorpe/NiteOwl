// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
export type TimeRange = '8h' | '12h' | '24h' | 'custom';

export type Integration = 'github' | 'linear' | 'jira' | 'slack';

export type EventType = 'prs' | 'commits' | 'issues' | 'reviews' | 'comments';

export interface FilterState {
  timeRange: TimeRange;
  integrations: Integration[];
  eventTypes: EventType[];
}

export const DEFAULT_FILTERS: FilterState = {
  timeRange: '8h',
  integrations: [],
  eventTypes: [],
};

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '8h': 'Last 8h',
  '12h': 'Last 12h',
  '24h': 'Last 24h',
  custom: 'Custom',
};

export const INTEGRATION_LABELS: Record<Integration, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  slack: 'Slack',
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  prs: 'PRs',
  commits: 'Commits',
  issues: 'Issues',
  reviews: 'Reviews',
  comments: 'Comments',
};

export const ALL_INTEGRATIONS: Integration[] = ['github', 'linear', 'jira', 'slack'];
export const ALL_EVENT_TYPES: EventType[] = ['prs', 'commits', 'issues', 'reviews', 'comments'];
export const ALL_TIME_RANGES: TimeRange[] = ['8h', '12h', '24h', 'custom'];
