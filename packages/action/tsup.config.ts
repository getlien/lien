import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM - matches @liendev/core
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Don't bundle @liendev/core - it will be npm installed before action runs
  // This matches how CLI works: core is a dependency installed via npm
});
