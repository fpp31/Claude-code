import { defineConfig } from 'vitest/config';

// One test runner for the whole project. Every package keeps its tests in
// packages/<name>/test/ and they all run with `npm test`.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
