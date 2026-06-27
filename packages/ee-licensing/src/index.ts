// SPDX-License-Identifier: LicenseRef-BUSL-1.1
// SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// Enterprise Edition (commercial) code. This file is NOT part of the
// open-source core and is licensed under the Business Source License 1.1
// (see ../LICENSE). Core packages and apps MUST NOT import from this
// package — the open-core boundary is enforced by eslint.boundaries.cjs.
// See docs/open-core.md for the open-core line and repo-split plan.

/**
 * Skeleton entitlement check for the commercial edition.
 *
 * This is a placeholder that establishes the `@niteowl/ee-*` convention.
 * Real commercial implementations live in the private overlay repo
 * (Option C, FUL-102); this skeleton exists only to anchor the package
 * convention and prove the import-boundary guard.
 */

export interface Entitlement {
  readonly feature: string;
  readonly enabled: boolean;
}

export interface EntitlementContext {
  readonly licenseKey?: string;
  readonly features: readonly string[];
}

/**
 * Returns whether a given feature is entitled under the provided context.
 *
 * Skeleton behaviour: a feature is entitled when a license key is present
 * and the feature is listed. The real implementation (private overlay) will
 * verify a signed license token and decode entitlements from it.
 */
export function isEntitled(context: EntitlementContext, feature: string): boolean {
  if (!context.licenseKey) {
    return false;
  }
  return context.features.includes(feature);
}

/** Edition discriminator for runtime branching in the commercial build. */
export const EDITION = 'enterprise' as const;
export type Edition = typeof EDITION;
