// @ts-check
/**
 * Open-core import-boundary enforcement (flat config, ESLint 10+).
 *
 * This is a STANDALONE ESLint config (run with
 * `--no-config-lookup -c eslint.boundaries.mjs`) whose only job is to guarantee
 * the load-bearing open-core rule:
 *
 *     core packages/apps may NEVER import commercial (`@niteowl/ee-*`) code.
 *     commercial may depend on core; core may never depend on commercial.
 *
 * It is deliberately separate from `eslint.config.mjs` so it stays fast,
 * dependency-light, and reliable in CI: it only inspects import specifiers and
 * needs no type information or extra plugins. The only reason it loads the
 * TypeScript parser is so it can parse `.ts`/`.tsx` syntax.
 *
 * See docs/open-core.md for the open-core line and rationale.
 */
import tseslint from 'typescript-eslint';

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

export default [
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/*.d.ts', '**/coverage/**', '**/.turbo/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: eePatterns.map((group) => ({ group: [group], message: EE_BOUNDARY_MESSAGE })),
        },
      ],
    },
  },
  {
    // Commercial packages are themselves allowed to import other ee-* modules.
    // The ban applies only to the open-source core (everything NOT under
    // packages/ee-*).
    files: ['packages/ee-*/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
