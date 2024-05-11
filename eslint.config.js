import antfu from '@antfu/eslint-config';

export default antfu(
  {
    stylistic: false,
    vue: false,
  },
  {
    rules: {
      'no-fallthrough': 'off',
      'ts/no-duplicate-enum-values': 'off',
      'no-restricted-syntax': ['error', 'TSEnumDeclaration[const=false]'],

      // Prettier incompatibility
      'unicorn/number-literal-case': 'off',
      'node/prefer-global/buffer': 'off',
    },
  },
  {
    files: ['**/*.bench.ts'],
    rules: {
      'test/consistent-test-it': 'off',
    },
  },
);
