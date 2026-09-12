import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import sonarjs from 'eslint-plugin-sonarjs';
import reactHooks from 'eslint-plugin-react-hooks';
import pluginRegexp from 'eslint-plugin-regexp';
import eslintConfigPrettier from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'scripts/**',
      'worker-configuration.d.ts',
      'app/dist/**',
      'apps/web/dist/**',
      'src/generated/**',
      'apps/api/src/generated/**',
      'coverage/**',
      'coverage-integration/**',
      'node_modules/**',
      'test/**',
    ],
  },

  // Base: globals for all JS/TS source files
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx,jsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // TypeScript: type-aware recommended rules, scoped to TS files only
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // --- typescript-eslint overrides ---
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // Allow `void expr` for intentional fire-and-forget in Workers
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Allow explicit `any` in limited cases already existing in the codebase
      '@typescript-eslint/no-explicit-any': 'warn',
      // Relax unsafe rules to warn — too noisy at the `any` boundary of external APIs
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // JSX event handlers and hook callback objects commonly use async functions where void is expected
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, properties: false } }],
    },
  },

  // --- Unicorn: modern JS/TS quality rules ---
  unicorn.configs['flat/recommended'],
  {
    rules: {
      // Codebase uses ctx, req, res, env, err, util, db, dao, etc. — too invasive to rename
      'unicorn/prevent-abbreviations': 'off',
      // D1/DAO layer returns null; disabling this avoids mass rewrites
      'unicorn/no-null': 'off',
      // Monorepo uses CommonJS-compatible module style in some configs
      'unicorn/prefer-module': 'off',
      // Top-level await not available in all Workers entry points
      'unicorn/prefer-top-level-await': 'off',
      // Error subclassing via `new MyError()` is intentional in backend-errors
      'unicorn/custom-error-definition': 'off',
      // Template literals throughout the codebase are fine as-is
      'unicorn/no-useless-undefined': 'off',
      // Allow process.exit in build/script files
      'unicorn/no-process-exit': 'off',
      // Array reduce is used intentionally in analytics/data transformation
      'unicorn/no-array-reduce': 'off',
      // Allow Number() — parseInt/parseFloat are used in some cases intentionally
      'unicorn/prefer-number-properties': ['error', { checkInfinity: false }],
      // Allow nested ternaries in JSX (React render patterns)
      'unicorn/no-nested-ternary': 'off',
      // Allow Array.from — codebase uses it for iterables
      'unicorn/prefer-spread': 'off',
      // Entire codebase uses PascalCase for TS files; kebab-case would require mass renames
      'unicorn/filename-case': 'off',
      // Established names (AccessBridgeWorker, BaseUrlUtil, etc.) should not be force-renamed
      'unicorn/name-replacements': 'off',
      // Zod schema builder chains and other deep method chains are intentional
      'unicorn/max-nested-calls': 'off',
      // import.meta.dirname is not available in all test environments
      'unicorn/prefer-import-meta-properties': 'off',
      // Codebase uses `err` as catch parameter name throughout; too invasive to rename
      'unicorn/catch-error-name': 'off',
      // Established boolean param names (retryable, enabled, etc.) should not be force-prefixed
      'unicorn/consistent-boolean-name': 'off',
      // Uint8Array#toBase64 / fromBase64 are not guaranteed in all Workers runtime versions
      'unicorn/prefer-uint8array-base64': 'off',
      // Class member ordering would require extensive restructuring of existing classes
      'unicorn/consistent-class-member-order': 'off',
      // AWS API response fields use verb prefixes by convention
      'unicorn/no-non-function-verb-prefix': 'off',
      // forEach is used intentionally throughout the codebase in service and utility layers
      'unicorn/no-for-each': 'off',
      // .then() chains in DAO and service layers are often intentional — warn, don't block
      'unicorn/prefer-await': 'warn',
      // Callback references (e.g. .map(Number)) are sometimes intentional
      'unicorn/no-array-callback-reference': 'warn',
      // toSorted() is ES2023 and may not be in all tsconfig lib targets
      'unicorn/no-array-sort': 'warn',
    },
  },

  // --- SonarJS: code smell and bug detection ---
  sonarjs.configs.recommended,
  {
    rules: {
      // Raise duplicate-string threshold to avoid flagging intentional repeated literals like account IDs
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      // Cognitive complexity — warn rather than error to allow gradual improvement
      'sonarjs/cognitive-complexity': ['warn', 20],
      // False positives: connection method names and field names like 'password_hash'
      'sonarjs/no-hardcoded-passwords': 'off',
      // Third-party deprecations (e.g. Zod v4 migration) are warnings, not errors
      'sonarjs/deprecation': 'warn',
      // Nested ternaries in complex data-mapping code — warn rather than block
      'sonarjs/no-nested-conditional': 'warn',
      // React component props are commonly not marked Readonly<>; enforce gradually
      'sonarjs/prefer-read-only-props': 'warn',
      // Static readonly properties require invasive refactoring of established utility classes
      'sonarjs/public-static-readonly': 'warn',
      // Nested template literals are used intentionally in SQL queries and prompt construction
      'sonarjs/no-nested-template-literals': 'warn',
    },
  },

  // --- React Hooks: rules of hooks for the SPA ---
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },

  // --- Regexp: static analysis for regular expressions ---
  pluginRegexp.configs['flat/recommended'],

  // --- Prettier: report formatting drift as lint warnings; disable conflicting stylistic rules ---
  eslintConfigPrettier,
  {
    plugins: { prettier },
    rules: {
      'prettier/prettier': 'warn',
    },
  },

  // --- Import direction guardrails ---
  // Layer 0: shared — zero @aws-access-bridge/* deps
  {
    files: ['packages/shared/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-access-bridge/*'],
              message: 'shared must not import from other @aws-access-bridge packages — it is a zero-dependency base layer',
            },
          ],
        },
      ],
    },
  },
  // Layer 0: backend-errors — zero @aws-access-bridge/* deps
  {
    files: ['packages/backend-errors/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-access-bridge/*'],
              message: 'backend-errors must not import from other @aws-access-bridge packages — it is a zero-dependency base layer',
            },
          ],
        },
      ],
    },
  },
  // Layer 1: backend-runtime — only shared and backend-errors
  {
    files: ['packages/backend-runtime/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-access-bridge/backend-data', '@aws-access-bridge/backend-data/*'],
              message: 'backend-runtime must not import from backend-data (higher layer)',
            },
            {
              group: ['@aws-access-bridge/backend-services', '@aws-access-bridge/backend-services/*'],
              message: 'backend-runtime must not import from backend-services (higher layer)',
            },
            { group: ['@aws-access-bridge/api', '@aws-access-bridge/api/*'], message: 'backend-runtime must not import from apps/api' },
            {
              group: ['@aws-access-bridge/background', '@aws-access-bridge/background/*'],
              message: 'backend-runtime must not import from apps/background',
            },
          ],
        },
      ],
    },
  },
  // Layer 2: backend-data — only shared and backend-errors
  {
    files: ['packages/backend-data/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-access-bridge/backend-runtime', '@aws-access-bridge/backend-runtime/*'],
              message: 'backend-data must not import from backend-runtime',
            },
            {
              group: ['@aws-access-bridge/backend-services', '@aws-access-bridge/backend-services/*'],
              message: 'backend-data must not import from backend-services (higher layer)',
            },
            { group: ['@aws-access-bridge/api', '@aws-access-bridge/api/*'], message: 'backend-data must not import from apps/api' },
            {
              group: ['@aws-access-bridge/background', '@aws-access-bridge/background/*'],
              message: 'backend-data must not import from apps/background',
            },
          ],
        },
      ],
    },
  },
  // Layer 3: backend-services — cannot import apps
  {
    files: ['packages/backend-services/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@aws-access-bridge/api', '@aws-access-bridge/api/*'], message: 'backend-services must not import from apps/api' },
            {
              group: ['@aws-access-bridge/background', '@aws-access-bridge/background/*'],
              message: 'backend-services must not import from apps/background',
            },
          ],
        },
      ],
    },
  },
  // Layer 5: apps/api — route AWS SDK usage through backend-services, not directly
  {
    files: ['apps/api/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['aws4fetch'],
              message: 'apps/api must not import aws4fetch directly; use @aws-access-bridge/backend-services instead',
            },
          ],
        },
      ],
    },
  },
  // Layer 5: apps/api routes — compose backend-services, never DAOs directly
  // (type-only DAO imports for filters/models and D1 constants in the base route stay allowed)
  {
    files: ['apps/api/src/endpoints/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-access-bridge/backend-data/dao', '@aws-access-bridge/backend-data/dao/*'],
              allowTypeImports: true,
              message:
                'route classes must not import DAOs directly; add a method to the owning @aws-access-bridge/backend-services domain service and call it via its factory',
            },
          ],
        },
      ],
    },
  },

  // --- Test file overrides (must be last to override plugin rules) ---
  {
    files: ['test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      // Unbound method is a common false positive in Vitest/Jest mock assertions like expect(fn).toHaveBeenCalledWith(...)
      '@typescript-eslint/unbound-method': 'off',
      // Test helpers and stubs routinely use async functions without await
      '@typescript-eslint/require-await': 'off',
      // Redundant type constituents appear in typed mock stubs
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // Promise.withResolvers() and function-scoping refactors are cosmetic in tests
      'unicorn/prefer-promise-with-resolvers': 'off',
      'unicorn/consistent-function-scoping': 'off',
      // sonarjs/assertions-in-tests fires false positives when test helpers handle assertions indirectly
      'sonarjs/assertions-in-tests': 'off',
      // sonarjs/no-extra-arguments fires incorrectly on Vitest mock overloads
      'sonarjs/no-extra-arguments': 'off',
    },
  },
);
