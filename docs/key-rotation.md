<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 Fullstack Forge -->

# Rotating `DB_ENCRYPTION_KEY`

`DB_ENCRYPTION_KEY` is the single at-rest encryption key for all
application-layer field encryption in NiteOwl. This document describes what it
protects, its format, the on-disk wire format, and — importantly — the honest
current procedure and limitations for rotating it.

## What it protects

`DB_ENCRYPTION_KEY` is consumed exclusively by `@niteowl/db`
(`packages/db/src/encryption.ts`), which exposes `encrypt` / `decrypt` and their
optional/token variants. Every sensitive field is encrypted with this key before
it is written to the database and decrypted with it on read. The raw secret never
touches the database in plaintext.

Encrypted fields (as of this writing):

| Table                 | Column                    | Nullable | Contents                                          |
| --------------------- | ------------------------- | -------- | ------------------------------------------------- |
| `oauth_tokens`        | `access_token_encrypted`  | no       | GitHub / Linear / Jira OAuth access tokens        |
| `oauth_tokens`        | `refresh_token_encrypted` | yes      | OAuth refresh tokens (Jira; others where present) |
| `slack_alert_configs` | `webhook_url_encrypted`   | no       | Slack incoming-webhook URLs                       |

Write sites live in the OAuth callback routes (`apps/api/src/routes/auth/*`), the
Jira catch-up poller (`apps/api/src/lib/jira-catchup.ts`), the Slack alerts route
(`apps/api/src/routes/slack-alerts/index.ts`), and the backfill script
(`packages/db/src/backfill-oauth-encryption.ts`). If this list drifts, re-derive
it with:

```sh
grep -rn --include='*.ts' -E 'encrypt\(|encryptOptional\(' apps packages \
  | grep -v node_modules
```

## Key format

- 32 bytes (256-bit), supplied as **either** 64 hexadecimal characters **or**
  a 44-character base64 string. Both decode to exactly 32 bytes; anything else is
  rejected at load time.
- Generate a fresh key with:

  ```sh
  openssl rand -hex 32
  ```

The key is loaded from `process.env.DB_ENCRYPTION_KEY`. It is **required** in any
environment that connects an integration — reads and writes of the encrypted
columns above throw if it is unset.

## Wire format of stored values

Stored ciphertext is a single dot-separated string:

```
<iv>.<ciphertext>.<authTag>
```

- Algorithm: **AES-256-GCM**
- IV: **12 bytes** (96-bit, GCM-recommended), random per encryption
- Auth tag: **16 bytes** (128-bit)
- Each segment is **base64url**-encoded

Decryption verifies the GCM auth tag; a tampered value fails loudly rather than
returning corrupt plaintext.

## Rotation procedure

> **Important limitation — read first.** There is currently **no envelope
> encryption and no versioned-key (key-id) scheme.** Decryption uses a single
> key, and the wire format carries **no key-version tag**. As a result, old and
> new keys cannot be distinguished at rest, so rotation **cannot be done lazily**
> (you cannot leave a mix of old- and new-key rows and decrypt each with the key
> it was written under). Rotation is a **re-encryption migration** that must
> complete **atomically per deployment**: every encrypted row must be
> re-encrypted with the new key _before_ the `DB_ENCRYPTION_KEY` environment
> variable is swapped to the new value.

Recommended sequence:

1. **Generate the new key** and stage it alongside the old one (e.g. as a
   temporary `DB_ENCRYPTION_KEY_NEW`), without yet changing the live
   `DB_ENCRYPTION_KEY` that the running app reads.
2. **Re-encrypt every row.** For each encrypted column listed above, run a
   migration that, per row: decrypts the value with the **old** key and
   re-encrypts it with the **new** key. Take a backup first and prefer a
   maintenance window or a mechanism that quiesces writes to the affected tables
   (new writes during the migration would be encrypted under the old key and
   could be missed).
3. **Cut over** `DB_ENCRYPTION_KEY` to the new value across all app instances in
   a single, coordinated deploy. Because there is no key-version tag, a row must
   never be readable only under the retired key after cutover.
4. **Retire the old key.** Once every instance is serving on the new key and
   reads/writes are verified, remove the old key material from your secret store
   and any staging variable.

Because there is no key-version tag in the wire format, this migration is
inherently all-or-nothing per deployment and cannot be split across releases with
both keys live long-term.

### Future work: zero-downtime lazy rotation

A future versioned-key scheme — for example prefixing stored values with a key
id (`kid`), such as `v2:<iv>.<ciphertext>.<authTag>` — would let `decrypt` select
the correct key per value. That would enable **lazy** rotation: run both keys
concurrently, decrypt each row with the key that wrote it, and re-encrypt
opportunistically on next write, with no maintenance window. Until such a scheme
exists, follow the atomic re-encryption procedure above.
