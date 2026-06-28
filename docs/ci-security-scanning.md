# CI security scanning

NiteOwl's CI pipeline (`.github/workflows/ci.yml`) runs two automated security
gates on every push and pull request to `main`, plus weekly Dependabot updates.
Edition: **core** (Apache-licensed).

## 1. Secret scanning — `secret-scan` job

Uses [gitleaks](https://github.com/gitleaks/gitleaks) to scan the **full git
history** for committed credentials (API keys, tokens, private keys, etc.).

- Config: [`.gitleaks.toml`](../.gitleaks.toml) — extends the default ruleset and
  allowlists known placeholder files (`.env.example`, `pnpm-lock.yaml`).
- **Blocking:** the job fails if any leak is detected.

Run locally before pushing:

```bash
# Install gitleaks (macOS): brew install gitleaks
gitleaks detect --no-banner --redact --config .gitleaks.toml
```

If a finding is a genuine false positive, add a narrow `paths`/`regexes` entry to
the `[allowlist]` in `.gitleaks.toml`. **Never** allowlist a real secret — rotate
it instead.

## 2. Dependency audit — `dependency-audit` job

Runs `pnpm audit` against the workspace lockfile.

- **Blocking:** `pnpm audit --prod --audit-level high` — fails on high/critical
  advisories in **production** dependencies (the code we actually ship).
- **Report-only:** `pnpm audit --audit-level moderate` — surfaces dev-tooling
  advisories (vitest, jsdom, vite, etc.) in the log without blocking merges.
  Dependabot raises PRs to remediate these over time.

Rationale: dev-only transitive advisories should not block product work, but a
vulnerable shipped dependency must. Tune `--audit-level` / `--prod` in
`.github/workflows/ci.yml` if the policy needs to change.

Run locally:

```bash
pnpm audit --prod --audit-level high   # the blocking gate
pnpm audit --audit-level moderate      # full report
```

## 3. Dependency updates — Dependabot

[`.github/dependabot.yml`](../.github/dependabot.yml) opens weekly PRs for:

- **npm** ecosystem (reads `pnpm-lock.yaml`) — dev and production deps grouped
  separately to keep review scope clear.
- **github-actions** — keeps CI action versions current.

This pairs with the audit gate: Dependabot fixes vulnerable deps before they can
fail the audit, and the audit catches anything Dependabot has not yet patched.
