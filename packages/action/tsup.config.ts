import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],  // CommonJS for GitHub Actions
  dts: false,       // No type declarations needed
  splitting: false,
  sourcemap: true,
  clean: true,
  // Don't bundle @liendev/core - let it resolve at runtime like CLI does
  // This avoids bundling native modules (tree-sitter, lancedb)
  banner: {
    // Debug: runs BEFORE any requires to diagnose silent crashes
    js: `
console.log('🔍 [STARTUP] Action bundle loading...');
console.log('🔍 [STARTUP] Node:', process.version);
console.log('🔍 [STARTUP] CWD:', process.cwd());
try {
  const corePath = require.resolve('@liendev/core');
  console.log('🔍 [STARTUP] Core path:', corePath);
} catch (e) {
  console.log('❌ [STARTUP] Core not found:', e.message);
  process.exit(1);
}
console.log('🔍 [STARTUP] Loading modules...');
`,
  },
});
