import { readFileSync } from 'node:fs';
import { findTestAssociationsFromChunks } from '@liendev/parser';
import {
  makePathNormalizer,
  buildImportIndex,
  findDependentChunks,
  importCore,
  DEPENDENCY_GRAPH_COLUMNS,
  TEST_ASSOCIATIONS_COLUMNS,
  FILE_CONTEXT_COLUMNS,
  LIST_FUNCTIONS_COLUMNS,
} from './lib/shared.mjs';
import { makeAdapter } from './lib/adapters.mjs';

const { ComplexityAnalyzer } = await importCore('insights/complexity-analyzer.js');
const backend = process.argv[2] || 'better-sqlite3';
const inputs = JSON.parse(readFileSync('./query-inputs.json', 'utf8'));
const a = await makeAdapter(backend);
await a.open();
const time = async (label, fn) => {
  const t = process.hrtime.bigint();
  const r = await fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(label.padEnd(24), ms.toFixed(1) + 'ms', '\t', r);
};
await time(
  'point-lookup',
  async () =>
    (
      await a.scanWithFilter({
        file: [inputs.filesContextTargets[0]],
        columns: FILE_CONTEXT_COLUMNS,
        limit: 100,
      })
    ).length + ' chunks',
);
await time(
  'list_functions',
  async () =>
    (await a.querySymbols({ pattern: 'handle', columns: LIST_FUNCTIONS_COLUMNS, limit: 51 }))
      .length + ' results',
);
await time(
  'scanAll(dep cols)',
  async () => (await a.scanAll({ columns: DEPENDENCY_GRAPH_COLUMNS })).length + ' rows',
);
await time('get_dependents(full)', async () => {
  const norm = makePathNormalizer(inputs.workspaceRoot);
  const c = await a.scanAll({ columns: DEPENDENCY_GRAPH_COLUMNS });
  const ii = buildImportIndex(c, norm);
  return findDependentChunks(ii, norm(inputs.dependentsTargets[0])).length + ' deps';
});
await time('testAssoc(full)', async () => {
  const c = await a.scanAll({ columns: TEST_ASSOCIATIONS_COLUMNS });
  return (
    findTestAssociationsFromChunks(inputs.testAssocTargets, c, inputs.workspaceRoot).size +
    ' mapped'
  );
});
await time('get_complexity(analyze)', async () => {
  const an = new ComplexityAnalyzer(a);
  return (await an.analyze()).summary.filesAnalyzed + ' files';
});
if (a.dependentsSeedIndexed)
  await time(
    'dep-seed-INDEXED',
    async () => (await a.dependentsSeedIndexed('types')).length + ' files',
  );
await a.close();
