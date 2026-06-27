// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// Unit tests for the pure logic in spdx-headers.mjs. Uses Node's built-in test
// runner (`node --test`) so the SPDX CI job needs only Node — no pnpm install,
// no test framework — keeping the header check fast and dependency-light.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expectedIdentifier, readSpdx, insertHeader } from './spdx-headers.mjs';

test('expectedIdentifier: core paths resolve to Apache-2.0', () => {
  assert.equal(expectedIdentifier('apps/api/src/app.ts'), 'Apache-2.0');
  assert.equal(expectedIdentifier('packages/db/src/index.ts'), 'Apache-2.0');
  assert.equal(expectedIdentifier('packages/shared/src/licence.ts'), 'Apache-2.0');
});

test('expectedIdentifier: packages/ee-* paths resolve to BUSL', () => {
  assert.equal(
    expectedIdentifier('packages/ee-licensing/src/index.ts'),
    'LicenseRef-BUSL-1.1',
  );
  assert.equal(
    expectedIdentifier('packages/ee-billing/src/deep/nested.ts'),
    'LicenseRef-BUSL-1.1',
  );
});

test('expectedIdentifier: "ee-" only counts as a direct child of packages/', () => {
  // A file that merely contains "ee-" elsewhere is still core.
  assert.equal(expectedIdentifier('apps/web/src/ee-banner.tsx'), 'Apache-2.0');
  assert.equal(expectedIdentifier('packages/db/src/ee-notes.ts'), 'Apache-2.0');
});

test('expectedIdentifier: handles Windows-style separators', () => {
  assert.equal(
    expectedIdentifier('packages\\ee-licensing\\src\\index.ts'),
    'LicenseRef-BUSL-1.1',
  );
});

test('readSpdx: detects an existing identifier in the leading lines', () => {
  const content = '// SPDX-License-Identifier: Apache-2.0\n// SPDX-FileCopyrightText: 2026 Fullstack Forge\nexport const x = 1;\n';
  assert.deepEqual(readSpdx(content), { found: true, identifier: 'Apache-2.0' });
});

test('readSpdx: detects a BUSL identifier', () => {
  const content = '// SPDX-License-Identifier: LicenseRef-BUSL-1.1\nexport const x = 1;\n';
  assert.deepEqual(readSpdx(content), { found: true, identifier: 'LicenseRef-BUSL-1.1' });
});

test('readSpdx: reports missing when no header is present', () => {
  assert.deepEqual(readSpdx('export const x = 1;\n'), { found: false, identifier: null });
});

test('readSpdx: ignores an SPDX mention that appears below the header window', () => {
  const content = ['a', 'b', 'c', 'd', 'e', '// SPDX-License-Identifier: Apache-2.0'].join('\n');
  assert.deepEqual(readSpdx(content), { found: false, identifier: null });
});

test('insertHeader: prepends the two-line header to plain content', () => {
  const result = insertHeader('export const x = 1;\n', 'Apache-2.0');
  assert.equal(
    result,
    '// SPDX-License-Identifier: Apache-2.0\n' +
      '// SPDX-FileCopyrightText: 2026 Fullstack Forge\n' +
      'export const x = 1;\n',
  );
});

test('insertHeader: is idempotent under readSpdx (round-trips)', () => {
  const inserted = insertHeader('export const x = 1;\n', 'LicenseRef-BUSL-1.1');
  assert.deepEqual(readSpdx(inserted), { found: true, identifier: 'LicenseRef-BUSL-1.1' });
});

test('insertHeader: preserves a leading shebang and inserts the header after it', () => {
  const result = insertHeader('#!/usr/bin/env node\nconsole.log(1);\n', 'Apache-2.0');
  assert.equal(
    result,
    '#!/usr/bin/env node\n' +
      '// SPDX-License-Identifier: Apache-2.0\n' +
      '// SPDX-FileCopyrightText: 2026 Fullstack Forge\n' +
      'console.log(1);\n',
  );
});

test('insertHeader: handles a shebang-only file with no trailing newline', () => {
  const result = insertHeader('#!/usr/bin/env node', 'Apache-2.0');
  assert.equal(
    result,
    '#!/usr/bin/env node\n' +
      '// SPDX-License-Identifier: Apache-2.0\n' +
      '// SPDX-FileCopyrightText: 2026 Fullstack Forge\n',
  );
});
