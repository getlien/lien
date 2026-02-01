import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Bundle @liendev/review into dist so the action is self-contained
  // (GitHub Actions runs dist/index.js directly without npm install)
  noExternal: ['@liendev/review'],
});
