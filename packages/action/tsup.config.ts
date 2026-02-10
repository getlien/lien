import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Bundle @liendev/review into dist (pure JS).
  // Native modules (@liendev/core, lancedb, tree-sitter) stay external
  // and are installed via npm ci in the CI workflow (ai-review.yml).
  noExternal: ['@liendev/review'],
  external: ['@liendev/core', '@lancedb/lancedb', 'tree-sitter', '@huggingface/transformers'],
});
