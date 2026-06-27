# Open-core boundary

> **Decision lineage:** [FUL-102](/FUL/issues/FUL-102) chose **Option C** — an
> open-source core plus a **private commercial overlay** (self-hosted
> commercial). This document is the implementation of that boundary
> ([FUL-104](/FUL/issues/FUL-104)).

NiteOwl is **open-core**. There is exactly one core, and the free product is
always whole _by construction_. Commercial ("Enterprise Edition", `ee-*`) code
is structurally separable and is licensed separately.

## The load-bearing rule

```
core  →  (knows nothing about)  →  commercial
commercial  →  (may depend on)  →  core
```

**Core may NEVER import commercial (`@niteowl/ee-*`) code. Commercial may import
core.** This single one-directional dependency is what guarantees the free core
never silently grows a dependency on a paid package.

It is enforced mechanically, not by convention — see
[Enforcement](#enforcement) below.

## Package conventions

| Tier       | Location               | Package name    | Licence             | SPDX                  |
| ---------- | ---------------------- | --------------- | ------------------- | --------------------- |
| Core       | `packages/*`, `apps/*` | `@niteowl/*`    | Apache-2.0          | `Apache-2.0`          |
| Commercial | `packages/ee-*`        | `@niteowl/ee-*` | Business Source 1.1 | `LicenseRef-BUSL-1.1` |

- Any commercial package **must** live in a directory named `packages/ee-*` and
  be published as `@niteowl/ee-*`. The `ee-` prefix is the machine-checkable
  marker the import guard keys on.
- Every commercial package ships its own `LICENSE` (BUSL 1.1) and sets
  `"license": "LicenseRef-BUSL-1.1"` in `package.json`.
- `packages/ee-licensing` is the **skeleton** that anchors this convention and
  gives the import guard a concrete target to test against.

## Licensing

| What                       | Licence                                | File                     |
| -------------------------- | -------------------------------------- | ------------------------ |
| Open-source core           | **Apache-2.0** (patent grant)          | [`/LICENSE`](../LICENSE) |
| Commercial `ee-*` packages | **Business Source License 1.1** (BUSL) | `packages/ee-*/LICENSE`  |

We chose **Apache-2.0** over MIT for the core because of its explicit patent
grant and patent-retaliation clause — important for a product we expect third
parties to build on.

We chose **BUSL 1.1** for commercial code because it is _source-available_
(customers can read, modify, and self-host) while preventing a competitor from
operating it as a competing service. Each BUSL version converts to Apache-2.0 on
its **Change Date** (4 years after release), so the licence is time-bounded, not
perpetually closed.

### SPDX header convention (machine-checkable)

Every source file carries an SPDX identifier on the first lines so the boundary
is checkable by tooling and by humans skimming a file:

```ts
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
```

Commercial files use:

```ts
// SPDX-License-Identifier: LicenseRef-BUSL-1.1
// SPDX-FileCopyrightText: 2026 Fullstack Forge
```

Rules:

- **New core files** → `Apache-2.0`. **New `ee-*` files** → `LicenseRef-BUSL-1.1`.
- The package-level `"license"` field in every `package.json` must match the
  tier (`Apache-2.0` for core, `LicenseRef-BUSL-1.1` for `ee-*`). This makes the
  boundary checkable without reading source.
- A file's SPDX identifier is the source of truth if it ever disagrees with its
  location; but a `LicenseRef-BUSL-1.1` file outside `packages/ee-*` (or vice
  versa) is a mistake and should be moved, not relabelled.

SPDX headers are applied across **every** source file, not just package entry
points ([FUL-112](/FUL/issues/FUL-112)). The convention is enforced by a script
that derives the expected identifier purely from a file's path:

```bash
pnpm spdx:check   # CI guard — fails on any file missing or with a wrong header
pnpm spdx:write   # backfill: insert the header into any file that lacks one
```

`spdx:write` only ever **inserts** a missing header; it never relabels an
existing one, because (per the rule above) a mismatched identifier signals a
misplaced file that should be moved, not relabelled — so the script surfaces it
as an error for a human to resolve. The check runs as its own lightweight,
install-free `spdx` job in CI (plain Node, no `pnpm install`); see
[`scripts/spdx-headers.mjs`](../scripts/spdx-headers.mjs).

## Enforcement

The boundary is enforced by [`eslint.boundaries.cjs`](../eslint.boundaries.cjs),
run via:

```bash
pnpm run lint:boundaries      # standalone
pnpm lint                     # also runs the boundary check (CI entry point)
```

It bans `@niteowl/ee-*` (and deep paths into `packages/ee-*`) imports from
everything **except** the `ee-*` packages themselves. If a core package or app
imports commercial code, **lint fails and CI goes red.**

This is a _standalone_ ESLint config (`--no-eslintrc -c`) on purpose: the main
`.eslintrc.js` enables type-checked rules that require `parserOptions.project`,
which the boundary check does not need. Keeping it separate makes the guard fast
and dependency-light.

### Recommended belt-and-braces (follow-up)

The strongest possible guarantee is a CI job that **builds the free edition with
the `ee-*` packages physically absent** — if core needs them, the build breaks.
The ESLint guard catches the violation at author time; the
build-without-commercial check catches anything the linter can't see (dynamic
imports, config references). Tracked as a follow-up to this issue.

## The open-core line — what belongs where

Use this to avoid two failure modes: paywalling a baseline feature, or giving
away something that should be commercial.

**Core (Apache-2.0) — the product must be genuinely useful on its own:**

- The complete data model, API, and web app for the single-team/self-hosted use
  case.
- GitHub ingestion, repo-scan, briefing, and all baseline NiteOwl functionality
  shipped to date.
- Authentication for a single organisation, standard integrations, and the
  entitlement _interface_ (so core can ask "is feature X enabled?" without
  knowing how the answer is computed).

**Commercial (`ee-*`, BUSL) — multi-tenant, scale, governance, and "for selling
to bigger orgs" capabilities:**

- License-key verification and entitlement _resolution_ (the skeleton in
  `packages/ee-licensing`).
- SSO/SAML/SCIM, advanced RBAC, audit logging, and compliance reporting.
- Multi-org / multi-tenant management and usage metering/billing.
- Anything whose value scales with org size rather than with the baseline
  product.

**Heuristic:** if removing it would make the free product feel _crippled rather
than smaller_, it belongs in core. If it only matters once you are selling to a
larger organisation, it belongs in `ee-*`.

## Repo-split plan (Option C execution)

Today both tiers live in this one repo so the convention and guard can land
atomically. The target end-state is **public core repo + private overlay repo**.
Sequence (execution is a follow-up; the boundary work here is the prerequisite):

1. **Now (this issue):** establish the boundary inside the monorepo — `ee-*`
   convention, import guard, licences, SPDX. Keep the dependency direction clean
   so the later split is low-cost.
2. **Version & publish core packages.** Give `@niteowl/types`, `@niteowl/shared`,
   `@niteowl/db` (and any other core libs) real semver versions and publish them
   to a registry (private npm/GitHub Packages initially). Replace
   `workspace:*` consumption in the overlay with pinned versions.
   - Tooling: adopt **Changesets** for versioning/changelogs across core
     packages; publish from CI on tag.
3. **Stand up the private overlay repo.** It contains only `apps/*/ee` glue and
   `packages/ee-*`, depends on the published core packages (pinned), and adds the
   commercial build target. The skeleton `packages/ee-licensing` moves there.
4. **Two build targets.** Free edition = core only. Commercial edition = overlay
   pulling pinned core + `ee-*`. Editions differ at runtime via the entitlements
   layer, not via divergent core code.
5. **Cross-repo changes** become: land core change → bump/publish core → bump
   pin in overlay. Slightly more plumbing than a single PR, which is the
   accepted cost of a clean IP boundary.

**Why not fork now:** a full fork (Option A) drifts within weeks and forces every
common-feature change to be ported twice. Keeping one core with a one-directional
boundary preserves the option to split cheaply later, which is exactly what this
issue sets up.
