#!/usr/bin/env bash
#
# exclude-ee.sh — physically remove commercial (Enterprise Edition) packages so
# the free edition can be built in isolation.
#
# This is the load-bearing "free-without-ee" guard for the open-core line
# (see docs/open-core.md). It deletes every `packages/ee-*` directory from the
# working tree. Afterwards the free edition must still install, lint,
# type-check, build, and test with the commercial code gone. If any core
# package or app depends on `@niteowl/ee-*` — via a package.json dependency or a
# bare `import` — the subsequent `pnpm install` / type-check / build will fail,
# which is exactly the signal we want: the free product silently grew a
# dependency on paid code.
#
# Because removing workspace packages invalidates the committed lockfile, the
# caller MUST run `pnpm install --no-frozen-lockfile` after this script (the
# free edition install is intentionally allowed to re-resolve).
#
# Usage: scripts/ci/exclude-ee.sh
#
set -euo pipefail

# Resolve repo root from this script's location so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

shopt -s nullglob
ee_dirs=(packages/ee-*)
shopt -u nullglob

if [ ${#ee_dirs[@]} -eq 0 ]; then
  echo "exclude-ee: no packages/ee-* directories found — nothing to exclude."
  echo "exclude-ee: WARNING — expected at least one commercial package; the"
  echo "            free-without-ee guard is only meaningful when one exists."
  exit 0
fi

echo "exclude-ee: removing commercial (ee-*) packages for the free edition:"
for dir in "${ee_dirs[@]}"; do
  echo "  - ${dir}"
  rm -rf "${dir}"
done

echo "exclude-ee: done. The free edition must now build without commercial code."
