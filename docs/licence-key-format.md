# Self-hosted signed licence-key format (FUL-108)

> Security design owned by the Security Lead. Implementation: see
> `@niteowl/shared` (`licence.ts`, verifier) and `@niteowl/ee-licensing`
> (`signing.ts`, signer). Parent: [FUL-102](./open-core.md) open-core line.

Self-hosted ("Enterprise Edition") deployments derive their commercial
entitlements from a **signed licence key**, not from billing state. The key is
issued by the commercial release (which holds the private signing key) and
verified inside the open-source core (which ships only the public key).

## Why this shape

| Decision | Rationale |
|----------|-----------|
| **Ed25519** asymmetric signature | Small (32-byte) keys, deterministic, no parameter/curve choices to misconfigure, native in `node:crypto`. The public verify key is non-secret and safe to ship in the open core; only the private key mints licences. |
| **Algorithm pinned in the verifier** | The verifier never reads an `alg` field from the token. This structurally defeats algorithm-confusion / `alg:none` downgrade attacks that plague JWT-style formats. |
| **Sign the encoded bytes, not re-serialised JSON** | The signature covers the exact `base64url(payload)` string bytes, so there is zero canonicalisation ambiguity between signer and verifier. |
| **Fail closed to `free`** | Missing, malformed, expired, tampered, wrong-key, or unknown-plan licences all resolve to the free capability set. Verification never throws to the caller and never hard-crashes the API. |
| **Verifier in core / signer in commercial** | `core → ee` imports are banned (`eslint.boundaries.cjs`); the verifier therefore lives in `@niteowl/shared`. The signer (private-key tooling) lives in `packages/ee-licensing` (BUSL, commercial secret scope). |

## Wire format

```
<base64url(payloadJSON)>.<base64url(ed25519Signature)>
```

Two `.`-separated base64url segments. No header segment — the algorithm is
fixed, so there is nothing to negotiate. The signature is computed over the
UTF-8 bytes of the first segment (the encoded payload string).

### Payload (JSON)

```jsonc
{
  "v": 1,                       // format version (LICENCE_FORMAT_VERSION). Unknown → free.
  "plan": "enterprise",         // PlanTier: "pro" | "enterprise". Unknown/"free"/missing → free.
  "sub": "acme-corp",           // OPTIONAL informational subject (customer/account label).
  "iss": "niteowl-licensing",   // OPTIONAL issuer label.
  "iat": 1750000000,            // OPTIONAL issued-at (unix seconds).
  "exp": 1781536000             // unix seconds. now >= exp → expired → free. Absent → never expires.
}
```

The resolved `plan` is fed straight into the existing
`hasFeature()` / `PLAN_CAPABILITIES` path from FUL-103/106 — there is **no
parallel entitlement check**. Capabilities are always derived from the plan
tier's capability set, so the licence cannot grant a capability the tier does
not define.

## Key material & deployment

| Variable | Where | Notes |
|----------|-------|-------|
| `NITEOWL_LICENCE_KEY` | self-hosted deployment env | The signed licence string. Absent → free tier. |
| `NITEOWL_LICENCE_PUBLIC_KEY` | shipped in the build (env override allowed) | SPKI PEM (or base64 raw) Ed25519 **public** key. Absent → no licence can be verified → free tier. |
| private signing key | **commercial release secret scope only** | Never committed, never in the public core. Used solely by `@niteowl/ee-licensing` `signLicence()`. |

## Failure → tier matrix (acceptance)

| Condition | Result |
|-----------|--------|
| Valid, unexpired, signed by the matching private key | licence's `plan` tier |
| Expired (`now >= exp`) | `free` |
| Tampered payload or signature | `free` |
| Signed by a different/wrong key | `free` |
| Malformed (wrong segment count, bad base64, bad JSON) | `free` |
| Unknown / unsupported `v`, or unknown `plan` | `free` |
| `NITEOWL_LICENCE_KEY` absent | `free` |
| `NITEOWL_LICENCE_PUBLIC_KEY` absent | `free` |

## Extensibility (out of scope here, designed-for)

The API resolves entitlements through a pluggable `EntitlementSource`
interface. `LicenceEntitlementSource` is the only implementation today; a
future `BillingEntitlementSource` (SaaS) can be added without touching the
`hasFeature()` consumers.
