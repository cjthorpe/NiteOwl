// SPDX-License-Identifier: LicenseRef-BUSL-1.1
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import {
  LICENCE_FORMAT_VERSION,
  licencePlanOrFree,
  verifyLicence,
  type LicencePayload,
} from '@niteowl/shared';
import { describe, expect, it } from 'vitest';

import { generateLicenceKeyPair, signLicence } from './signing';

const NOW = new Date('2026-06-27T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const FUTURE = NOW_SECONDS + 60 * 60 * 24 * 365;

function payload(plan: string): LicencePayload {
  return { v: LICENCE_FORMAT_VERSION, plan, sub: 'acme', exp: FUTURE };
}

describe('signLicence + verifyLicence round-trip', () => {
  it('produces a key that the shared verifier accepts with the right plan', () => {
    const { publicKeyPem, privateKeyPem } = generateLicenceKeyPair();
    const key = signLicence(payload('enterprise'), privateKeyPem);

    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.plan).toBe('enterprise');
    expect(licencePlanOrFree(result)).toBe('enterprise');
  });

  it('round-trips a pro licence', () => {
    const { publicKeyPem, privateKeyPem } = generateLicenceKeyPair();
    const key = signLicence(payload('pro'), privateKeyPem);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(licencePlanOrFree(result)).toBe('pro');
  });

  it('emits the two-segment base64url wire format', () => {
    const { privateKeyPem } = generateLicenceKeyPair();
    const key = signLicence(payload('pro'), privateKeyPem);
    const segments = key.split('.');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(segments[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('forces the format version even if the caller passes a stale v', () => {
    const { publicKeyPem, privateKeyPem } = generateLicenceKeyPair();
    const key = signLicence({ ...payload('pro'), v: 999 }, privateKeyPem);
    const result = verifyLicence(key, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.payload.v).toBe(LICENCE_FORMAT_VERSION);
  });

  it('tampering a byte in the licence makes verification fail (→ free)', () => {
    const { publicKeyPem, privateKeyPem } = generateLicenceKeyPair();
    const key = signLicence(payload('enterprise'), privateKeyPem);
    const [encodedPayload, sig] = key.split('.') as [string, string];
    const sigBuf = Buffer.from(sig, 'base64url');
    sigBuf.writeUInt8(sigBuf.readUInt8(0) ^ 0xff, 0);
    const tampered = `${encodedPayload}.${sigBuf.toString('base64url')}`;

    const result = verifyLicence(tampered, { publicKey: publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    expect(licencePlanOrFree(result)).toBe('free');
  });

  it('a key from a different keypair does not verify', () => {
    const signer = generateLicenceKeyPair();
    const other = generateLicenceKeyPair();
    const key = signLicence(payload('enterprise'), signer.privateKeyPem);
    const result = verifyLicence(key, { publicKey: other.publicKeyPem, now: NOW });
    expect(result.ok).toBe(false);
    expect(licencePlanOrFree(result)).toBe('free');
  });
});
