/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    // Type-aware linting (recommended-requiring-type-checking) needs full type
    // information. `project: true` resolves the nearest tsconfig.json for each
    // linted source file, so this works across every workspace package without
    // hard-coding a project list (and survives the free-edition CI leg that
    // physically removes packages/ee-* before linting). Files that live outside
    // any tsconfig (JS configs, *.config.ts, tests, the db seed) are detached
    // from the type-checked program in the overrides below.
    project: true,
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    // `_`-prefixed identifiers are an intentional "unused on purpose" marker
    // throughout the codebase (destructured tuples in tests, ignored args).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    // Require `import type` for type-only import *statements*, but still allow
    // the occasional inline `import('x').Type` annotation (used for one-off
    // deep casts and `typeof import()` references in tests).
    '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    // Fastify plugins and route registrars are typed `FastifyPluginAsync`, so
    // they are async by framework contract even when they do not directly
    // `await`. require-await only produces false positives against that pattern
    // here, so it is disabled.
    '@typescript-eslint/require-await': 'off',
    // TypeScript itself resolves and type-checks every import during
    // `pnpm typecheck`, so import/no-unresolved is redundant — and enabling it
    // would require a filesystem resolver (the typescript resolver pulls in a
    // native binary that is awkward to build reliably in CI). Leave resolution
    // to tsc; ESLint focuses on style/correctness rules.
    'import/no-unresolved': 'off',
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' },
      },
    ],
  },
  overrides: [
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      plugins: ['react', 'react-hooks'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      settings: { react: { version: 'detect' } },
      rules: {
        'react/react-in-jsx-scope': 'off',
      },
    },
    {
      // Plain JS/CJS/MJS files (configs, scripts) are not part of any TS
      // project. Detach them from type-aware linting so the type-checked rules
      // don't demand a parserServices program they can't have.
      files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
      env: { node: true },
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      parserOptions: { project: null },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // TS files that intentionally live outside the build tsconfigs: tool
      // configs (vite/vitest/drizzle/tailwind), test files, and the db seed
      // script (excluded from packages/db/tsconfig.json). They still get the
      // full syntactic ruleset (unused vars, import/order, consistent-type-
      // imports) — only the type-aware rules are turned off.
      files: ['**/*.config.ts', '**/*.test.ts', '**/*.test.tsx', 'packages/db/src/seed.ts'],
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      parserOptions: { project: null },
    },
  ],
  ignorePatterns: [
    'dist/',
    'build/',
    'node_modules/',
    '*.d.ts',
    'coverage/',
    '.turbo/',
    // Committed compiled artifact for drizzle-kit; lint the .ts source, not the
    // generated .js.
    'packages/db/drizzle.config.js',
  ],
};
