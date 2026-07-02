// Shared helpers for the structural-store benchmark.
//
// Everything backend-agnostic lives here so each adapter differs ONLY in the
// storage layer, never in the query logic layered on top. The import-graph
// seed and test-association passes are faithful copies of the production code
// paths (packages/cli/src/mcp/handlers/dependency-analyzer.ts and
// packages/parser/src/test-associations.ts) — identical JS run over every
// backend's scan output, so they add a constant, not a bias.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '@liendev/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Import a @liendev/core internal module by absolute file URL. This bypasses
// core's restrictive `exports` map AND its barrel (which drags in the
// transformers embeddings stack, irrelevant to a structural-only benchmark).
export async function importCore(rel) {
  const coreDist = path.dirname(require.resolve('@liendev/core'));
  return import(pathToFileURL(path.join(coreDist, rel)).href);
}
export const ROOT = path.join(__dirname, '..');
export const CORPUS_PATH = path.join(ROOT, 'corpus.json');
export const DATA_DIR = path.join(ROOT, '.data');
export const EMBEDDING_DIMENSION = 384; // all-MiniLM-L6-v2, matches @liendev/core

// ---------------------------------------------------------------------------
// Column projection lists (verbatim from cli/src/mcp/handlers/columns.ts and
// core/src/insights/complexity-analyzer.ts). These drive what each consumer
// reads, so honoring them per-backend keeps payloads identical to production.
// ---------------------------------------------------------------------------
const BASE = ['file', 'startLine', 'endLine'];

export const DEPENDENCY_GRAPH_COLUMNS = [
  ...BASE,
  'language',
  'symbolName',
  'symbolType',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'callSiteSymbols',
  'callSiteLines',
  'callSiteCaptured',
  'content',
];

export const TEST_ASSOCIATIONS_COLUMNS = [...BASE, 'imports'];

export const FILE_CONTEXT_COLUMNS = [
  ...BASE,
  'content',
  'language',
  'type',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'parameters',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
  'callSiteSymbols',
  'callSiteLines',
  'callSiteCaptured',
  'functionNames',
  'classNames',
  'interfaceNames',
];

export const LIST_FUNCTIONS_COLUMNS = [
  ...BASE,
  'content',
  'language',
  'type',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'parameters',
  'exports',
  'functionNames',
  'classNames',
  'interfaceNames',
];

export const COMPLEXITY_ANALYZER_COLUMNS = [
  'file',
  'startLine',
  'endLine',
  'language',
  'symbolName',
  'symbolType',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'imports',
  'importedSymbolPaths',
  'importedSymbolNames',
  'exports',
  'repoId',
];

// ---------------------------------------------------------------------------
// Canonical relational column set for the SQL backends. The parallel-array /
// sentinel serialization that LanceDB forces (batch-insert.ts) disappears
// here: arrays and the two hand-serialized maps become JSON text columns.
// ---------------------------------------------------------------------------
export const SCALAR_COLUMNS = [
  'file',
  'startLine',
  'endLine',
  'type',
  'language',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'content',
];
export const NUMERIC_COLUMNS = new Set([
  'startLine',
  'endLine',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
]);
// Stored as JSON text; keyed by the ChunkMetadata field name.
export const JSON_COLUMNS = [
  'functionNames',
  'classNames',
  'interfaceNames',
  'parameters',
  'imports',
  'exports',
  'importedSymbols',
  'callSites',
];

export const ALL_STORE_COLUMNS = [...SCALAR_COLUMNS, ...JSON_COLUMNS];

// The projection lists above use LanceDB's parallel-array column names
// (importedSymbolPaths/Names, callSiteSymbols/Lines/Captured). Map those to the
// relational JSON columns so a projection request selects the right SQL cols.
const PROJECTION_TO_STORE = {
  importedSymbolPaths: 'importedSymbols',
  importedSymbolNames: 'importedSymbols',
  callSiteSymbols: 'callSites',
  callSiteLines: 'callSites',
  callSiteCaptured: 'callSites',
  repoId: null, // not stored (single-repo); consumers fall back to 'unknown'
  vector: null,
};

/** Translate a consumer's projection list into the relational columns to SELECT. */
export function projectionToStoreColumns(columns) {
  if (!columns) return ALL_STORE_COLUMNS;
  const out = new Set(['file']); // always required to identify a row
  for (const c of columns) {
    if (c in PROJECTION_TO_STORE) {
      const mapped = PROJECTION_TO_STORE[c];
      if (mapped) out.add(mapped);
    } else if (ALL_STORE_COLUMNS.includes(c)) {
      out.add(c);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Row <-> ChunkMetadata mapping.
// ---------------------------------------------------------------------------

/** CodeChunk (corpus) -> a flat relational row (JSON cols pre-stringified). */
export function chunkToRow(chunk) {
  const m = chunk.metadata;
  return {
    file: m.file,
    startLine: m.startLine ?? 0,
    endLine: m.endLine ?? 0,
    type: m.type ?? '',
    language: m.language ?? '',
    symbolName: m.symbolName ?? '',
    symbolType: m.symbolType ?? '',
    parentClass: m.parentClass ?? '',
    signature: m.signature ?? '',
    complexity: m.complexity ?? 0,
    cognitiveComplexity: m.cognitiveComplexity ?? 0,
    halsteadVolume: m.halsteadVolume ?? 0,
    halsteadDifficulty: m.halsteadDifficulty ?? 0,
    halsteadEffort: m.halsteadEffort ?? 0,
    halsteadBugs: m.halsteadBugs ?? 0,
    content: chunk.content ?? '',
    functionNames: JSON.stringify(m.symbols?.functions ?? []),
    classNames: JSON.stringify(m.symbols?.classes ?? []),
    interfaceNames: JSON.stringify(m.symbols?.interfaces ?? []),
    parameters: JSON.stringify(m.parameters ?? []),
    imports: JSON.stringify(m.imports ?? []),
    exports: JSON.stringify(m.exports ?? []),
    importedSymbols: JSON.stringify(m.importedSymbols ?? {}),
    callSites: JSON.stringify(m.callSites ?? []),
  };
}

const parseJson = (v, fallback) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') return v; // already parsed (e.g. DuckDB native)
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

/** Relational row -> SearchResult ({ content, metadata, score, relevance }). */
export function rowToSearchResult(row) {
  const metadata = {
    file: row.file,
    startLine: row.startLine,
    endLine: row.endLine,
    type: row.type || undefined,
    language: row.language,
    symbolName: row.symbolName || undefined,
    symbolType: row.symbolType || undefined,
    parentClass: row.parentClass || undefined,
    signature: row.signature || undefined,
    complexity: row.complexity ?? undefined,
    cognitiveComplexity: row.cognitiveComplexity ?? undefined,
    halsteadVolume: row.halsteadVolume ?? undefined,
    halsteadDifficulty: row.halsteadDifficulty ?? undefined,
    halsteadEffort: row.halsteadEffort ?? undefined,
    halsteadBugs: row.halsteadBugs ?? undefined,
  };
  if (
    row.functionNames !== undefined ||
    row.classNames !== undefined ||
    row.interfaceNames !== undefined
  ) {
    metadata.symbols = {
      functions: parseJson(row.functionNames, []),
      classes: parseJson(row.classNames, []),
      interfaces: parseJson(row.interfaceNames, []),
    };
  }
  if (row.parameters !== undefined) metadata.parameters = parseJson(row.parameters, []);
  if (row.imports !== undefined) metadata.imports = parseJson(row.imports, []);
  if (row.exports !== undefined) metadata.exports = parseJson(row.exports, []);
  if (row.importedSymbols !== undefined)
    metadata.importedSymbols = parseJson(row.importedSymbols, {});
  if (row.callSites !== undefined) metadata.callSites = parseJson(row.callSites, []);
  return {
    content: row.content ?? '',
    metadata,
    score: 0,
    relevance: 'not_relevant',
  };
}

// ---------------------------------------------------------------------------
// Corpus + query-input loading.
// ---------------------------------------------------------------------------
export function loadCorpus() {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
}

/** SYMBOL_TYPE_MATCHES from core/vectordb/types.ts. */
export const SYMBOL_TYPE_MATCHES = {
  function: new Set(['function', 'method']),
  method: new Set(['method']),
  class: new Set(['class']),
  interface: new Set(['interface']),
};

// ---------------------------------------------------------------------------
// Faithful import-graph seed (mirrors dependency-analyzer.ts scanAllChunks +
// findDependentChunks). Pure JS over a SearchResult[] — identical per backend.
// ---------------------------------------------------------------------------
export function makePathNormalizer(workspaceRoot) {
  const cache = new Map();
  return p => {
    let v = cache.get(p);
    if (v === undefined) {
      v = normalizePath(p, workspaceRoot);
      cache.set(p, v);
    }
    return v;
  };
}

export function buildImportIndex(chunks, norm) {
  const importIndex = new Map();
  for (const chunk of chunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const key = norm(imp);
      let arr = importIndex.get(key);
      if (!arr) importIndex.set(key, (arr = []));
      arr.push(chunk);
    }
    const importedSymbols = chunk.metadata.importedSymbols;
    if (importedSymbols && typeof importedSymbols === 'object') {
      for (const modulePath of Object.keys(importedSymbols)) {
        const key = norm(modulePath);
        let arr = importIndex.get(key);
        if (!arr) importIndex.set(key, (arr = []));
        arr.push(chunk);
      }
    }
  }
  return importIndex;
}

export function findDependentChunks(importIndex, normalizedTarget) {
  const out = [];
  const seen = new Set();
  const add = chunk => {
    const id = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seen.has(id)) {
      out.push(chunk);
      seen.add(id);
    }
  };
  if (importIndex.has(normalizedTarget)) {
    for (const c of importIndex.get(normalizedTarget)) add(c);
  }
  for (const [key, chunks] of importIndex.entries()) {
    if (key !== normalizedTarget && matchesFile(key, normalizedTarget)) {
      for (const c of chunks) add(c);
    }
  }
  return out;
}

export { normalizePath, matchesFile, getCanonicalPath, isTestFile };

// ---------------------------------------------------------------------------
// Timing / statistics.
// ---------------------------------------------------------------------------
export function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

export async function timeIterations(fn, iterations, warmup = 5) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    await fn(i);
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return {
    n: iterations,
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    p99: round(percentile(samples, 99)),
    min: round(samples[0]),
    max: round(samples[samples.length - 1]),
    mean: round(samples.reduce((a, b) => a + b, 0) / samples.length),
  };
}

export const round = n => Math.round(n * 100) / 100;

/**
 * Peak resident set size for this process, in MB. Node's
 * `process.resourceUsage().maxRSS` is a high-water mark reported in KILOBYTES
 * (verified on this darwin build: maxRSS*1024 == process.memoryUsage().rss),
 * so it captures the whole-session peak automatically.
 */
export function peakRssMB() {
  return round(process.resourceUsage().maxRSS / 1024);
}
