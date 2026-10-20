import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: ['.output/**', '.wxt/**', '.pnpm-store/**', 'coverage/**'],
  },
  js.configs.recommended,
  { files: ['native/ui/*.js'], languageOptions: { globals: globals.browser } },
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        '__dirname',
        '__filename',
        'require',
        'module',
        'exports',
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*'] }],
    },
  },
  {
    files: ['native/**/*.mjs', 'scripts/**/*.mjs', 'design/**/*.mjs', '*.mjs', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['entrypoints/background.ts'],
    languageOptions: { globals: { defineBackground: 'readonly' } },
  },
  {
    files: ['entrypoints/content.tsx'],
    languageOptions: { globals: { defineContentScript: 'readonly' } },
  },
  // Playwright inspects fixture names from the destructured first argument.
  { files: ['tests/e2e/**/*.ts'], rules: { 'no-empty-pattern': 'off' } },
);
