import { describe, expect, it } from 'vitest';

import { APP_NAME, err, ok } from './index';

describe('shared', () => {
  it('APP_NAME is NiteOwl', () => {
    expect(APP_NAME).toBe('NiteOwl');
  });

  it('ok wraps data', () => {
    const result = ok({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
    expect(result.error).toBeNull();
  });

  it('err wraps error message', () => {
    const result = err('something went wrong');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('something went wrong');
  });
});
