/**
 * Integration tests for GET /api/briefing/digest (FUL-136).
 * Uses Fastify inject + mock DB — no real network. The LLM is disabled in the
 * test env, so every response exercises the guaranteed heuristic fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildApp } from '../../app.js';
import { signAccessToken } from '../../lib/jwt.js';

const redisMock = {
  status: 'ready' as string,
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  sadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
  connect: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('ioredis', () => {
  const ctor = vi.fn().mockImplementation(() => redisMock);
  return { default: ctor, Redis: ctor };
});

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
};

const USER_ID = 'b1234567-0000-0000-0000-000000000002';
let authHeader: string;

beforeEach(async () => {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long!!';
  process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!';
  // Ensure the LLM layer stays disabled regardless of the ambient environment.
  delete process.env['BRIEFING_LLM_ENABLED'];
  delete process.env['ANTHROPIC_API_KEY'];

  vi.clearAllMocks();
  mockDb.select.mockReturnThis();
  mockDb.from.mockReturnThis();
  mockDb.where.mockReturnThis();
  mockDb.orderBy.mockReturnThis();
  mockDb.limit.mockResolvedValue([]);

  redisMock.status = 'ready';
  redisMock.on.mockImplementation(() => undefined);

  const token = await signAccessToken(USER_ID, 'test@example.com');
  authHeader = `Bearer ${token}`;
});

describe('GET /api/briefing/digest', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({ method: 'GET', url: '/api/briefing/digest' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a quiet heuristic digest when the window is empty', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/briefing/digest',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ headline: string; highlights: unknown[]; source: string }>();
    expect(body.source).toBe('heuristic');
    expect(body.headline).toMatch(/quiet/i);
    expect(body.highlights).toEqual([]);
  });

  it('builds a heuristic digest from activity rows (LLM disabled)', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { provider: 'github', eventType: 'pr_opened', authorLogin: 'alice' },
      { provider: 'github', eventType: 'pr_merged', authorLogin: 'alice' },
      { provider: 'linear', eventType: 'issue_closed', authorLogin: 'bob' },
    ]);

    const app = buildApp({ db: mockDb as never });
    const res = await app.inject({
      method: 'GET',
      url: '/api/briefing/digest',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      headline: string;
      highlights: { kind: string; text: string }[];
      source: string;
    }>();
    expect(body.source).toBe('heuristic');
    expect(body.headline).toContain('3 updates');
    // Open PR awaiting review must surface as the first, actionable highlight.
    expect(body.highlights[0]?.kind).toBe('needs_review');
    expect(body.highlights.some((h) => h.kind === 'providers')).toBe(true);
  });
});
