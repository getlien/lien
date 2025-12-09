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
    // Use process.stdout.write for immediate output
    js: `
process.stdout.write('🔍 [STARTUP] Action bundle loading...\\n');
process.stdout.write('🔍 [STARTUP] Node: ' + process.version + '\\n');
process.stdout.write('🔍 [STARTUP] CWD: ' + process.cwd() + '\\n');
try {
  const corePath = require.resolve('@liendev/core');
  process.stdout.write('🔍 [STARTUP] Core path: ' + corePath + '\\n');
  process.stdout.write('🔍 [STARTUP] About to require @liendev/core...\\n');
} catch (e) {
  process.stdout.write('❌ [STARTUP] Core not found: ' + e.message + '\\n');
  process.exit(1);
}
`,
  },
});
