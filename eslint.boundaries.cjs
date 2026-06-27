/**
 * Open-core import-boundary enforcement.
 *
 * This is a STANDALONE ESLint config (run with `--no-eslintrc -c`) whose only
 * job is to guarantee the load-bearing open-core rule:
 *
 *     core packages/apps may NEVER import commercial (`@niteowl/ee-*`) code.
 *     commercial may depend on core; core may never depend on commercial.
 *
 * It is deliberately separate from `.eslintrc.js` because that config enables
 * `@typescript-eslint/recommended-requiring-type-checking`, which needs full
 * TypeScript type information (`parserOptions.project`) to run. This boundary
 * check needs none of that — it only inspects import specifiers — so keeping it
 * standalone makes it fast, dependency-light, and reliable in CI.
 *
 * See docs/open-core.md for the open-core line and rationale.
 *
 * @type {import('eslint').Linter.Config}
 */
const EE_BOUNDARY_MESSAGE =
  'Open-core boundary violation: core packages/apps must not import commercial ' +
  '(@niteowl/ee-*) code. Core may never depend on commercial. ' +
  'See docs/open-core.md.';

/** Patterns that identify commercial (Enterprise Edition) modules. */
const eePatterns = [
  '@niteowl/ee-*',
  '@niteowl/ee-*/**',
  // Relative/deep paths into any packages/ee-* directory.
  '**/packages/ee-*',
  '**/packages/ee-*/**',
];

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  // No type-checking rules, no plugins requiring project services.
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: eePatterns.map((group) => ({ group: [group], message: EE_BOUNDARY_MESSAGE })),
      },
    ],
  },
  overrides: [
    {
      // Commercial packages are themselves allowed to import other ee-* modules.
      // The ban applies only to the open-source core (everything NOT under
      // packages/ee-*).
      files: ['packages/ee-*/**'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'build/', 'node_modules/', '*.d.ts', 'coverage/', '.turbo/'],
};
