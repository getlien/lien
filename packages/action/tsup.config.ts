import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM - matches @liendev/core
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Bundle @liendev/core INTO the action (like we tried before)
  // But keep native modules external - they'll be found via workflow's npm ci
  noExternal: ['@liendev/core'],
  external: [
    // Native modules with .node binaries - must be loaded from node_modules
    '@lancedb/lancedb',
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-typescript', 
    'tree-sitter-python',
    'tree-sitter-php',
    '@xenova/transformers',
  ],
});
