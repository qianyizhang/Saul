import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: ['.output/**', '.wxt/**', '.build/**', '.pnpm-store/**', 'coverage/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Author maintained logic in strict TypeScript. JavaScript is reserved for generated output and the ESLint config.',
        },
      ],
    },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts}'],
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
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', '**/native/**/*.mts', '**/native/storage/**', '**/board/**'] },
      ],
    },
  },
  {
    files: [
      'src/settings/{draft,recovery}.ts',
      'src/configuration/{definition,inspect,record,resolve}.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        'chrome',
        'fetch',
        'process',
        'Buffer',
        '__dirname',
        '__filename',
        'require',
        'module',
        'exports',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            '**/native/**/*.mts',
            '**/native/storage/**',
            '**/board/**',
            '../storage/*',
            '../native/*',
            './store',
            './chrome-storage',
            './client',
            '../configuration/store',
            '../configuration/chrome-storage',
            '../configuration/client',
          ],
        },
      ],
    },
  },
  {
    files: ['native/**/*.{mts,ts}', 'scripts/**/*.mts', 'design/**/*.mts', '*.mjs', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['native/**/*.{mts,ts}'],
    rules: {
      'no-restricted-globals': ['error', 'chrome', 'window', 'document'],
      'no-restricted-imports': [
        'error',
        { patterns: ['**/src/**', '**/entrypoints/**', '**/board/**'] },
      ],
    },
  },
  {
    files: ['board/*.ts', 'shared/**/*.{mts,ts}'],
    rules: {
      'no-restricted-globals': [
        'error',
        'chrome',
        'process',
        'Buffer',
        'require',
        'module',
        'exports',
        '__dirname',
        '__filename',
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', '**/src/**', '**/entrypoints/**', '**/native/**'] },
      ],
    },
  },
  { files: ['board/*.ts'], languageOptions: { globals: globals.browser } },
  {
    files: ['tests/**/*.{ts,mts}'],
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
  {
    files: ['native/window-names.jxa.ts'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^run$' }] },
  },
  // Playwright inspects fixture names from the destructured first argument.
  { files: ['tests/e2e/**/*.ts'], rules: { 'no-empty-pattern': 'off' } },
);
