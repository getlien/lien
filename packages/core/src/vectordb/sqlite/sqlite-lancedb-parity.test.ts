import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChunkMetadata } from '@liendev/parser';
import type { SearchResult, VectorDBInterface } from '../types.js';
import { SqliteBackend } from './sqlite-backend.js';
import { VectorDB } from '../lancedb.js';

// Consistency (parity) test — the spike's consistency.mjs methodology as a
// cutover golden test: the SAME fixtures inserted into a real LanceDB and a
// SqliteBackend must return identical result COUNTS and (order-insensitively)
// identical (file,startLine,endLine,symbolName) tuples, plus deep-equal
// metadata for a spot-checked chunk (score/relevance are 0/not_relevant on
// both scan paths).

const DIM = 384;
const zeroVec = () => new Float32Array(DIM);

const FIXTURES: Array<{ metadata: ChunkMetadata; content: string }> = [
  {
    metadata: {
      file: 'a.ts',
      startLine: 10,
      endLine: 30,
      type: 'function',
      language: 'typescript',
      symbols: { functions: ['fooHandler'], classes: [], interfaces: [] },
      symbolName: 'fooHandler',
      symbolType: 'function',
      parentClass: 'Service',
      complexity: 7,
      cognitiveComplexity: 4,
      parameters: ['req: Request', 'res: Response'],
      signature: 'fooHandler(req, res)',
      imports: ['./util', './types'],
      exports: ['fooHandler'],
      importedSymbols: { './util': ['helper', 'other'] },
      callSites: [
        { symbol: 'helper', line: 12, isResultCaptured: true },
        { symbol: 'log', line: 15, isResultCaptured: false },
        { symbol: 'noop', line: 18 },
      ],
      halsteadVolume: 120.5,
      halsteadDifficulty: 3,
      halsteadEffort: 361.5,
      halsteadBugs: 0.04,
    },
    content: 'function fooHandler(req, res) { return helper(); }',
  },
  {
    metadata: {
      file: 'b.js',
      startLine: 1,
      endLine: 3,
      type: 'block',
      language: 'javascript',
      symbols: { functions: ['b'], classes: [], interfaces: [] },
    },
    content: 'const b = 1;',
  },
  {
    metadata: {
      file: 'c.ts',
      startLine: 5,
      endLine: 40,
      type: 'class',
      language: 'typescript',
      symbols: { functions: [], classes: ['Widget'], interfaces: [] },
      symbolName: 'Widget',
      symbolType: 'class',
    },
    content: 'class Widget {}',
  },
];

async function seed(db: VectorDBInterface): Promise<void> {
  const vectors = FIXTURES.map(zeroVec);
  const metadatas = FIXTURES.map(f => f.metadata);
  const contents = FIXTURES.map(f => f.content);
  await db.insertBatch(vectors, metadatas, contents);
}

/** Order-insensitive identity tuples for a result set. */
function tuples(results: SearchResult[]): string[] {
  return results
    .map(
      r =>
        `${r.metadata.file}|${r.metadata.startLine}|${r.metadata.endLine}|${r.metadata.symbolName ?? ''}`,
    )
    .sort();
}

describe('SqliteBackend / LanceDB parity', () => {
  let sqlite: SqliteBackend;
  let lance: VectorDB;
  let sqliteRoot: string;
  let lanceRoot: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sqliteRoot = path.join(os.tmpdir(), `lien-parity-sqlite-${stamp}`);
    lanceRoot = path.join(os.tmpdir(), `lien-parity-lance-${stamp}`);
    await fs.mkdir(sqliteRoot, { recursive: true });
    await fs.mkdir(lanceRoot, { recursive: true });

    sqlite = new SqliteBackend(sqliteRoot);
    lance = new VectorDB(lanceRoot);
    await sqlite.initialize();
    await lance.initialize();
    await seed(sqlite);
    await seed(lance);
  });

  afterAll(async () => {
    sqlite.close();
    await Promise.all([
      fs.rm(sqliteRoot, { recursive: true, force: true }),
      fs.rm(lanceRoot, { recursive: true, force: true }),
      fs.rm(sqlite.dbPath, { recursive: true, force: true }),
      fs.rm(lance.dbPath, { recursive: true, force: true }),
    ]);
  });

  it('scanWithFilter({file}) returns identical counts and tuples', async () => {
    const s = await sqlite.scanWithFilter({ file: 'a.ts' });
    const l = await lance.scanWithFilter({ file: 'a.ts' });
    expect(s.length).toBe(l.length);
    expect(tuples(s)).toEqual(tuples(l));
  });

  it('scanAll() returns identical counts and tuples', async () => {
    const s = await sqlite.scanAll();
    const l = await lance.scanAll();
    expect(s.length).toBe(l.length);
    expect(s.length).toBe(FIXTURES.length);
    expect(tuples(s)).toEqual(tuples(l));
  });

  it('querySymbols({pattern}) returns identical counts and tuples', async () => {
    const s = await sqlite.querySymbols({ pattern: 'foo' });
    const l = await lance.querySymbols({ pattern: 'foo' });
    expect(s.length).toBe(l.length);
    expect(tuples(s)).toEqual(tuples(l));
  });

  it('produces deep-equal metadata for a spot-checked chunk', async () => {
    const s = await sqlite.scanWithFilter({ file: 'a.ts' });
    const l = await lance.scanWithFilter({ file: 'a.ts' });
    expect(s).toHaveLength(1);
    expect(l).toHaveLength(1);
    // LanceDB leaks raw Arrow Vectors for the parameters/imports array columns
    // (query.ts buildSearchResultMetadata only converts `exports`). Both are
    // iterable, so normalize array-of-string fields to plain arrays before the
    // deep-equal. score/relevance are 0/not_relevant on both scan paths.
    expect(normalizeMeta(s[0].metadata)).toEqual(normalizeMeta(l[0].metadata));
    expect(s[0].content).toBe(l[0].content);
  });
});

/** Coerce iterable array-of-string metadata fields to plain arrays. */
function normalizeMeta(metadata: ChunkMetadata): ChunkMetadata {
  const out = { ...metadata } as Record<string, unknown>;
  for (const key of ['parameters', 'imports', 'exports'] as const) {
    const value = out[key];
    if (value != null && typeof value !== 'string') {
      out[key] = [...(value as Iterable<string>)];
    }
  }
  return out as ChunkMetadata;
}
