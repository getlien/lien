import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],  // CommonJS for GitHub Actions
  dts: false,       // No type declarations needed
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: ['@liendev/core'],  // Bundle core into the output
});
