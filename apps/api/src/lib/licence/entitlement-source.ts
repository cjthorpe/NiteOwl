// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge

/**
 * Deployment entitlement resolution for the API (FUL-108).
 *
 * Self-hosted ("Enterprise Edition") deployments derive their commercial tier
 * from a signed licence key in the environment, NOT from billing state. This
 * module wires the open-core verifier (`verifyLicence` from `@niteowl/shared`)
 * into a small, pluggable {@link EntitlementSource} so a future
 * `BillingEntitlementSource` (SaaS) can slot in without touching any
 * `hasFeature()` consumer.
 *
 * Everything here FAILS CLOSED to `free`: absent/malformed/expired/tampered
 * licences resolve to the open-source baseline and never throw or block boot.
 */
import {
  DEFAULT_PLAN_TIER,
  hasFeature,
  licencePlanOrFree,
  PLAN_TIERS,
  resolvePlanTier,
  verifyLicence,
  type EntitledAccount,
  type FeatureKey,
  type PlanTier,
} from '@niteowl/shared';

/** Env var names that carry the deployment licence material. */
const LICENCE_KEY_ENV = 'NITEOWL_LICENCE_KEY';
const LICENCE_PUBLIC_KEY_ENV = 'NITEOWL_LICENCE_PUBLIC_KEY';

/**
 * A source of the deployment's commercial plan tier. Today the only
 * implementation is {@link LicenceEntitlementSource}; a billing-backed source
 * can be added later behind the same interface.
 */
export interface EntitlementSource {
  /** Resolve the deployment plan tier, never throwing (defaults to `free`). */
  resolvePlan(): PlanTier;
}

/** Construction inputs for {@link LicenceEntitlementSource}. */
export interface LicenceEntitlementInput {
  /** The signed licence string. Absent → free. */
  licenceKey?: string | undefined;
  /** SPKI PEM (or base64 raw) Ed25519 public key. Absent → free. */
  publicKey?: string | undefined;
  /** Clock override for expiry evaluation (testing). */
  now?: Date | undefined;
}

/**
 * Resolves the deployment plan from a signed licence key via the open-core
 * verifier. Fails closed to `free` on any verification failure.
 */
export class LicenceEntitlementSource implements EntitlementSource {
  private readonly licenceKey?: string | undefined;
  private readonly publicKey?: string | undefined;
  private readonly now?: Date | undefined;

  constructor(input: LicenceEntitlementInput) {
    this.licenceKey = input.licenceKey;
    this.publicKey = input.publicKey;
    this.now = input.now;
  }

  resolvePlan(): PlanTier {
    const result = verifyLicence(this.licenceKey, {
      publicKey: this.publicKey,
      ...(this.now ? { now: this.now } : {}),
    });
    return licencePlanOrFree(result);
  }
}

/**
 * Resolve the deployment plan tier from the environment.
 *
 * Reads `NITEOWL_LICENCE_KEY` and `NITEOWL_LICENCE_PUBLIC_KEY`. NEVER throws —
 * any failure (including unexpected errors) resolves to `free`, so a broken or
 * absent licence can never crash or block API startup.
 *
 * @param env - process env to read from; defaults to `process.env`.
 */
export function resolveDeploymentPlan(env: NodeJS.ProcessEnv = process.env): PlanTier {
  try {
    const source = new LicenceEntitlementSource({
      licenceKey: env[LICENCE_KEY_ENV],
      publicKey: env[LICENCE_PUBLIC_KEY_ENV],
    });
    return source.resolvePlan();
  } catch {
    return DEFAULT_PLAN_TIER;
  }
}

/**
 * Combine an account's own plan with the deployment plan, preferring the HIGHER
 * tier. In a self-hosted deployment the signed licence sets the ceiling for the
 * whole instance, so an account on `free` still gets the deployment's
 * entitlements (and vice versa, a higher-tier account is never downgraded by an
 * absent licence).
 */
export function effectivePlan(
  account: EntitledAccount | PlanTier | null | undefined,
  deploymentPlan: PlanTier,
): PlanTier {
  const accountTier = resolvePlanTier(account);
  const accountRank = PLAN_TIERS.indexOf(accountTier);
  const deploymentRank = PLAN_TIERS.indexOf(deploymentPlan);
  return deploymentRank > accountRank ? deploymentPlan : accountTier;
}

/**
 * Does this account have the given feature, taking the deployment licence into
 * account? Reuses the existing `hasFeature()` primitive against the effective
 * (higher-of) tier — there is NO parallel capability check.
 */
export function accountHasFeature(
  account: EntitledAccount | PlanTier | null | undefined,
  featureKey: FeatureKey,
  deploymentPlan: PlanTier,
): boolean {
  return hasFeature(effectivePlan(account, deploymentPlan), featureKey);
}
