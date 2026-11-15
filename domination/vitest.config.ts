import { defineConfig } from 'vitest/config';

// One test runner for the whole project. Every package keeps its tests in
// packages/<name>/test/ and they all run with `npm test`.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // A test that imports a stylesheet gets an empty text unless the sheet is
    // named here. One test reads the client's stylesheet as text, to check the
    // colours written in it (packages/client/test/shellStyles.test.ts).
    css: { include: [/packages\/client\/src\/styles\.css/] },
  },
});
