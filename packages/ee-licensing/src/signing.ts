// SPDX-License-Identifier: LicenseRef-BUSL-1.1
// SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// Enterprise Edition (commercial) code. This file is NOT part of the
// open-source core and is licensed under the Business Source License 1.1
// (see ../LICENSE). Core packages and apps MUST NOT import from this
// package — the open-core boundary is enforced by eslint.boundaries.cjs.
// See docs/open-core.md for the open-core line and repo-split plan.

/**
 * Licence-key SIGNER (FUL-108) — the PRIVATE-KEY half of the licence system.
 *
 * This is the commercial-secret-scope counterpart to the open-core verifier in
 * `@niteowl/shared` (`licence.ts`). It mints signed licence keys and is the
 * only code that ever touches the Ed25519 PRIVATE key. It lives under
 * `packages/ee-licensing` precisely because core → ee imports are banned; the
 * verifier may not import this, but `ee → core` is allowed, so we reuse
 * `LicencePayload` / `LICENCE_FORMAT_VERSION` from `@niteowl/shared` to keep the
 * wire format defined in exactly one place.
 *
 * Wire format (authoritative spec: `docs/licence-key-format.md`):
 *
 *     <base64url(payloadJSON)>.<base64url(ed25519Signature)>
 *
 * The signature is computed over the UTF-8 bytes of the encoded payload STRING,
 * so the signer and verifier agree byte-for-byte with no canonicalisation step.
 */
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';

import { LICENCE_FORMAT_VERSION, type LicencePayload } from '@niteowl/shared';

/** Algorithm is fixed to Ed25519 — never negotiated, never written to a token. */
const KEY_TYPE = 'ed25519';

/** A freshly minted Ed25519 keypair, both halves as PEM strings. */
export interface LicenceKeyPair {
  /** SPKI PEM — the NON-secret verify key, shipped in the open core. */
  publicKeyPem: string;
  /** PKCS8 PEM — the SECRET signing key. Commercial scope ONLY; never ship. */
  privateKeyPem: string;
}

/**
 * Generate a fresh Ed25519 licence signing keypair.
 *
 * The public half is safe to embed in the open-source build
 * (`NITEOWL_LICENCE_PUBLIC_KEY`); the private half must live only in the
 * commercial release secret scope and is used solely by {@link signLicence}.
 */
export function generateLicenceKeyPair(): LicenceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync(KEY_TYPE);
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/**
 * Base64url-encode the canonical JSON of a payload. We normalise the version to
 * `LICENCE_FORMAT_VERSION` so a caller cannot accidentally mint a token the
 * current verifier would reject as `unsupported_version`.
 */
function encodePayload(payload: LicencePayload): string {
  const normalised: LicencePayload = { ...payload, v: LICENCE_FORMAT_VERSION };
  return Buffer.from(JSON.stringify(normalised), 'utf8').toString('base64url');
}

/**
 * Sign a licence payload with the supplied Ed25519 PRIVATE key (PKCS8 PEM).
 *
 * @param payload - the licence claims; `v` is forced to the current format.
 * @param privateKeyPem - PKCS8 PEM private key from {@link generateLicenceKeyPair}.
 * @returns the wire-format licence key `encoded.base64url(sig)`.
 */
export function signLicence(payload: LicencePayload, privateKeyPem: string): string {
  const key: KeyObject | string = privateKeyPem;
  const encodedPayload = encodePayload(payload);
  const signature = edSign(null, Buffer.from(encodedPayload, 'utf8'), key);
  return `${encodedPayload}.${signature.toString('base64url')}`;
}
