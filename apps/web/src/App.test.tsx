import { describe, expect, it } from 'vitest';

describe('App module', () => {
  it('exists', async () => {
    const module = await import('./App');
    expect(module.default).toBeDefined();
  });
});
