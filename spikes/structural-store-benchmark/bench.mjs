// Benchmark one backend against a pre-built on-disk index, in a FRESH process.
// Measures cold-start, then p50/p95/p99 over N iterations per query type, plus
// peak RSS. Emits one JSON line to stdout.
// Usage: tsx bench.mjs <backend>
//
// Each query type is the STORAGE-differentiating work of a real Lien tool.
// The pure-JS post-processing that every tool layers on top (import-graph
// build, test-association pass) is included where it is O(N) and identical
// across backends; get_complexity's dependency-enrichment CPU is deliberately
// NOT run here — it is backend-independent parser work that would swamp the
// storage signal, so get_complexity is measured as its scanAll read (which is
// exactly the per-file complexity read cost).
//
//   getFilesContext  -> scanWithFilter point lookup (production hot path, cached=no)
//   listFunctions    -> querySymbols with a real regex pattern (full scan today)
//   getDependents    -> scanAll + faithful import-graph seed (UNCACHED — isolates
//                       the per-index-rebuild storage cost that feeds the cache)
//   testAssocScan    -> scanAll + parser's real findTestAssociationsFromChunks
//   getComplexityScan-> scanAll(COMPLEXITY_ANALYZER_COLUMNS) read

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTestAssociationsFromChunks } from '@liendev/parser';
import {
  makePathNormalizer,
  buildImportIndex,
  findDependentChunks,
  timeIterations,
  peakRssMB,
  DEPENDENCY_GRAPH_COLUMNS,
  TEST_ASSOCIATIONS_COLUMNS,
  FILE_CONTEXT_COLUMNS,
  LIST_FUNCTIONS_COLUMNS,
  COMPLEXITY_ANALYZER_COLUMNS,
} from './lib/shared.mjs';
import { makeAdapter } from './lib/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Iteration budgets. Point lookups + the indexed seed are sub-ms -> high N.
// Full-scan ops re-read every row each iteration -> N_HEAVY (>=100 per the
// methodology). Overridable via N_LIGHT / N_HEAVY for quick validation runs.
const N_LIGHT = parseInt(process.env.N_LIGHT || '200', 10);
const N_HEAVY = parseInt(process.env.N_HEAVY || '100', 10);

async function main() {
  const backend = process.argv[2];
  const inputs = JSON.parse(readFileSync(path.join(__dirname, 'query-inputs.json'), 'utf8'));
  const workspaceRoot = inputs.workspaceRoot;

  const adapter = await makeAdapter(backend);

  // --- COLD START: open + first point lookup (connection + first read, cache-cold).
  const coldT0 = process.hrtime.bigint();
  await adapter.open();
  await adapter.scanWithFilter({
    file: [inputs.filesContextTargets[0]],
    columns: FILE_CONTEXT_COLUMNS,
    limit: 100,
  });
  const coldStartMs = Number(process.hrtime.bigint() - coldT0) / 1e6;

  const results = {};

  // (a) get_files_context — point lookup of one file's chunks.
  results.getFilesContext = await timeIterations(async i => {
    const target = inputs.filesContextTargets[i % inputs.filesContextTargets.length];
    await adapter.scanWithFilter({ file: [target], columns: FILE_CONTEXT_COLUMNS, limit: 100 });
  }, N_LIGHT);

  // (c) list_functions — symbol pattern match (full-table scan + regex today).
  results.listFunctions = await timeIterations(async i => {
    const pattern = inputs.listFunctionsPatterns[i % inputs.listFunctionsPatterns.length];
    await adapter.querySymbols({ pattern, columns: LIST_FUNCTIONS_COLUMNS, limit: 51 });
  }, N_HEAVY);

  // (b) get_dependents — UNCACHED scan + import-graph seed.
  results.getDependents = await timeIterations(async i => {
    const target = inputs.dependentsTargets[i % inputs.dependentsTargets.length];
    const norm = makePathNormalizer(workspaceRoot);
    const chunks = await adapter.scanAll({ columns: DEPENDENCY_GRAPH_COLUMNS });
    const importIndex = buildImportIndex(chunks, norm);
    findDependentChunks(importIndex, norm(target));
  }, N_HEAVY);

  // (e) test-association full scan + real association pass.
  results.testAssocScan = await timeIterations(async () => {
    const chunks = await adapter.scanAll({ columns: TEST_ASSOCIATIONS_COLUMNS });
    findTestAssociationsFromChunks(inputs.testAssocTargets, chunks, workspaceRoot);
  }, N_HEAVY);

  // (d) get_complexity — the storage read the analyzer performs (scanAll with
  // the analyzer's column projection). The analyzer's downstream CPU is
  // backend-independent and excluded (see header).
  results.getComplexityScan = await timeIterations(async () => {
    await adapter.scanAll({ columns: COMPLEXITY_ANALYZER_COLUMNS });
  }, N_HEAVY);

  // Bonus: indexed import-graph seed (SQLite/libSQL child-table lookup) — the
  // O(log N) upgrade that replaces the O(N) full scan for the dependents seed.
  let getDependentsIndexed = null;
  if (typeof adapter.dependentsSeedIndexed === 'function') {
    getDependentsIndexed = await timeIterations(async i => {
      const target = inputs.dependentsTargets[i % inputs.dependentsTargets.length];
      const leaf = target
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '');
      await adapter.dependentsSeedIndexed(leaf);
    }, N_LIGHT);
  }

  const peakMemMB = peakRssMB();
  await adapter.close();

  process.stdout.write(
    JSON.stringify({
      backend,
      coldStartMs: Math.round(coldStartMs * 100) / 100,
      peakMemMB,
      nLight: N_LIGHT,
      nHeavy: N_HEAVY,
      results,
      getDependentsIndexed,
    }) + '\n',
  );
}

main().catch(e => {
  console.error(`[bench ${process.argv[2]}] FAILED:`, e.stack || e.message);
  process.exit(1);
});
