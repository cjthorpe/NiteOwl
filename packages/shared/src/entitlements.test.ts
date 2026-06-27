import { describe, expect, it } from 'vitest';

import {
  capabilitiesFor,
  DEFAULT_PLAN_TIER,
  hasFeature,
  isPlanTier,
  PLAN_CAPABILITIES,
  PLAN_TIERS,
  resolvePlanTier,
  type FeatureKey,
  type PlanTier,
} from './entitlements';

const FREE_FEATURE: FeatureKey = 'core.activity_feed';
const PRO_FEATURE: FeatureKey = 'analytics.dashboard';
const ENTERPRISE_FEATURE: FeatureKey = 'sso.saml';

describe('PLAN_TIERS', () => {
  it('lists the three tiers low→high', () => {
    expect(PLAN_TIERS).toEqual(['free', 'pro', 'enterprise']);
  });

  it('defaults to free', () => {
    expect(DEFAULT_PLAN_TIER).toBe('free');
  });
});

describe('isPlanTier', () => {
  it.each(['free', 'pro', 'enterprise'])('accepts %s', (tier) => {
    expect(isPlanTier(tier)).toBe(true);
  });

  it.each([undefined, null, '', 'premium', 'FREE', 42, {}])('rejects %p', (value) => {
    expect(isPlanTier(value)).toBe(false);
  });
});

describe('resolvePlanTier', () => {
  it('defaults missing/null/undefined accounts to free', () => {
    expect(resolvePlanTier(undefined)).toBe('free');
    expect(resolvePlanTier(null)).toBe('free');
    expect(resolvePlanTier({})).toBe('free');
    expect(resolvePlanTier({ plan: null })).toBe('free');
  });

  it('falls back to free for an unrecognised plan value', () => {
    expect(resolvePlanTier({ plan: 'legacy' as unknown as PlanTier })).toBe('free');
  });

  it('passes through a known account plan', () => {
    expect(resolvePlanTier({ plan: 'pro' })).toBe('pro');
    expect(resolvePlanTier({ plan: 'enterprise' })).toBe('enterprise');
  });

  it('accepts a bare tier string', () => {
    expect(resolvePlanTier('enterprise')).toBe('enterprise');
  });
});

describe('hasFeature — free is the default path', () => {
  it('grants free features to an account with no entitlement', () => {
    expect(hasFeature(undefined, FREE_FEATURE)).toBe(true);
    expect(hasFeature(null, FREE_FEATURE)).toBe(true);
    expect(hasFeature({}, FREE_FEATURE)).toBe(true);
    expect(hasFeature({ plan: null }, FREE_FEATURE)).toBe(true);
  });

  it('denies commercial features to a free/defaulted account', () => {
    expect(hasFeature({ plan: 'free' }, PRO_FEATURE)).toBe(false);
    expect(hasFeature(undefined, PRO_FEATURE)).toBe(false);
    expect(hasFeature({}, ENTERPRISE_FEATURE)).toBe(false);
  });

  it('treats an unknown plan as free, not as fully entitled', () => {
    const rogue = { plan: 'enterprise-trial' as unknown as PlanTier };
    expect(hasFeature(rogue, FREE_FEATURE)).toBe(true);
    expect(hasFeature(rogue, ENTERPRISE_FEATURE)).toBe(false);
  });
});

describe('hasFeature — tiers are additive', () => {
  it('pro keeps every free capability and adds its own', () => {
    expect(hasFeature({ plan: 'pro' }, FREE_FEATURE)).toBe(true);
    expect(hasFeature({ plan: 'pro' }, PRO_FEATURE)).toBe(true);
    expect(hasFeature({ plan: 'pro' }, ENTERPRISE_FEATURE)).toBe(false);
  });

  it('enterprise is a superset of pro and free', () => {
    expect(hasFeature({ plan: 'enterprise' }, FREE_FEATURE)).toBe(true);
    expect(hasFeature({ plan: 'enterprise' }, PRO_FEATURE)).toBe(true);
    expect(hasFeature({ plan: 'enterprise' }, ENTERPRISE_FEATURE)).toBe(true);
  });

  it('every lower-tier capability is contained in each higher tier', () => {
    for (const free of PLAN_CAPABILITIES.free) {
      expect(PLAN_CAPABILITIES.pro.has(free)).toBe(true);
      expect(PLAN_CAPABILITIES.enterprise.has(free)).toBe(true);
    }
    for (const pro of PLAN_CAPABILITIES.pro) {
      expect(PLAN_CAPABILITIES.enterprise.has(pro)).toBe(true);
    }
  });

  it('capability set sizes grow strictly with tier', () => {
    expect(PLAN_CAPABILITIES.free.size).toBeLessThan(PLAN_CAPABILITIES.pro.size);
    expect(PLAN_CAPABILITIES.pro.size).toBeLessThan(PLAN_CAPABILITIES.enterprise.size);
  });
});

describe('capabilitiesFor', () => {
  it('returns the resolved tier capability set', () => {
    expect(capabilitiesFor({ plan: 'pro' })).toBe(PLAN_CAPABILITIES.pro);
    expect(capabilitiesFor(undefined)).toBe(PLAN_CAPABILITIES.free);
  });
});
