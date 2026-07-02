// Deterministically sample query inputs from the corpus so every backend is
// driven with byte-identical inputs. Writes query-inputs.json. Inputs are
// drawn from the BASE (replica-0, unprefixed) files, matching how a real tool
// call names a file that exists in the repo.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCorpus,
  makePathNormalizer,
  buildImportIndex,
  findDependentChunks,
} from './lib/shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'query-inputs.json');

// Deterministic stride sampler.
function sample(arr, count) {
  if (arr.length <= count) return [...arr];
  const step = arr.length / count;
  const out = [];
  for (let i = 0; i < count; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function main() {
  const corpus = loadCorpus();
  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  const norm = makePathNormalizer(workspaceRoot);

  // Base (unprefixed) chunks only — these are the "real" repo files a user
  // would name in a tool call.
  const base = corpus.filter(c => !/^r\d+\//.test(c.metadata.file));

  // --- get_files_context point-lookup targets: distinct source files (skip
  // markdown — real get_files_context is called on code). ~30 files.
  const codeFiles = [
    ...new Set(base.filter(c => c.metadata.language !== 'markdown').map(c => c.metadata.file)),
  ].sort();
  const filesContextTargets = sample(codeFiles, 30);

  // --- get_dependents targets: files that actually have dependents, so the
  // import-graph seed does real work. Rank by dependent count over the base.
  const importIndex = buildImportIndex(base, norm);
  const withDeps = codeFiles
    .map(f => ({ file: f, deps: findDependentChunks(importIndex, norm(f)).length }))
    .filter(x => x.deps > 0)
    .sort((a, b) => b.deps - a.deps);
  const dependentsTargets = sample(withDeps, 20).map(x => x.file);

  // --- list_functions patterns: real symbol-name substrings, anchored where
  // natural. ~12 patterns spanning common shapes.
  const symbolNames = [
    ...new Set(base.map(c => c.metadata.symbolName).filter(s => s && s.length >= 4)),
  ].sort();
  const derived = sample(symbolNames, 8).map(s => s.slice(0, Math.min(6, s.length)));
  const listFunctionsPatterns = [
    ...new Set(['handle', 'Service', 'scan', '^get', '^build', 'Adapter', ...derived]),
  ].slice(0, 14);

  // --- test-association scan targets: source files likely imported by tests.
  const testAssocTargets = sample(codeFiles, 10);

  const out = {
    workspaceRoot,
    totalChunks: corpus.length,
    baseChunks: base.length,
    filesContextTargets,
    dependentsTargets,
    listFunctionsPatterns,
    testAssocTargets,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.error(
    `[query-inputs] filesContext=${filesContextTargets.length} dependents=${dependentsTargets.length} ` +
      `patterns=${listFunctionsPatterns.length} testAssoc=${testAssocTargets.length}`,
  );
  console.error(`[query-inputs] top dependents targets:`, withDeps.slice(0, 3));
  console.error(`[query-inputs] wrote ${OUT}`);
}

main();
