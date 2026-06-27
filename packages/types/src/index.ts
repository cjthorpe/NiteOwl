// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
// Shared domain types for NiteOwl

export type UserId = string;
export type Timestamp = string; // ISO 8601

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: Timestamp;
  services: {
    db: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

// Activity normalization types

export type ActivityProvider = 'github' | 'linear' | 'jira' | 'slack';

export type ActivityEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'commit_pushed'
  | 'issue_opened'
  | 'issue_closed'
  | 'issue_updated'
  | 'comment_created';

export interface Activity {
  id: string;
  userId: string;
  provider: ActivityProvider;
  eventType: ActivityEventType;
  /** Provider's native event/object ID — used for deduplication */
  sourceId: string;
  title: string;
  description?: string;
  url: string;
  /** Arbitrary provider-specific payload fields */
  metadata: Record<string, unknown>;
  /** Agent login extracted at ingestion time (FUL-58) */
  authorLogin?: string | null;
  /** When the event occurred according to the provider */
  occurredAt: Timestamp;
  /** When we ingested the event */
  ingestedAt: Timestamp;
}

/** Raw BullMQ job data for the normalization queue */
export interface NormalizationJobData {
  provider: ActivityProvider;
  userId: string;
  /** The integration that triggered this event — used for DB deduplication */
  integrationId: string;
  payload: Record<string, unknown>;
}

/** Raw BullMQ job data for the slack-alert queue (FUL-34) */
export interface SlackAlertJobData {
  /** The slack_alert_configs row to use — looked up fresh on each attempt so config changes / deletions are respected */
  configId: string;
  userId: string;
  alertData: {
    repo: string;
    prNumber: number;
    prTitle: string;
    author: string;
    url: string;
    baseBranch: string;
    occurredAt: string; // ISO 8601
  };
}
