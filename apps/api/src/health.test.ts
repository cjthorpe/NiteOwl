import { describe, expect, it } from 'vitest';

import { ok } from '@niteowl/shared';

describe('health response shape', () => {
  it('returns a success envelope', () => {
    const response = ok({ status: 'ok', timestamp: new Date().toISOString() });
    expect(response.success).toBe(true);
    expect(response.data?.status).toBe('ok');
  });
});
