import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedFetch, setAccessToken } from './auth';

/**
 * Regression coverage for FUL-79 follow-up.
 *
 * The dashboard wedged on "Couldn't load your feed" when a request hit the API
 * with an expired/stale access token: the data layer surfaced the 401 with no
 * recovery. authedFetch must silently refresh once on a 401 and retry, and fall
 * back to the original 401 (without looping) when the refresh also fails.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('authedFetch', () => {
  beforeEach(() => {
    setAccessToken('stale-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  it('passes through a successful response without refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('https://api.test/api/feed');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer stale-token');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = vi
      .fn()
      // 1. initial request with the stale token → 401
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }))
      // 2. refresh exchange succeeds
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { accessToken: 'fresh' } }))
      // 3. retried request with the fresh token → 200
      .mockResolvedValueOnce(jsonResponse(200, { activities: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('https://api.test/api/feed');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryInit = fetchMock.mock.calls[2]![1];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('returns the original 401 (no infinite retry) when refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'refresh expired' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch('https://api.test/api/feed');

    expect(res.status).toBe(401);
    // initial request + one refresh attempt, then stop
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
