// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge

/**
 * Self-hosted signed licence-key verifier (FUL-108).
 *
 * This is the PUBLIC-KEY-ONLY half of the licence system and is therefore safe
 * to ship in the open-source core (`@niteowl/shared`). The private signing key
 * never appears here — it lives only in the commercial `@niteowl/ee-licensing`
 * package (`signLicence`). The open-core import boundary
 * (`eslint.boundaries.cjs`) forbids core → ee imports, which is exactly why the
 * verifier and signer are split.
 *
 * Wire format (see `docs/licence-key-format.md` — the authoritative spec):
 *
 *     <base64url(payloadJSON)>.<base64url(ed25519Signature)>
 *
 * Two `.`-separated base64url segments. There is NO header segment: the
 * algorithm is hard-pinned to Ed25519 in this file and never read from the
 * token, which structurally defeats algorithm-confusion / `alg:none` downgrade
 * attacks. The signature is computed over the UTF-8 bytes of the FIRST segment
 * string (the encoded payload), so there is zero canonicalisation ambiguity.
 *
 * Design contract (mirrors the entitlements primitive): the verifier FAILS
 * CLOSED to `free`. Missing, malformed, expired, tampered, wrong-key,
 * unsupported-version, and unknown-plan licences all resolve to the free
 * capability set. Verification NEVER throws to the caller — any unexpected
 * error is caught and reported as a structured failure.
 *
 * The resolved plan tier is fed straight into the existing
 * `hasFeature()` / `PLAN_CAPABILITIES` path. There is no parallel entitlement
 * check: a licence can only ever select a tier, never grant a capability the
 * tier does not already define.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { DEFAULT_PLAN_TIER, isPlanTier, type PlanTier } from './entitlements';

/**
 * The only licence format version this verifier understands. A token whose
 * `v` differs resolves to `unsupported_version` (→ free), reserving room for a
 * future format migration without silently honouring a shape we don't grok.
 */
export const LICENCE_FORMAT_VERSION = 1;

/** The number of `.`-separated segments in a well-formed licence key. */
const EXPECTED_SEGMENT_COUNT = 2;

/** Milliseconds per second — `exp`/`iat` are unix SECONDS in the payload. */
const MS_PER_SECOND = 1000;

/**
 * The decoded, signature-verified licence payload.
 *
 * Only `v` and `plan` are load-bearing for entitlement resolution; the rest are
 * optional informational fields the signer MAY include. Untrusted on the wire —
 * every field is validated/narrowed before use, and none is trusted until the
 * Ed25519 signature has been verified.
 */
export interface LicencePayload {
  /** Format version. Must equal `LICENCE_FORMAT_VERSION`. */
  v: number;
  /** Requested plan tier label, e.g. `"pro"` / `"enterprise"`. */
  plan: string;
  /** OPTIONAL informational subject (customer/account label). */
  sub?: string;
  /** OPTIONAL issuer label. */
  iss?: string;
  /** OPTIONAL issued-at, unix seconds. */
  iat?: number;
  /** OPTIONAL expiry, unix seconds. `now >= exp` → expired → free. */
  exp?: number;
}

/**
 * Why a licence failed to resolve to a commercial tier. Every value maps to the
 * fail-closed `free` outcome; the distinction exists for diagnostics/logging,
 * never to change the security decision.
 */
export type LicenceFailureReason =
  | 'absent_key'
  | 'absent_public_key'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'unsupported_version'
  | 'unknown_plan';

/**
 * Discriminated result of {@link verifyLicence}. On success it carries both the
 * raw verified `payload` and the resolved {@link PlanTier}; on failure it
 * carries only a {@link LicenceFailureReason}. Callers that just want a tier
 * should use {@link licencePlanOrFree}.
 */
export type LicenceVerifyResult =
  | { ok: true; payload: LicencePayload; plan: PlanTier }
  | { ok: false; reason: LicenceFailureReason };

/** Options for {@link verifyLicence}. */
export interface VerifyLicenceOptions {
  /**
   * The Ed25519 PUBLIC key used to verify the signature. SPKI PEM is accepted
   * at minimum; a base64-encoded raw/DER SPKI key is also accepted as a
   * convenience. Absent → no licence can be verified → `absent_public_key`.
   */
  publicKey: string | undefined | null;
  /** Clock to evaluate expiry against. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Decode a base64url segment to a Buffer, rejecting anything that is not valid
 * base64url. `Buffer.from(_, 'base64url')` is lenient (it silently drops
 * invalid characters), so we re-encode and compare to catch tampering that
 * would otherwise be quietly accepted.
 */
function decodeBase64UrlStrict(segment: string): Buffer {
  const buf = Buffer.from(segment, 'base64url');
  // Round-trip check: a faithful base64url segment re-encodes to itself.
  if (buf.toString('base64url') !== segment) {
    throw new Error('segment is not valid base64url');
  }
  return buf;
}

/**
 * Coerce the supplied public-key material into a Node `KeyObject`.
 *
 * Accepts (in order): an SPKI PEM string, or a base64-encoded raw DER SPKI key
 * which we wrap into PEM. Throws on anything unusable — the caller maps that to
 * a fail-closed result.
 */
function loadPublicKey(publicKey: string): KeyObject {
  const trimmed = publicKey.trim();
  if (trimmed.includes('-----BEGIN')) {
    return createPublicKey(trimmed);
  }
  // Treat as base64 raw DER SPKI; wrap into a PEM envelope.
  const pem = `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----\n`;
  return createPublicKey(pem);
}

/**
 * Narrow an unknown parsed value into a {@link LicencePayload}. Validates only
 * the structural invariants needed downstream: `v` is a number and `plan` is a
 * string. Optional fields are accepted only when they have the right primitive
 * type and otherwise dropped, never coerced.
 */
function parsePayload(value: unknown): LicencePayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('payload is not an object');
  }
  const record = value as Record<string, unknown>;
  const { v, plan, sub, iss, iat, exp } = record;
  if (typeof v !== 'number' || typeof plan !== 'string') {
    throw new Error('payload missing required v/plan fields');
  }
  const payload: LicencePayload = { v, plan };
  if (typeof sub === 'string') payload.sub = sub;
  if (typeof iss === 'string') payload.iss = iss;
  if (typeof iat === 'number') payload.iat = iat;
  if (typeof exp === 'number') payload.exp = exp;
  return payload;
}

/**
 * Verify a signed licence key and resolve it to a plan tier.
 *
 * Algorithm is HARD-PINNED to Ed25519 — no `alg` is ever read from the token.
 * Checks run in this order, and the signature is verified BEFORE any payload
 * field is trusted:
 *
 *   1. structure / parse  → `absent_key` | `absent_public_key` | `malformed`
 *   2. signature          → `bad_signature`
 *   3. version            → `unsupported_version`
 *   4. expiry             → `expired`
 *   5. plan               → `unknown_plan`
 *
 * Never throws: any unexpected error is wrapped into a fail-closed result.
 *
 * @param licenceKey - the `payload.sig` licence string (or absent).
 * @param opts - `{ publicKey, now? }`.
 * @returns a discriminated {@link LicenceVerifyResult}.
 */
export function verifyLicence(
  licenceKey: string | undefined | null,
  opts: VerifyLicenceOptions,
): LicenceVerifyResult {
  try {
    if (typeof licenceKey !== 'string' || licenceKey.length === 0) {
      return { ok: false, reason: 'absent_key' };
    }
    if (typeof opts.publicKey !== 'string' || opts.publicKey.trim().length === 0) {
      return { ok: false, reason: 'absent_public_key' };
    }

    // --- 1. structure / parse ---
    const segments = licenceKey.split('.');
    if (segments.length !== EXPECTED_SEGMENT_COUNT) {
      return { ok: false, reason: 'malformed' };
    }
    const [encodedPayload, encodedSig] = segments as [string, string];
    if (encodedPayload.length === 0 || encodedSig.length === 0) {
      return { ok: false, reason: 'malformed' };
    }

    let payloadBuf: Buffer;
    let signatureBuf: Buffer;
    try {
      payloadBuf = decodeBase64UrlStrict(encodedPayload);
      signatureBuf = decodeBase64UrlStrict(encodedSig);
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    let payload: LicencePayload;
    try {
      payload = parsePayload(parsed);
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    // --- 2. signature (verified BEFORE trusting any payload field) ---
    let keyObject: KeyObject;
    try {
      keyObject = loadPublicKey(opts.publicKey);
    } catch {
      // A public key we cannot parse can verify nothing → fail closed.
      return { ok: false, reason: 'absent_public_key' };
    }

    // The signature covers the UTF-8 bytes of the FIRST segment STRING — the
    // exact encoded-payload characters on the wire — not re-serialised JSON.
    const signedBytes = Buffer.from(encodedPayload, 'utf8');
    let signatureValid: boolean;
    try {
      signatureValid = verify(null, signedBytes, keyObject, signatureBuf);
    } catch {
      // e.g. wrong key type / malformed signature buffer.
      return { ok: false, reason: 'bad_signature' };
    }
    if (!signatureValid) {
      return { ok: false, reason: 'bad_signature' };
    }

    // --- 3. version ---
    if (payload.v !== LICENCE_FORMAT_VERSION) {
      return { ok: false, reason: 'unsupported_version' };
    }

    // --- 4. expiry ---
    if (typeof payload.exp === 'number') {
      const nowMs = (opts.now ?? new Date()).getTime();
      if (nowMs >= payload.exp * MS_PER_SECOND) {
        return { ok: false, reason: 'expired' };
      }
    }

    // --- 5. plan ---
    // A licence may only SELECT a commercial tier; `free` (or anything not a
    // known tier) is not a licensable upgrade and resolves to unknown_plan.
    if (!isPlanTier(payload.plan) || payload.plan === DEFAULT_PLAN_TIER) {
      return { ok: false, reason: 'unknown_plan' };
    }

    return { ok: true, payload, plan: payload.plan };
  } catch {
    // Defence in depth: nothing above should escape, but if it does we still
    // fail closed rather than crash the caller.
    return { ok: false, reason: 'malformed' };
  }
}

/**
 * Collapse a {@link LicenceVerifyResult} to a plan tier, defaulting to `free`
 * on any failure. This is the fail-closed accessor most callers want.
 */
export function licencePlanOrFree(result: LicenceVerifyResult): PlanTier {
  return result.ok ? result.plan : DEFAULT_PLAN_TIER;
}
