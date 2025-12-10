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
  banner: {
    js: `
console.log('🔍 [STARTUP] Action file starting...');
console.log('🔍 [STARTUP] Node:', process.version);
console.log('🔍 [STARTUP] CWD:', process.cwd());
console.log('🔍 [STARTUP] About to load imports...');

process.on('uncaughtException', (err) => {
  console.error('❌ [UNCAUGHT]', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ [UNHANDLED]', reason);
  process.exit(1);
});
`,
  },
});
