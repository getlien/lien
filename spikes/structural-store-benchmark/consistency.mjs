// Validity guard: confirm every backend returns the SAME logical result for
// identical inputs. If the stores disagree on counts, the latency comparison
// is meaningless. Emits a small table; exits non-zero on a mismatch.

import { readFileSync } from 'node:fs';
import { findTestAssociationsFromChunks } from '@liendev/parser';
import {
  makePathNormalizer,
  buildImportIndex,
  findDependentChunks,
  DEPENDENCY_GRAPH_COLUMNS,
  TEST_ASSOCIATIONS_COLUMNS,
  FILE_CONTEXT_COLUMNS,
  LIST_FUNCTIONS_COLUMNS,
} from './lib/shared.mjs';
import { makeAdapter, ALL_BACKENDS } from './lib/adapters.mjs';

const inputs = JSON.parse(readFileSync('./query-inputs.json', 'utf8'));
const workspaceRoot = inputs.workspaceRoot;
const fileTarget = inputs.filesContextTargets[5];
const depTarget = inputs.dependentsTargets[0];
const pattern = 'handle';

const rows = {};
for (const backend of ALL_BACKENDS) {
  const a = await makeAdapter(backend);
  await a.open();
  const fc = await a.scanWithFilter({
    file: [fileTarget],
    columns: FILE_CONTEXT_COLUMNS,
    limit: 100,
  });
  const lf = await a.querySymbols({ pattern, columns: LIST_FUNCTIONS_COLUMNS, limit: 51 });
  const norm = makePathNormalizer(workspaceRoot);
  const depChunks = await a.scanAll({ columns: DEPENDENCY_GRAPH_COLUMNS });
  const ii = buildImportIndex(depChunks, norm);
  const deps = findDependentChunks(ii, norm(depTarget)).length;
  const taChunks = await a.scanAll({ columns: TEST_ASSOCIATIONS_COLUMNS });
  const ta = findTestAssociationsFromChunks(inputs.testAssocTargets, taChunks, workspaceRoot);
  const taTotal = [...ta.values()].reduce((s, v) => s + v.length, 0);
  rows[backend] = {
    fileLookupChunks: fc.length,
    listFunctionsResults: lf.length,
    depScanRows: depChunks.length,
    dependentChunks: deps,
    testAssocFiles: taTotal,
  };
  await a.close();
}

console.log('input file target:', fileTarget);
console.log('input dependents target:', depTarget, `(pattern="${pattern}")`);
console.table(rows);

// Verify parity across backends (counts must match).
const keys = Object.keys(rows[ALL_BACKENDS[0]]);
let ok = true;
for (const k of keys) {
  const vals = ALL_BACKENDS.map(b => rows[b][k]);
  if (new Set(vals).size !== 1) {
    console.error(
      `MISMATCH on ${k}:`,
      Object.fromEntries(ALL_BACKENDS.map((b, i) => [b, vals[i]])),
    );
    ok = false;
  }
}
console.log(ok ? 'PARITY OK — all backends agree' : 'PARITY FAILED');
process.exit(ok ? 0 : 1);
