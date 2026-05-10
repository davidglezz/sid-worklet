import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
  },
  staged: {
    '*.test.ts': 'vp fmt --write',
    '*': 'vp check --fix',
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    coverage: {
      provider: 'v8',
      exclude: ['**/*.bench.ts', '**/*.d.ts', 'src/main.ts', 'src/counter.ts'],
      reporter: ['text', 'html'],
    },
  },
  base: '/sid-worklet/',
});
