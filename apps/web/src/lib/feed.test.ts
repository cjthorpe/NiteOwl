// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchFeedPage } from './feed';

const authedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('./auth', () => ({
  authedFetch: authedFetchMock,
}));

function okResponse() {
  return {
    ok: true,
    json: async () => ({ activities: [], nextCursor: null, total: 0 }),
  } as unknown as Response;
}

function requestedUrl(): URL {
  const arg = authedFetchMock.mock.calls[0]![0] as string;
  return new URL(arg);
}

describe('fetchFeedPage query param wiring', () => {
  afterEach(() => {
    authedFetchMock.mockReset();
  });

  it('includes repo and author params when provided', async () => {
    authedFetchMock.mockResolvedValue(okResponse());

    await fetchFeedPage({
      hours: 8,
      providers: [],
      eventTypes: [],
      repo: 'acme/widgets',
      author: 'octocat',
    });

    const url = requestedUrl();
    expect(url.searchParams.get('repo')).toBe('acme/widgets');
    expect(url.searchParams.get('author')).toBe('octocat');
  });

  it('omits repo and author params when unset', async () => {
    authedFetchMock.mockResolvedValue(okResponse());

    await fetchFeedPage({ hours: 8, providers: [], eventTypes: [] });

    const url = requestedUrl();
    expect(url.searchParams.has('repo')).toBe(false);
    expect(url.searchParams.has('author')).toBe(false);
  });
});
