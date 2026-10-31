import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat preset for the whole monorepo.
 * Workspaces extend it and add their own files/globals as needed.
 * @type {import('eslint').Linter.Config[]}
 */
const preset = [
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Allow default exports only in Next.js pages/layouts/config files.
    files: [
      '**/{app,pages}/**/*.{ts,tsx}',
      '**/*.config.{ts,mts,mjs,js,cjs}',
      '**/next.config.*',
      // Framework conventions that require a default export:
      '**/proxy.ts', // Next.js 16 proxy (formerly middleware)
      '**/middleware.ts', // Next.js <= 15 middleware
      '**/i18n/request.ts', // next-intl request config
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Default exports are forbidden elsewhere.
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: [
      '**/{app,pages}/**/*.{ts,tsx}',
      '**/*.config.{ts,mts,mjs,js,cjs}',
      '**/next.config.*',
      '**/proxy.ts',
      '**/middleware.ts',
      '**/i18n/request.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'Default exports are not allowed except in Next.js pages/layouts and config files.',
        },
      ],
    },
  },
];

export default preset;
