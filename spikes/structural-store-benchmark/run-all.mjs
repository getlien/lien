// Orchestrator: for each backend, (re)build its index and run the benchmark,
// each in a FRESH child process (isolated cold-start + peak-memory, no
// cross-backend contention). Aggregates everything into results.json.
//
// Usage: tsx run-all.mjs [backend ...]   (default: all four)

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BACKENDS } from './lib/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Native-binary install weight, measured on this machine (darwin-arm64).
// LanceDB also pulls apache-arrow (~7.5MB JS). These are the dominant
// dependency-footprint numbers; see README for how they were measured.
const INSTALL_WEIGHT = {
  lancedb: {
    nativeBinaryMB: 93,
    note: '@lancedb/lancedb darwin-arm64 .node + ~7.5MB apache-arrow',
  },
  'better-sqlite3': {
    nativeBinaryMB: 1.8,
    note: 'better_sqlite3.node (prebuilt), 12MB total package',
  },
  libsql: { nativeBinaryMB: 7.5, note: '@libsql/darwin-arm64 prebuilt binary' },
  duckdb: { nativeBinaryMB: 113, note: '@duckdb/node-bindings-darwin-arm64 (115MB total package)' },
};

function run(script, backend) {
  const out = execFileSync('npx', ['tsx', script, backend], {
    cwd: __dirname,
    maxBuffer: 64 * 1024 * 1024,
    // Suppress LanceDB's Rust deprecation warnings on stderr; keep stdout JSON.
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env },
  }).toString();
  const line = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

async function main() {
  const backends = process.argv.slice(2).length ? process.argv.slice(2) : ALL_BACKENDS;
  const inputs = JSON.parse(readFileSync(path.join(__dirname, 'query-inputs.json'), 'utf8'));

  const byBackend = {};
  for (const backend of backends) {
    console.error(`\n=== ${backend}: build ===`);
    const build = run('build-index.mjs', backend);
    console.error(`  indexBuildMs=${build.indexBuildMs} onDiskMB=${build.onDiskMB}`);

    console.error(`=== ${backend}: bench ===`);
    const bench = run('bench.mjs', backend);
    console.error(
      `  cold=${bench.coldStartMs}ms peakMem=${bench.peakMemMB}MB ` +
        `fileCtx.p50=${bench.results.getFilesContext.p50}ms ` +
        `deps.p50=${bench.results.getDependents.p50}ms`,
    );

    byBackend[backend] = {
      installWeight: INSTALL_WEIGHT[backend],
      indexBuildMs: build.indexBuildMs,
      onDiskMB: build.onDiskMB,
      coldStartMs: bench.coldStartMs,
      peakMemMB: bench.peakMemMB,
      nLight: bench.nLight,
      nHeavy: bench.nHeavy,
      results: bench.results,
      getDependentsIndexed: bench.getDependentsIndexed,
    };
  }

  const output = {
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    corpus: {
      repo: 'getlien/lien (git-tracked source)',
      totalChunks: inputs.totalChunks,
      baseChunks: inputs.baseChunks,
      note: 'lien repo indexed via performChunkOnlyIndex, replicated 10x with path-prefixed copies to reach monorepo scale',
    },
    queryInputs: {
      filesContextTargets: inputs.filesContextTargets.length,
      dependentsTargets: inputs.dependentsTargets.length,
      listFunctionsPatterns: inputs.listFunctionsPatterns.length,
      testAssocTargets: inputs.testAssocTargets.length,
    },
    backends: byBackend,
  };
  const outPath = path.join(__dirname, 'results.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.error(`\nwrote ${outPath}`);
}

main().catch(e => {
  console.error('run-all FAILED:', e.stack || e.message);
  process.exit(1);
});
