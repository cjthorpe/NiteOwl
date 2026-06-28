// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
// Shared runtime utilities for the NiteOwl monorepo.
// Domain types live in @niteowl/types.
import type { ApiResponse } from '@niteowl/types';

// Briefing digest (FUL-122/FUL-136). Pure + node-free; also exposed via the
// `@niteowl/shared/briefing-digest` subpath so the browser can import it without
// pulling the `node:crypto`-backed modules re-exported below.
export type {
  BriefingDigest,
  BriefingDigestInput,
  BriefingHighlight,
  BriefingHighlightKind,
  DigestActivity,
  DigestAgentGroup,
  DigestSummary,
} from './briefing-digest';
export { buildBriefingDigest } from './briefing-digest';

export type { EncryptedToken } from './crypto';
export {
  decryptToken,
  encryptToken,
  parseEncryptedToken,
  serializeEncryptedToken,
  timingSafeCompare,
} from './crypto';

export type { EntitledAccount, FeatureKey, PlanTier } from './entitlements';
export {
  capabilitiesFor,
  DEFAULT_PLAN_TIER,
  hasFeature,
  isPlanTier,
  PLAN_CAPABILITIES,
  PLAN_TIERS,
  resolvePlanTier,
} from './entitlements';

export type {
  LicenceFailureReason,
  LicencePayload,
  LicenceVerifyResult,
  VerifyLicenceOptions,
} from './licence';
export { LICENCE_FORMAT_VERSION, licencePlanOrFree, verifyLicence } from './licence';

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function err(message: string): ApiResponse<null> {
  return { success: false, data: null, error: message };
}

export function paginatedOk<T>(items: T[], total: number, page: number, limit: number) {
  return ok({ items, total, page, limit });
}
