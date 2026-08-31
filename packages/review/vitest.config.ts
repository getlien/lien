import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve `@liendev/parser` to its SOURCE for this package's tests.
      //
      // Without this, the specifier resolves through the workspace symlink and
      // parser's `exports` map to `packages/parser/dist`, while the signal
      // tests import the same modules by relative source path. That loaded two
      // copies of each module in one test file: a direct call saw source, and
      // the same code reached through `buildInitialMessage` saw the previous
      // compilation. An edit to a signal module was then visible to two-thirds
      // of its own test file and invisible to the rest, since neither `npm
      // test` nor `npm run test -w @liendev/review` builds parser first.
      //
      // Aliasing to source makes both paths the same module, so a source edit
      // is either seen everywhere or nowhere.
      '@liendev/parser': path.resolve(here, '../parser/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
