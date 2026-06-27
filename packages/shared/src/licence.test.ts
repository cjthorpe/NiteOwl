// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { hasFeature, type PlanTier } from './entitlements';
import {
  LICENCE_FORMAT_VERSION,
  licencePlanOrFree,
  verifyLicence,
  type LicencePayload,
} from './licence';

/**
 * Local signer — `@niteowl/shared` (core) must NOT depend on the commercial
 * `@niteowl/ee-licensing` signer, so we inline the signing logic here. This
 * mirrors `signLicence` exactly: encode payload as base64url, Ed25519-sign the
 * UTF-8 bytes of that encoded STRING, append `.base64url(sig)`.
 */
function signLicenceForTest(payload: LicencePayload, privateKey: KeyObject): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = edSign(null, Buffer.from(encodedPayload, 'utf8'), privateKey);
  return `${encodedPayload}.${signature.toString('base64url')}`;
}

/** Generate a fresh Ed25519 keypair and return PEM + KeyObject handles. */
function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const NOW = new Date('2026-06-27T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const FUTURE = NOW_SECONDS + 60 * 60 * 24 * 365; // +1 year
const PAST = NOW_SECONDS - 60 * 60 * 24; // -1 day

const { privateKey, publicKeyPem } = makeKeyPair();

function validPayload(plan: PlanTier, overrides: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: LICENCE_FORMAT_VERSION,
    plan,
    sub: 'acme-corp',
    iss: 'niteowl-licensing',
    iat: NOW_SECONDS,
    exp: FUTURE,
    ...overrides,
  };
}

describe('verifyLicence — valid licences', () => {
  it('resolves a valid enterprise licence to the enterprise tier', () => {
    const key = signLicenceForTest(validPayload('enterprise'), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.plan).toBe('enterprise');
    expect(result.payload.sub).toBe('acme-corp');
    // Proves integration with the existing entitlements path.
    expect(hasFeature(result.plan, 'sso.saml')).toBe(true);
  });

  it('resolves a valid pro licence to the pro tier (no enterprise features)', () => {
    const key = signLicenceForTest(validPayload('pro'), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });

    expect(licencePlanOrFree(result)).toBe('pro');
    expect(hasFeature(licencePlanOrFree(result), 'analytics.dashboard')).toBe(true);
    expect(hasFeature(licencePlanOrFree(result), 'sso.saml')).toBe(false);
  });

  it('accepts a licence with no exp (never expires)', () => {
    const payload = validPayload('enterprise');
    delete payload.exp;
    const key = signLicenceForTest(payload, privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(licencePlanOrFree(result)).toBe('enterprise');
  });

  it('accepts a base64-raw (DER SPKI) public key, not just PEM', () => {
    const { privateKey: pk, publicKeyPem: pem } = makeKeyPair();
    const rawBase64 = pem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '');
    const key = signLicenceForTest(validPayload('pro'), pk);
    const result = verifyLicence(key, { publicKey: rawBase64, now: NOW });
    expect(licencePlanOrFree(result)).toBe('pro');
  });
});

describe('verifyLicence — fail-closed to free', () => {
  it('expired licence → expired → free', () => {
    const key = signLicenceForTest(validPayload('enterprise', { exp: PAST }), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('expired');
    expect(licencePlanOrFree(result)).toBe('free');
    expect(hasFeature(licencePlanOrFree(result), 'sso.saml')).toBe(false);
  });

  it('exp exactly equal to now → expired (now >= exp)', () => {
    const key = signLicenceForTest(validPayload('pro', { exp: NOW_SECONDS }), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('expired');
  });

  it('tampered payload (signature no longer matches) → bad_signature → free', () => {
    const key = signLicenceForTest(validPayload('pro'), privateKey);
    const [encodedPayload, sig] = key.split('.') as [string, string];
    // Re-encode a payload that claims enterprise, keep the pro signature.
    const forged = Buffer.from(JSON.stringify(validPayload('enterprise')), 'utf8').toString(
      'base64url',
    );
    expect(forged).not.toBe(encodedPayload);
    const tampered = `${forged}.${sig}`;
    const result = verifyLicence(tampered, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('bad_signature');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('tampered signature → bad_signature → free', () => {
    const key = signLicenceForTest(validPayload('enterprise'), privateKey);
    const [encodedPayload, sig] = key.split('.') as [string, string];
    const sigBuf = Buffer.from(sig, 'base64url');
    sigBuf.writeUInt8(sigBuf.readUInt8(0) ^ 0xff, 0); // flip a byte
    const tampered = `${encodedPayload}.${sigBuf.toString('base64url')}`;
    const result = verifyLicence(tampered, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('bad_signature');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('signed by a DIFFERENT key → bad_signature → free', () => {
    const { privateKey: otherKey } = makeKeyPair();
    const key = signLicenceForTest(validPayload('enterprise'), otherKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('bad_signature');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('malformed: one segment → malformed → free', () => {
    const result = verifyLicence('justonesegment', { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('malformed: wrong segment count (three segments) → malformed → free', () => {
    const key = signLicenceForTest(validPayload('pro'), privateKey);
    const result = verifyLicence(`${key}.extra`, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed');
  });

  it('malformed: bad base64 in payload segment → malformed → free', () => {
    const key = signLicenceForTest(validPayload('pro'), privateKey);
    const sig = key.split('.')[1];
    const result = verifyLicence(`not*valid*base64url.${sig}`, {
      publicKey: publicKeyPem,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed');
  });

  it('malformed: non-JSON payload → malformed → free', () => {
    const encoded = Buffer.from('this is not json', 'utf8').toString('base64url');
    const sig = edSign(null, Buffer.from(encoded, 'utf8'), privateKey).toString('base64url');
    const result = verifyLicence(`${encoded}.${sig}`, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed');
  });

  it('malformed: JSON missing required v/plan fields → malformed → free', () => {
    const encoded = Buffer.from(JSON.stringify({ sub: 'x' }), 'utf8').toString('base64url');
    const sig = edSign(null, Buffer.from(encoded, 'utf8'), privateKey).toString('base64url');
    const result = verifyLicence(`${encoded}.${sig}`, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed');
  });

  it('absent licence (undefined) → absent_key → free', () => {
    const result = verifyLicence(undefined, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('absent_key');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('absent licence (empty string) → absent_key → free', () => {
    const result = verifyLicence('', { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('absent_key');
  });

  it('absent public key → absent_public_key → free', () => {
    const key = signLicenceForTest(validPayload('enterprise'), privateKey);
    const result = verifyLicence(key, { publicKey: undefined, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('absent_public_key');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('unparseable public key → absent_public_key → free', () => {
    const key = signLicenceForTest(validPayload('enterprise'), privateKey);
    const result = verifyLicence(key, { publicKey: 'garbage-not-a-key', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('absent_public_key');
  });

  it('unsupported version → unsupported_version → free', () => {
    const key = signLicenceForTest(validPayload('enterprise', { v: 999 }), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unsupported_version');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('unknown plan → unknown_plan → free', () => {
    const key = signLicenceForTest(validPayload('pro', { plan: 'ultimate' }), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unknown_plan');
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('plan "free" is not a licensable upgrade → unknown_plan → free', () => {
    const key = signLicenceForTest(validPayload('pro', { plan: 'free' }), privateKey);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unknown_plan');
  });
});
