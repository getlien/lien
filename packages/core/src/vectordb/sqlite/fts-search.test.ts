import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChunkMetadata } from '@liendev/parser';
import { SqliteBackend } from './sqlite-backend.js';
import { orQuery } from './fts-search.js';

const DIM = 384;
const zeroVec = () => new Float32Array(DIM);

function chunk(
  file: string,
  content: string,
  extra: Partial<ChunkMetadata> = {},
): { metadata: ChunkMetadata; content: string } {
  return {
    metadata: {
      file,
      startLine: 1,
      endLine: 5,
      type: 'function',
      language: 'typescript',
      ...extra,
    },
    content,
  };
}

async function insert(db: SqliteBackend, c: { metadata: ChunkMetadata; content: string }) {
  await db.insertBatch([zeroVec()], [c.metadata], [c.content]);
}

describe('orQuery', () => {
  it('OR-joins quoted whitespace-split terms and escapes quotes', () => {
    expect(orQuery('parse import statement')).toBe('"parse" OR "import" OR "statement"');
    expect(orQuery('  spaced   out ')).toBe('"spaced" OR "out"');
    expect(orQuery('say "hi"')).toBe('"say" OR """hi"""');
    expect(orQuery('   ')).toBe('');
  });
});

describe('SqliteBackend.search (FTS5)', () => {
  let db: SqliteBackend;
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(
      os.tmpdir(),
      `lien-fts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    await fs.mkdir(projectRoot, { recursive: true });
    db = new SqliteBackend(projectRoot);
    await db.initialize();
  });

  afterEach(async () => {
    db.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(db.dbPath, { recursive: true, force: true });
  });

  it('returns a relevant chunk for a keyword query', async () => {
    await insert(db, chunk('auth.ts', 'handles user authentication and session tokens'));
    await insert(db, chunk('math.ts', 'adds two numbers together'));

    const results = await db.search(zeroVec(), 5, 'authentication');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].metadata.file).toBe('auth.ts');
  });

  it('finds a camelCase symbol via the symbolTokens column', async () => {
    // Content deliberately has no "parse" word — the match must come from
    // symbolTokens ('parse import statement').
    await insert(
      db,
      chunk('imports.ts', 'function x() { return 1; }', {
        symbolName: 'parseImportStatement',
      }),
    );

    const results = await db.search(zeroVec(), 5, 'parse');
    expect(results).toHaveLength(1);
    expect(results[0].metadata.symbolName).toBe('parseImportStatement');
  });

  it('orders by bm25 (best hit first) and the top hit is always highly_relevant', async () => {
    await insert(db, chunk('strong.ts', 'cache cache cache invalidation cache layer'));
    await insert(db, chunk('weak.ts', 'a cache and some unrelated words here'));

    const results = await db.search(zeroVec(), 5, 'cache');
    expect(results[0].metadata.file).toBe('strong.ts');
    expect(results[0].relevance).toBe('highly_relevant');
    expect(results[0].score).toBe(0);
  });

  it('forces highly_relevant when a query term exactly matches symbolName', async () => {
    await insert(db, chunk('flow.ts', 'user login login login flow handler routine'));
    await insert(db, chunk('def.ts', 'x', { symbolName: 'login' }));

    const results = await db.search(zeroVec(), 5, 'login');
    const exact = results.find(r => r.metadata.symbolName === 'login');
    expect(exact?.relevance).toBe('highly_relevant');
  });

  it('returns [] when there is no query text', async () => {
    await insert(db, chunk('a.ts', 'something searchable here'));
    expect(await db.search(zeroVec(), 5, '')).toEqual([]);
    expect(await db.search(zeroVec(), 5, '   ')).toEqual([]);
    expect(await db.search(zeroVec(), 5, undefined)).toEqual([]);
  });

  it('over-fetches internally but trims to the requested limit', async () => {
    for (let i = 0; i < 30; i++) {
      await insert(db, chunk(`f${i}.ts`, `shared token number ${i}`));
    }
    const results = await db.search(zeroVec(), 5, 'shared');
    expect(results).toHaveLength(5);
  });

  it('keeps the FTS index in sync through updateFile (triggers)', async () => {
    await insert(db, chunk('a.ts', 'alpha zzztokenold marker'));
    expect(await db.search(zeroVec(), 5, 'zzztokenold')).toHaveLength(1);

    await db.updateFile(
      'a.ts',
      [zeroVec()],
      [chunk('a.ts', 'beta zzztokennew marker').metadata],
      ['beta zzztokennew marker'],
    );

    expect(await db.search(zeroVec(), 5, 'zzztokenold')).toEqual([]);
    expect(await db.search(zeroVec(), 5, 'zzztokennew')).toHaveLength(1);
  });

  it('keeps the FTS index in sync through deleteByFile (triggers)', async () => {
    await insert(db, chunk('a.ts', 'gone soon uniquetoken'));
    expect(await db.search(zeroVec(), 5, 'uniquetoken')).toHaveLength(1);

    await db.deleteByFile('a.ts');
    expect(await db.search(zeroVec(), 5, 'uniquetoken')).toEqual([]);
  });
});
