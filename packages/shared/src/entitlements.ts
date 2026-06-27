// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * Entitlements primitive — the single source of truth for what each commercial
 * plan tier can do. Consumed by BOTH API route guards and web UI gating, so it
 * lives in the isomorphic `@niteowl/shared` layer (never `@niteowl/db`, which
 * carries server-only deps the browser must not import).
 *
 * Design contract:
 *   - `free` is the DEFAULT path. An account with no plan, a null plan, or an
 *     unrecognised plan resolves to the free capability set.
 *   - Commercial tiers are strictly ADDITIVE: `pro` grants everything `free`
 *     does plus its extras; `enterprise` grants everything `pro` does plus its
 *     extras. No commercial feature ever removes a free capability.
 *   - The `PlanTier` union MUST stay in sync with the `plan` pgEnum in
 *     `@niteowl/db` (src/schema.ts), which is the persisted representation.
 */

/**
 * Commercial plan tiers. Mirrors the `plan` pgEnum in `@niteowl/db`.
 * `free` is the open-source default.
 */
export type PlanTier = 'free' | 'pro' | 'enterprise';

/** Ordered low→high. Used to validate inputs and reason about tiers. */
export const PLAN_TIERS: readonly PlanTier[] = ['free', 'pro', 'enterprise'] as const;

/** The default tier when an account has no explicit plan. */
export const DEFAULT_PLAN_TIER: PlanTier = 'free';

/**
 * Every gateable capability in the product. Free capabilities are the
 * open-source baseline; the rest are commercial overlays. Keep this a closed
 * union so both guards and UI gating fail to compile on a typo'd feature key.
 */
export type FeatureKey =
  // --- free / open-source baseline ---
  | 'core.activity_feed'
  | 'integrations.core'
  | 'slack.alerts'
  // --- pro overlay ---
  | 'integrations.unlimited'
  | 'alerts.advanced'
  | 'analytics.dashboard'
  // --- enterprise overlay ---
  | 'sso.saml'
  | 'audit.log'
  | 'support.priority';

/** Capabilities granted by the free (open-source) tier. */
const FREE_FEATURES: readonly FeatureKey[] = [
  'core.activity_feed',
  'integrations.core',
  'slack.alerts',
] as const;

/** Additional capabilities the pro tier adds on top of free. */
const PRO_FEATURES: readonly FeatureKey[] = [
  'integrations.unlimited',
  'alerts.advanced',
  'analytics.dashboard',
] as const;

/** Additional capabilities the enterprise tier adds on top of pro. */
const ENTERPRISE_FEATURES: readonly FeatureKey[] = [
  'sso.saml',
  'audit.log',
  'support.priority',
] as const;

/**
 * Plan → capability set. Built additively so the invariant "higher tier is a
 * superset of every lower tier" holds by construction. A `ReadonlySet` makes
 * `hasFeature` O(1) and the set non-mutable at runtime.
 */
export const PLAN_CAPABILITIES: Readonly<Record<PlanTier, ReadonlySet<FeatureKey>>> = {
  free: new Set(FREE_FEATURES),
  pro: new Set([...FREE_FEATURES, ...PRO_FEATURES]),
  enterprise: new Set([...FREE_FEATURES, ...PRO_FEATURES, ...ENTERPRISE_FEATURES]),
};

/**
 * The minimal shape `hasFeature` needs from an account. Structural on purpose:
 * the `@niteowl/db` `User` row, a JWT claim, or any web-side view model all
 * satisfy it without `@niteowl/shared` taking a dependency on the database
 * package. `plan` is optional/nullable so a partially-loaded or legacy account
 * transparently falls back to free.
 */
export interface EntitledAccount {
  plan?: PlanTier | null;
}

/** Type guard: is the given value one of the known plan tiers? */
export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Resolve an account (or raw plan value) to a known tier, defaulting to `free`.
 * Anything missing, null, or unrecognised becomes `free` — never throws.
 */
export function resolvePlanTier(account: EntitledAccount | PlanTier | null | undefined): PlanTier {
  if (isPlanTier(account)) return account;
  const plan = account?.plan;
  return isPlanTier(plan) ? plan : DEFAULT_PLAN_TIER;
}

/**
 * Does this account's plan grant the given feature?
 *
 * The gating primitive used by both API route guards and web UI. Free is the
 * default: an account with no entitlement, a null plan, or an unknown plan
 * resolves to the free capability set rather than being denied everything.
 *
 * @param account - account-like value carrying an optional `plan`, or a bare tier
 * @param featureKey - the capability to check
 */
export function hasFeature(
  account: EntitledAccount | PlanTier | null | undefined,
  featureKey: FeatureKey,
): boolean {
  const tier = resolvePlanTier(account);
  return PLAN_CAPABILITIES[tier].has(featureKey);
}

/** The full capability set for an account's resolved tier (defaults to free). */
export function capabilitiesFor(
  account: EntitledAccount | PlanTier | null | undefined,
): ReadonlySet<FeatureKey> {
  return PLAN_CAPABILITIES[resolvePlanTier(account)];
}
