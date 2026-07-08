// @ts-check
/**
 * Flat ESLint config (ESLint 10+).
 *
 * Ported 1:1 from the previous `.eslintrc.js`. ESLint 10 dropped the eslintrc
 * format, so this file reproduces the same effective configuration:
 *   - eslint:recommended + @typescript-eslint recommended-type-checked
 *     (type-aware linting via `project: true`)
 *   - eslint-plugin-import recommended + TS extensions, with `import/order`.
 *     `import/no-unresolved` stays OFF: tsc already resolves every import during
 *     `pnpm typecheck`, and enabling it would pull in a native resolver binary
 *     that is awkward to build in CI.
 *   - react (pre-flat-config, wrapped with @eslint/compat's fixupPluginRules
 *     so it runs on ESLint 10 without bumping) plus react-hooks v7, which is
 *     flat-config native (no fixup shim) and turns on the React Compiler rule
 *     set — refs-during-render, set-state-in-effect, immutability, purity, …
 *     — as errors by default. See FUL-153.
 *   - eslint-config-prettier last, to disable stylistic rules Prettier owns.
 *
 * The open-core import-boundary guard remains a standalone config
 * (`eslint.boundaries.mjs`); see docs/open-core.md.
 */
import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores (replaces `ignorePatterns`).
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
      // Committed compiled artifact for drizzle-kit; lint the .ts source.
      'packages/db/drizzle.config.js',
    ],
  },

  // Base rule sets.
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,

  // Project-wide language options + rules.
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Type-aware linting needs full type info. `project: true` resolves the
        // nearest tsconfig for each source file across every workspace package
        // and survives the free-edition
        // CI leg that removes packages/ee-* before linting. Files outside any
        // tsconfig (JS configs, tests, the db seed) are detached below.
        project: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      // Resolve TS/JS via the node resolver with TS extensions; no native
      // typescript resolver (see `import/no-unresolved` note above).
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'] },
      },
    },
    rules: {
      // `_`-prefixed identifiers are an intentional "unused on purpose" marker
      // throughout the codebase (destructured tuples in tests, ignored args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Require `import type` for type-only import *statements*, but still allow
      // inline `import('x').Type` annotations (used for one-off deep casts).
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      // Fastify plugins/route registrars are `FastifyPluginAsync` — async by
      // framework contract even without an `await`. Avoids false positives.
      '@typescript-eslint/require-await': 'off',
      // tsc resolves imports during typecheck, so no-unresolved is redundant and
      // would require a native resolver binary. Leave resolution to tsc.
      'import/no-unresolved': 'off',
      // Newly added to eslint:recommended in ESLint 10. It was not enforced
      // before this migration; enabling it flags pre-existing dead stores that
      // need app-logic review. Kept off here to preserve the pre-migration rule
      // set — turning it on and fixing the sites is a separate follow-up.
      'no-useless-assignment': 'off',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
    },
  },

  // Web app: React + React hooks.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react: fixupPluginRules(react),
      // react-hooks v7 ships a flat-config-native plugin; no compat shim.
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: '19.2' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // react-hooks v7 recommended = rules-of-hooks + exhaustive-deps + the
      // React Compiler rule set. Flat config object; spread its rules.
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
  },

  // Plain JS/CJS/MJS files (configs, scripts) are not part of any TS project.
  // Detach them from type-aware linting so type-checked rules don't demand a
  // parserServices program they can't have.
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { project: null },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  // TS files that intentionally live outside the build tsconfigs: tool configs
  // (vite/vitest/drizzle/tailwind), test files, and the db seed script. They
  // still get the full syntactic ruleset — only type-aware rules are off.
  {
    files: ['**/*.config.ts', '**/*.test.ts', '**/*.test.tsx', 'packages/db/src/seed.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { project: null },
    },
  },

  // Disable stylistic rules owned by Prettier. Must come last.
  prettier,
);
