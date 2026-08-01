import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/web/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Plain-JS dev tooling under scripts/. `no-undef` is off for TypeScript
    // (tseslint disables it, because tsc decides that better) but on here, and
    // the globals are listed by name rather than pulled from the `globals`
    // package: three entries is not worth a dependency, and an explicit list
    // makes it visible when a script starts reaching for a fourth.
    //
    // This is an ADDITIONAL config object, not an edit to index 0 — SC58's pin
    // asserts `ignores` there by exact equality, and `pnpm lint`'s file set is
    // unchanged by anything here.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
