// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// spdx-headers.mjs — backfill and verify SPDX headers across source files.
//
// Every source file in this repo carries an SPDX identifier on its first lines
// so the open-core boundary is machine-checkable (see docs/open-core.md):
//
//     // SPDX-License-Identifier: Apache-2.0          (core: packages/*, apps/*)
//     // SPDX-FileCopyrightText: 2026 Fullstack Forge
//
//     // SPDX-License-Identifier: LicenseRef-BUSL-1.1  (commercial: packages/ee-*)
//     // SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// The tier (and therefore the expected identifier) is derived purely from a
// file's path: anything under `packages/ee-*` is commercial, everything else is
// core. This is the same `ee-*` marker the import guard keys on.
//
// Usage:
//   node scripts/spdx-headers.mjs --check    # exit 1 if any file is missing or
//                                            # has a mismatched header (CI mode)
//   node scripts/spdx-headers.mjs --write    # insert the header into any file
//                                            # that is missing one (idempotent)
//
// `--write` only ever INSERTS a missing header. It never relabels an existing
// one: per docs/open-core.md a file whose identifier disagrees with its
// location is a mistake to be moved, not silently relabelled, so a mismatch is
// always surfaced as an error for a human to resolve.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep , dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');

// Directories that hold first-party source. Generated/vendored trees are never
// walked (see SKIP_DIRS).
const SOURCE_ROOTS = ['apps', 'packages'];

// File extensions treated as licensable source.
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'];

// Directory names pruned during the walk — generated output, vendored deps, and
// caches that must not carry (or be checked for) headers.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.git']);

const SPDX_TAG = 'SPDX-License-Identifier:';
const COPYRIGHT_LINE = '// SPDX-FileCopyrightText: 2026 Fullstack Forge';

const CORE_IDENTIFIER = 'Apache-2.0';
const EE_IDENTIFIER = 'LicenseRef-BUSL-1.1';

/**
 * Determine the expected SPDX identifier for a file from its repo-relative
 * path. Anything under a `packages/ee-*` directory is commercial; everything
 * else is core. Path separators are normalised so this is correct on Windows.
 *
 * @param {string} relPath repo-relative path (any separator)
 * @returns {string} the expected SPDX-License-Identifier value
 */
export function expectedIdentifier(relPath) {
  const segments = relPath.split(/[\\/]/);
  const isCommercial = segments.some(
    (segment, i) => segments[i - 1] === 'packages' && segment.startsWith('ee-'),
  );
  return isCommercial ? EE_IDENTIFIER : CORE_IDENTIFIER;
}

/**
 * Inspect a file's leading lines for an SPDX identifier. Only the first few
 * lines are considered so a stray "SPDX" mention deeper in the file is ignored.
 *
 * @param {string} content full file contents
 * @returns {{ found: boolean, identifier: string | null }}
 */
export function readSpdx(content) {
  const lines = content.split('\n', 5);
  for (const line of lines) {
    const idx = line.indexOf(SPDX_TAG);
    if (idx !== -1) {
      return { found: true, identifier: line.slice(idx + SPDX_TAG.length).trim() };
    }
  }
  return { found: false, identifier: null };
}

/**
 * Produce new file content with a header inserted for `identifier`. A leading
 * shebang (`#!...`) is preserved as the first line, with the header inserted
 * immediately after it.
 *
 * @param {string} content original file content (assumed to have no header)
 * @param {string} identifier SPDX identifier to insert
 * @returns {string} content with the header prepended
 */
export function insertHeader(content, identifier) {
  const header = `// ${SPDX_TAG} ${identifier}\n${COPYRIGHT_LINE}\n`;
  if (content.startsWith('#!')) {
    const newlineIdx = content.indexOf('\n');
    if (newlineIdx === -1) {
      return `${content}\n${header}`;
    }
    const shebang = content.slice(0, newlineIdx + 1);
    return `${shebang}${header}${content.slice(newlineIdx + 1)}`;
  }
  return `${header}${content}`;
}

/** Recursively collect source files under `dir`, pruning SKIP_DIRS. */
function collectSourceFiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // directory absent (e.g. ee-* removed in the free edition) — skip
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(full, acc);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.d.ts')) continue;
      if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) acc.push(full);
    }
  }
  return acc;
}

/** Gather every source file across SOURCE_ROOTS, sorted for stable output. */
export function gatherFiles(root = REPO_ROOT) {
  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const abs = join(root, sourceRoot);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    collectSourceFiles(abs, files);
  }
  return files.sort();
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('Usage: node scripts/spdx-headers.mjs --check | --write');
    process.exit(2);
  }

  const files = gatherFiles();
  const missing = [];
  const mismatched = [];
  let written = 0;

  for (const file of files) {
    const relPath = relative(REPO_ROOT, file).split(sep).join('/');
    const expected = expectedIdentifier(relPath);
    const content = readFileSync(file, 'utf8');
    const { found, identifier } = readSpdx(content);

    if (!found) {
      if (mode === '--write') {
        writeFileSync(file, insertHeader(content, expected), 'utf8');
        written += 1;
      } else {
        missing.push(relPath);
      }
      continue;
    }

    if (identifier !== expected) {
      // A wrong identifier is never auto-fixed — it signals a misplaced file.
      mismatched.push({ relPath, identifier, expected });
    }
  }

  if (mode === '--write') {
    console.log(`spdx-headers: inserted header into ${written} file(s).`);
    if (mismatched.length > 0) {
      console.error(
        `spdx-headers: ${mismatched.length} file(s) have a MISMATCHED identifier ` +
          `(not auto-fixed — resolve by moving the file to the correct tier):`,
      );
      for (const m of mismatched) {
        console.error(`  - ${m.relPath}: found ${m.identifier}, expected ${m.expected}`);
      }
      process.exit(1);
    }
    return;
  }

  // --check
  if (missing.length === 0 && mismatched.length === 0) {
    console.log(`spdx-headers: OK — all ${files.length} source file(s) carry a correct header.`);
    return;
  }

  if (missing.length > 0) {
    console.error(`spdx-headers: ${missing.length} file(s) MISSING an SPDX header:`);
    for (const relPath of missing) console.error(`  - ${relPath}`);
  }
  if (mismatched.length > 0) {
    console.error(`spdx-headers: ${mismatched.length} file(s) with a MISMATCHED identifier:`);
    for (const m of mismatched) {
      console.error(`  - ${m.relPath}: found ${m.identifier}, expected ${m.expected}`);
    }
  }
  console.error('\nRun `pnpm spdx:write` to insert missing headers. See docs/open-core.md.');
  process.exit(1);
}

// Only run when invoked directly (not when imported by the test suite).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
