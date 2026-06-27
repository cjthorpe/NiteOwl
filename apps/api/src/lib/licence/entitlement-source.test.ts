// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';

import { LICENCE_FORMAT_VERSION, type LicencePayload } from '@niteowl/shared';
import { describe, expect, it } from 'vitest';

import {
  accountHasFeature,
  effectivePlan,
  LicenceEntitlementSource,
  resolveDeploymentPlan,
} from './entitlement-source.js';

// Inline Ed25519 signer. apps/api is open-source CORE and may NOT import the
// commercial @niteowl/ee-licensing signer (enforced by eslint.boundaries.cjs),
// so we sign with node:crypto directly here — same wire format as signLicence.
function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function sign(payload: LicencePayload, privateKey: KeyObject): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = edSign(null, Buffer.from(encoded, 'utf8'), privateKey);
  return `${encoded}.${sig.toString('base64url')}`;
}

const NOW_SECONDS = Math.floor(Date.now() / 1000);
const FUTURE = NOW_SECONDS + 60 * 60 * 24 * 365;
const PAST = NOW_SECONDS - 60 * 60 * 24;

const { privateKey, publicKeyPem } = makeKeyPair();

function envWith(licenceKey?: string, publicKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (licenceKey !== undefined) env['NITEOWL_LICENCE_KEY'] = licenceKey;
  if (publicKey !== undefined) env['NITEOWL_LICENCE_PUBLIC_KEY'] = publicKey;
  return env;
}

describe('resolveDeploymentPlan', () => {
  it('resolves a valid enterprise licence to enterprise', () => {
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'enterprise', exp: FUTURE }, privateKey);
    expect(resolveDeploymentPlan(envWith(key, publicKeyPem))).toBe('enterprise');
  });

  it('fails closed to free for an expired licence', () => {
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'enterprise', exp: PAST }, privateKey);
    expect(resolveDeploymentPlan(envWith(key, publicKeyPem))).toBe('free');
  });

  it('fails closed to free for a tampered licence', () => {
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'pro', exp: FUTURE }, privateKey);
    const [encoded, sig] = key.split('.') as [string, string];
    const sigBuf = Buffer.from(sig, 'base64url');
    sigBuf.writeUInt8(sigBuf.readUInt8(0) ^ 0xff, 0);
    const tampered = `${encoded}.${sigBuf.toString('base64url')}`;
    expect(resolveDeploymentPlan(envWith(tampered, publicKeyPem))).toBe('free');
  });

  it('fails closed to free when the licence is signed by a different key', () => {
    const { privateKey: other } = makeKeyPair();
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'enterprise', exp: FUTURE }, other);
    expect(resolveDeploymentPlan(envWith(key, publicKeyPem))).toBe('free');
  });

  it('fails closed to free when the licence env var is absent', () => {
    expect(resolveDeploymentPlan(envWith(undefined, publicKeyPem))).toBe('free');
  });

  it('fails closed to free when the public key env var is absent', () => {
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'pro', exp: FUTURE }, privateKey);
    expect(resolveDeploymentPlan(envWith(key, undefined))).toBe('free');
  });

  it('fails closed to free when both env vars are absent', () => {
    expect(resolveDeploymentPlan(envWith())).toBe('free');
  });
});

describe('LicenceEntitlementSource', () => {
  it('resolvePlan returns the licensed tier for a valid key', () => {
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'pro', exp: FUTURE }, privateKey);
    const source = new LicenceEntitlementSource({ licenceKey: key, publicKey: publicKeyPem });
    expect(source.resolvePlan()).toBe('pro');
  });

  it('respects the now override for expiry', () => {
    const exp = NOW_SECONDS + 10;
    const key = sign({ v: LICENCE_FORMAT_VERSION, plan: 'enterprise', exp }, privateKey);
    const past = new LicenceEntitlementSource({
      licenceKey: key,
      publicKey: publicKeyPem,
      now: new Date((exp - 5) * 1000),
    });
    const future = new LicenceEntitlementSource({
      licenceKey: key,
      publicKey: publicKeyPem,
      now: new Date((exp + 5) * 1000),
    });
    expect(past.resolvePlan()).toBe('enterprise');
    expect(future.resolvePlan()).toBe('free');
  });
});

describe('effectivePlan / accountHasFeature', () => {
  it('prefers the higher of account tier and deployment tier', () => {
    expect(effectivePlan('free', 'enterprise')).toBe('enterprise');
    expect(effectivePlan('enterprise', 'free')).toBe('enterprise');
    expect(effectivePlan('pro', 'enterprise')).toBe('enterprise');
    expect(effectivePlan(null, 'pro')).toBe('pro');
  });

  it('grants a deployment-licensed feature to a free account', () => {
    expect(accountHasFeature('free', 'sso.saml', 'enterprise')).toBe(true);
    expect(accountHasFeature({ plan: 'free' }, 'analytics.dashboard', 'pro')).toBe(true);
  });

  it('denies a higher feature when neither account nor deployment grants it', () => {
    expect(accountHasFeature('free', 'sso.saml', 'free')).toBe(false);
    expect(accountHasFeature('pro', 'sso.saml', 'pro')).toBe(false);
  });

  it('always grants free baseline features', () => {
    expect(accountHasFeature('free', 'core.activity_feed', 'free')).toBe(true);
  });
});
