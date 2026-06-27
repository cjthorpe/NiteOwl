// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';
import { normalizeLinearEvent } from './linear.js';

const USER_ID = 'user-abc-123';

// ---------------------------------------------------------------------------
// Fixtures — derived from Linear webhook documentation
// ---------------------------------------------------------------------------

const issueCreatedPayload = {
  type: 'Issue',
  action: 'create',
  organizationId: 'org-xyz-999',
  data: {
    id: 'linear-issue-001',
    identifier: 'ENG-123',
    title: 'Add OAuth2 support for GitHub',
    description: 'We need to support GitHub OAuth2 login flow.',
    url: 'https://linear.app/acme/issue/ENG-123',
    state: { name: 'Todo', type: 'started' },
    team: { name: 'Engineering', key: 'ENG' },
    createdAt: '2024-03-10T09:00:00.000Z',
    updatedAt: '2024-03-10T09:00:00.000Z',
    completedAt: null,
    canceledAt: null,
    assignee: { name: 'Alice', email: 'alice@acme.com' },
    creator: { name: 'Bob', email: 'bob@acme.com' },
  },
};

const issueCompletedPayload = {
  type: 'Issue',
  action: 'update',
  organizationId: 'org-xyz-999',
  data: {
    id: 'linear-issue-001',
    identifier: 'ENG-123',
    title: 'Add OAuth2 support for GitHub',
    description: null,
    url: 'https://linear.app/acme/issue/ENG-123',
    state: { name: 'Done', type: 'completed' },
    team: { name: 'Engineering', key: 'ENG' },
    createdAt: '2024-03-10T09:00:00.000Z',
    updatedAt: '2024-03-12T15:00:00.000Z',
    completedAt: '2024-03-12T15:00:00.000Z',
    canceledAt: null,
    assignee: null,
    creator: { name: 'Bob', email: 'bob@acme.com' },
  },
};

const issueUpdatedPayload = {
  type: 'Issue',
  action: 'update',
  organizationId: 'org-xyz-999',
  data: {
    id: 'linear-issue-002',
    identifier: 'ENG-124',
    title: 'Update README docs',
    description: 'Improve onboarding docs.',
    url: 'https://linear.app/acme/issue/ENG-124',
    state: { name: 'In Progress', type: 'started' },
    team: { name: 'Engineering', key: 'ENG' },
    createdAt: '2024-03-11T11:00:00.000Z',
    updatedAt: '2024-03-11T14:00:00.000Z',
    completedAt: null,
    canceledAt: null,
    assignee: { name: 'Charlie', email: 'charlie@acme.com' },
    creator: null,
  },
};

const issueRemovedPayload = {
  type: 'Issue',
  action: 'remove',
  organizationId: 'org-xyz-999',
  data: {
    id: 'linear-issue-003',
    identifier: 'ENG-125',
    title: 'Deprecated feature ticket',
    url: 'https://linear.app/acme/issue/ENG-125',
    state: { name: 'Cancelled', type: 'cancelled' },
    team: { name: 'Engineering', key: 'ENG' },
    createdAt: '2024-02-01T10:00:00.000Z',
    updatedAt: '2024-03-10T10:00:00.000Z',
    completedAt: null,
    canceledAt: '2024-03-10T10:00:00.000Z',
    assignee: null,
    creator: null,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeLinearEvent — issue_opened', () => {
  it('normalizes a create action', () => {
    const result = normalizeLinearEvent(issueCreatedPayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe('linear');
    expect(result?.eventType).toBe('issue_opened');
    expect(result?.userId).toBe(USER_ID);
    expect(result?.title).toBe('[ENG] ENG-123: Add OAuth2 support for GitHub');
    expect(result?.description).toBe('We need to support GitHub OAuth2 login flow.');
    expect(result?.url).toBe('https://linear.app/acme/issue/ENG-123');
    expect(result?.sourceId).toBe('issue:linear-issue-001:create');
    expect(result?.metadata).toMatchObject({
      identifier: 'ENG-123',
      teamKey: 'ENG',
      assignee: 'Alice',
    });
    expect(result?.occurredAt).toBe('2024-03-10T09:00:00.000Z');
  });
});

describe('normalizeLinearEvent — issue_closed', () => {
  it('uses completedAt when state type is completed', () => {
    const result = normalizeLinearEvent(issueCompletedPayload, USER_ID);

    expect(result?.eventType).toBe('issue_closed');
    expect(result?.occurredAt).toBe('2024-03-12T15:00:00.000Z');
    expect(result?.description).toBeUndefined();
  });

  it('normalizes a remove action as issue_closed', () => {
    const result = normalizeLinearEvent(issueRemovedPayload, USER_ID);

    expect(result?.eventType).toBe('issue_closed');
    expect(result?.sourceId).toBe('issue:linear-issue-003:remove');
  });
});

describe('normalizeLinearEvent — issue_updated', () => {
  it('normalizes an update action in a non-terminal state', () => {
    const result = normalizeLinearEvent(issueUpdatedPayload, USER_ID);

    expect(result?.eventType).toBe('issue_updated');
    expect(result?.occurredAt).toBe('2024-03-11T14:00:00.000Z');
    expect(result?.metadata).toMatchObject({ stateType: 'started' });
  });
});

describe('normalizeLinearEvent — invalid payloads', () => {
  it('returns null for non-Issue type payloads', () => {
    expect(
      normalizeLinearEvent({ type: 'Comment', action: 'create', data: {} }, USER_ID),
    ).toBeNull();
  });

  it('returns null for missing data field', () => {
    expect(normalizeLinearEvent({ type: 'Issue', action: 'create' }, USER_ID)).toBeNull();
  });

  it('returns null for empty payload', () => {
    expect(normalizeLinearEvent({}, USER_ID)).toBeNull();
  });
});

describe('normalizeLinearEvent — determinism', () => {
  it('produces stable non-volatile fields across two calls', () => {
    const a = normalizeLinearEvent(issueCreatedPayload, USER_ID);
    const b = normalizeLinearEvent(issueCreatedPayload, USER_ID);

    const { id: _ia, ingestedAt: _iia, ...restA } = a!;
    const { id: _ib, ingestedAt: _iib, ...restB } = b!;

    expect(restA).toEqual(restB);
  });
});
