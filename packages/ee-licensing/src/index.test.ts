// SPDX-License-Identifier: LicenseRef-BUSL-1.1
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import { EDITION, isEntitled } from './index';

describe('isEntitled', () => {
  it('denies when no license key is present', () => {
    expect(isEntitled({ features: ['sso'] }, 'sso')).toBe(false);
  });

  it('denies a feature not granted by the license', () => {
    expect(isEntitled({ licenseKey: 'k', features: ['sso'] }, 'audit-log')).toBe(false);
  });

  it('grants a listed feature when a license key is present', () => {
    expect(isEntitled({ licenseKey: 'k', features: ['sso'] }, 'sso')).toBe(true);
  });
});

describe('EDITION', () => {
  it('identifies the enterprise edition', () => {
    expect(EDITION).toBe('enterprise');
  });
});
