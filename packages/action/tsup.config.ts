import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM - matches @liendev/core and CLI
  dts: false,       // No type declarations needed
  splitting: false,
  sourcemap: true,
  clean: true,
  // Don't bundle @liendev/core - let it resolve at runtime like CLI does
  // This avoids bundling native modules (tree-sitter, lancedb)
});
