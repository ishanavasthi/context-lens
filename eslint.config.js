import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Default runtime is Node. The extension overrides this below.
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    // Extension code runs in the browser and against the chrome extension API.
    files: ['apps/extension/**/*.{ts,js}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly' },
    },
  },
  {
    files: ['**/*.config.{js,ts}', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
