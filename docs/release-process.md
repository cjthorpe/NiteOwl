# Release process

> **Decision lineage:** [FUL-133](/FUL/issues/FUL-133) formalised NiteOwl's
> release process: a tagged, titled release **every two weeks**, with notes that
> describe new features, improvements, and bug fixes — and that account for the
> open-core / commercial split established in
> [`docs/open-core.md`](./open-core.md) ([FUL-102](/FUL/issues/FUL-102),
> [FUL-104](/FUL/issues/FUL-104)).

This document is the single source of truth for **what** a NiteOwl release is,
**when** it happens, **who** runs it, and **how** it is executed.

---

## 1. Cadence

- **One release every two weeks.** The first release (`R1`) is **2026-06-28**.
- Subsequent releases land on the **same weekday, every other week**:

  | Release | Target date | Window covered           |
  | ------- | ----------- | ------------------------ |
  | R1      | 2026-06-28  | inception → 2026-06-28   |
  | R2      | 2026-07-12  | 2026-06-29 → 2026-07-12  |
  | R3      | 2026-07-26  | 2026-07-13 → 2026-07-26  |
  | R4      | 2026-08-09  | 2026-07-27 → 2026-08-09  |
  | R5      | 2026-08-23  | …continues every 14 days |

- **Train model, not a feature gate.** The release leaves on schedule with
  whatever is merged and green on `main`. Unfinished work waits for the next
  train rather than holding the release. This keeps cadence predictable and
  removes "just one more PR" pressure.
- **Empty release is allowed.** If a fortnight produced only chores or nothing
  user-visible, still cut the release (note it as "Maintenance only"). A skipped
  train erodes the habit; an honest empty one does not.
- **Out-of-band patch releases** are permitted for security fixes or
  Sev-1/Sev-2 regressions — see [§7](#7-hotfix--patch-releases). These do not
  shift the regular cadence.

The cadence is kept live by a scheduled reminder (see
[§8](#8-automation--reminders)); the date table above is the human-readable
anchor.

## 2. Versioning

NiteOwl follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

There are **two version surfaces**, and it matters which one a number refers to:

| Surface                   | What it versions                                  | Today                          |
| ------------------------- | ------------------------------------------------- | ------------------------------ |
| **Product release**       | The deployable NiteOwl application (this process) | `v0.1.0` at R1                 |
| **Core library packages** | `@niteowl/{types,shared,db}` as publishable libs  | `0.0.x`, semver via Changesets |

While we are pre-`1.0.0`, the product is signalling "still stabilising": breaking
changes may land in a `MINOR` bump. Rules for the **product release** tag:

- **MINOR** (`0.x.0`) — the normal biweekly release: any mix of features,
  improvements, and fixes. This is the default.
- **PATCH** (`0.x.y`) — an out-of-band hotfix between trains
  ([§7](#7-hotfix--patch-releases)).
- **MAJOR** (`1.0.0`) — reserved for the first release we commit to as a stable,
  supported API/UX surface. Cutting `1.0.0` is a deliberate decision, not an
  automatic consequence of the cadence.

The **core library package** versions (for the eventual public-core/private-overlay
split) are governed separately by **Changesets**, exactly as planned in
[`docs/open-core.md` §Repo-split plan, step 2](./open-core.md). Until those
packages are actually published to a registry, their `0.0.x` versions are
internal and the product-release tag is the number that matters.

### Tag & title format

- **Git tag:** `vMAJOR.MINOR.PATCH` (e.g. `v0.1.0`). Annotated, on `main`.
- **GitHub Release title:** `NiteOwl v0.1.0 — <YYYY-MM-DD>`.
  Optionally append a short codename for memorability
  (`NiteOwl v0.2.0 — 2026-07-12 (Barn Owl)`); the version + date are mandatory,
  the codename is decorative.

## 3. Roles

- **Release Manager (RM)** — owns a given release end-to-end: cuts the tag,
  drafts and publishes notes, verifies the deploy, posts the announcement.
  Initially the **CTO** holds this role; it is designed to be handed to a
  rotating department lead once the runbook below is exercised twice.
- **Contributors** — write
  [Conventional Commit](https://www.conventionalcommits.org/) PR titles
  (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`, `ci:`)
  and reference their `FUL-` issue. This is what makes notes generation
  automatic — see [§5](#5-release-notes).

## 4. What "a release" consists of

Both editions are built **from one commit** (`main` at the tag). Nothing in the
release diverges the core; editions differ at runtime via the entitlements layer
(see [`docs/open-core.md`](./open-core.md)).

| Artifact                     | Free edition (Apache-2.0)         | Commercial edition (`ee-*`, BUSL)                                  |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Source tag                   | `vX.Y.Z` on `main`                | same `vX.Y.Z` (built _with_ `ee-*`)                                |
| CI proof                     | `CI / free` green                 | `CI / commercial` green                                            |
| Docker images (`api`, `web`) | pushed to GHCR on the release SHA | same SHA, commercial build target                                  |
| Release notes                | one GitHub Release …              | … with a dedicated **Commercial** section ([§5](#5-release-notes)) |

The `CI / free` leg physically deletes `packages/ee-*` before building (via
`scripts/ci/exclude-ee.sh`), so a green `free` leg on the release SHA is the
proof that the open-source core stands on its own. **Do not tag a release
unless both `CI / free` and `CI / commercial` are green on the release SHA.**

## 5. Release notes

Every release ships notes structured into these sections, in this order. Omit a
section if it is empty.

```
## New features        ← feat:
## Improvements         ← perf:, refactor:, and notable chore:/docs: that users feel
## Bug fixes            ← fix:
## Commercial (ee-*)    ← any change touching packages/ee-* (BUSL)
## Maintenance          ← internal-only chore:/ci:/test: (optional, terse)
```

Rules:

- **Core vs commercial separation is mandatory.** Any change under
  `packages/ee-*` is listed under **Commercial (ee-\*)**, never mixed into the
  core feature/fix lists. This keeps the open-source changelog honest: a reader
  of the public core sees exactly what the Apache-2.0 product gained, while
  commercial customers see the `ee-*` delta called out separately. When the repo
  split lands ([§9](#9-after-the-repo-split)), the commercial section migrates
  to the private overlay repo's own release.
- Each line references its PR and `FUL-` issue:
  `- Encode GitHub repo path segments separately (#36, FUL-98)`.
- Lead with user impact, not implementation. "Fixed silent `total:0` on repos
  with `/` in the path" beats "changed encodeURIComponent call".
- Use [`docs/release-notes-template.md`](./release-notes-template.md) as the
  starting skeleton.

The first draft is **generated, not hand-collected**:
[`scripts/release/gen-notes.sh`](../scripts/release/gen-notes.sh) walks the
merged commits since the previous tag, buckets them by Conventional Commit type,
and flags anything touching `packages/ee-*` into the Commercial section. The RM
then edits for clarity — generation gets ~90% of the way, judgement does the
rest.

## 6. The release runbook

Executed by the RM on the target date. `vX.Y.Z` = the new version, `vP.Q.R` =
the previous release tag.

1. **Confirm `main` is green.** Check that `CI / free` **and**
   `CI / commercial` are both passing on the SHA you intend to tag. If either is
   red, the release is blocked until it is fixed or the offending PR is reverted.
2. **Pick the version.** Normal train → bump `MINOR` (`v0.1.0` → `v0.2.0`).
   Decide before generating notes.
3. **Generate the draft notes:**
   ```bash
   scripts/release/gen-notes.sh vP.Q.R          # since last tag
   scripts/release/gen-notes.sh vP.Q.R > notes.md
   ```
   (For R1 there is no previous tag — run `scripts/release/gen-notes.sh` with no
   argument to cover all history.)
4. **Edit the notes** for clarity and user impact; confirm the
   **Commercial (ee-\*)** section captures every `ee-*` change.
5. **Bump the product version** in the root `package.json` (`"version"`) to
   `X.Y.Z`, commit on a short branch (`chore: release vX.Y.Z`), open a PR, let CI
   go green, and merge it. The tag points at this merge commit.
6. **Tag and push:**
   ```bash
   git fetch origin main && git checkout main && git pull
   git tag -a vX.Y.Z -m "NiteOwl vX.Y.Z — <date>"
   git push origin vX.Y.Z
   ```
7. **Publish the GitHub Release** against the tag, titled
   `NiteOwl vX.Y.Z — <date>`, body = the edited notes:
   ```bash
   gh release create vX.Y.Z --title "NiteOwl vX.Y.Z — <date>" --notes-file notes.md
   ```
8. **Verify the deploy.** `deploy-staging.yml` runs on push to `main`; confirm
   the GHCR `api`/`web` images for the release SHA exist and staging is healthy.
   (Production promotion is out of scope for this document — it is a deploy
   concern, not a release-cut concern — but the release SHA is the input to it.)
9. **Announce.** Post the release title + link to the team channel and on the
   FUL release issue for that train.

## 7. Hotfix / patch releases

Between trains, a security fix or Sev-1/Sev-2 regression may need to ship
immediately:

- Branch from the **latest release tag** (not from a mid-train `main` that may
  carry unfinished work), cherry-pick/author the minimal fix, get both CI legs
  green, and merge to `main`.
- Cut a **PATCH** release (`v0.2.0` → `v0.2.1`) following the same runbook,
  notes scoped to just the fix.
- The regular biweekly cadence is **unchanged** — the patch does not reset the
  clock.

## 8. Automation & reminders

- A scheduled reminder fires on each release date so the train is never missed;
  it points the RM at this runbook. (Set up as a Paperclip routine / cron for
  FUL-133; the [§1](#1-cadence) table is the fallback if automation lapses.)
- `gen-notes.sh` removes the manual changelog toil and enforces the
  core/commercial bucketing mechanically.
- **Future hardening:** once core packages are published, adopt **Changesets**
  to drive per-package versioning and `publish-on-tag` from CI, as already
  scoped in [`docs/open-core.md`](./open-core.md). At that point notes
  generation can move from commit-walking to Changeset aggregation.

## 9. After the repo split

The [`docs/open-core.md` repo-split plan](./open-core.md) ends with a public
core repo + a private commercial overlay. When that lands, this process forks
cleanly along the same line it already documents:

- **Core repo** cuts the public `vX.Y.Z` release with the **New features /
  Improvements / Bug fixes** sections (Apache-2.0 changelog).
- **Overlay repo** cuts its own release, pinned to a core version, carrying the
  **Commercial (ee-\*)** section (BUSL changelog).
- Cadence stays synchronised: the overlay releases against the core version cut
  on the same fortnightly date.

Because this document already keeps the commercial section structurally
separate, the split is a mechanical move of one section into its own repo — not
a re-think of the process.
