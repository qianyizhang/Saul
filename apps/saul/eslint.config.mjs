import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import { builtinModules } from 'node:module';

const hostGlobals = [
  'chrome',
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
];
// Shared code can use portable Web APIs, but not host identity or ambient storage.
const sharedHostGlobals = [
  ...new Set([
    ...hostGlobals,
    'navigator',
    'localStorage',
    'sessionStorage',
    ...Object.keys(globals.browser).filter((name) => !Object.hasOwn(globals.node, name)),
    ...Object.keys(globals.node).filter((name) => !Object.hasOwn(globals.browser, name)),
  ]),
];
const extensionImportPatterns = [
  'node:*',
  '**/native/**/*.mts',
  '**/native/storage/**',
  '**/board/**',
];

function featureImports(files, blocked) {
  const feature = `(?:^|/)(?:${blocked.join('|')})(?:/|$)`;
  const message = 'Use a shared capability instead of importing this feature.';
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: extensionImportPatterns }, { regex: feature, message }] },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: `ImportExpression[source.value=/${feature.replaceAll('/', '\\/')}/]`, message },
      ],
    },
  };
}

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
      'no-restricted-imports': ['error', { patterns: extensionImportPatterns }],
    },
  },
  featureImports(['src/calls/**/*.{ts,tsx}'], ['annotations', 'reading']),
  featureImports(['src/annotations/**/*.{ts,tsx}', 'src/reading/**/*.{ts,tsx}'], ['calls']),
  featureImports(['src/custom-actions/**/*.{ts,tsx}'], ['calls', 'annotations', 'reading']),
  {
    files: [
      'src/settings/{draft,recovery}.ts',
      'src/configuration/{codec,definition,inspect,resolver}.ts',
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
            '**/reading/**',
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
        { patterns: ['**/src/**', '**/entrypoints/**', '**/board/**', '**/browser/**'] },
      ],
    },
  },
  {
    files: ['board/**/*.ts', 'browser/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...hostGlobals],
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', '**/src/**', '**/entrypoints/**', '**/native/**'] },
      ],
    },
  },
  { files: ['board/**/*.ts', 'browser/**/*.ts'], languageOptions: { globals: globals.browser } },
  {
    files: ['shared/**/*.{mts,ts}'],
    rules: {
      'no-restricted-globals': ['error', { globals: sharedHostGlobals, checkGlobalObject: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            ...builtinModules,
            '**/src/**',
            '**/entrypoints/**',
            '**/native/**',
            '**/board/**',
            '**/browser/**',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Shared modules use static imports so runtime ownership is checked.',
        },
      ],
    },
  },
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
