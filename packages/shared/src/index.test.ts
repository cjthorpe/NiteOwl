// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import { err, ok } from './index';

describe('ok', () => {
  it('wraps data in a success response', () => {
    const result = ok({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 1 });
    expect(result.error).toBeNull();
  });
});

describe('err', () => {
  it('wraps a message in an error response', () => {
    const result = err('something went wrong');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe('something went wrong');
  });
});
