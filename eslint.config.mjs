// @ts-check
// Root ESLint flat config. The shared typescript-eslint preset lives in
// packages/config and is consumed by every workspace package.
import eslintPreset from '@app/config/eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'data/**',
    ],
  },
  ...eslintPreset,
  {
    files: ['scripts/**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
