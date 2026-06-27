// Shared runtime utilities for the NiteOwl monorepo.
// Domain types live in @niteowl/types.
import type { ApiResponse } from '@niteowl/types';

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

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function err(message: string): ApiResponse<null> {
  return { success: false, data: null, error: message };
}

export function paginatedOk<T>(items: T[], total: number, page: number, limit: number) {
  return ok({ items, total, page, limit });
}
