import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChunkMetadata } from '@liendev/parser';
import { SqliteBackend } from './sqlite-backend.js';
import { readVersionFile } from '../version.js';
import { DatabaseError } from '../../errors/index.js';

const DIM = 384;
const zeroVec = () => new Float32Array(DIM);

/** A metadata fixture exercising every persisted field. */
function makeChunk(overrides: Partial<ChunkMetadata> = {}, content = 'function foo() {}') {
  const metadata: ChunkMetadata = {
    file: 'src/foo.ts',
    startLine: 10,
    endLine: 20,
    type: 'function',
    language: 'typescript',
    symbols: { functions: ['foo'], classes: ['Bar'], interfaces: ['IBaz'] },
    symbolName: 'foo',
    symbolType: 'function',
    parentClass: 'Bar',
    complexity: 5,
    cognitiveComplexity: 3,
    parameters: ['a: string', 'b: number'],
    signature: 'foo(a, b)',
    returnType: 'void',
    imports: ['./a', './b'],
    exports: ['foo'],
    importedSymbols: { './a': ['x', 'y'] },
    callSites: [
      { symbol: 'foo', line: 5, isResultCaptured: true },
      { symbol: 'bar', line: 8, isResultCaptured: false },
      { symbol: 'baz', line: 10 },
    ],
    halsteadVolume: 100,
    halsteadDifficulty: 2,
    halsteadEffort: 200,
    halsteadBugs: 0.03,
    ...overrides,
  };
  return { metadata, content };
}

async function insertOne(db: SqliteBackend, metadata: ChunkMetadata, content: string) {
  await db.insertBatch([zeroVec()], [metadata], [content]);
}

describe('SqliteBackend', () => {
  let db: SqliteBackend;
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(
      os.tmpdir(),
      `lien-sqlite-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    await fs.mkdir(projectRoot, { recursive: true });
    db = new SqliteBackend(projectRoot);
    await db.initialize();
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(db.dbPath, { recursive: true, force: true });
  });

  describe('insert -> scan round-trip', () => {
    it('round-trips every metadata field, coercing empties to undefined on read', async () => {
      const { metadata, content } = makeChunk();
      await insertOne(db, metadata, content);

      const results = await db.scanWithFilter({ file: 'src/foo.ts' });
      expect(results).toHaveLength(1);
      const r = results[0];

      expect(r.content).toBe(content);
      expect(r.score).toBe(0);
      expect(r.relevance).toBe('not_relevant');
      expect(r.metadata).toEqual({
        file: 'src/foo.ts',
        startLine: 10,
        endLine: 20,
        type: 'function',
        language: 'typescript',
        symbolName: 'foo',
        symbolType: 'function',
        parentClass: 'Bar',
        complexity: 5,
        cognitiveComplexity: 3,
        parameters: ['a: string', 'b: number'],
        signature: 'foo(a, b)',
        imports: ['./a', './b'],
        halsteadVolume: 100,
        halsteadDifficulty: 2,
        halsteadEffort: 200,
        halsteadBugs: 0.03,
        exports: ['foo'],
        importedSymbols: { './a': ['x', 'y'] },
        callSites: [
          { symbol: 'foo', line: 5, isResultCaptured: true },
          { symbol: 'bar', line: 8, isResultCaptured: false },
          { symbol: 'baz', line: 10 },
        ],
      });
      // returnType is intentionally lossy (not persisted, matching LanceDB).
      expect((r.metadata as ChunkMetadata).returnType).toBeUndefined();
    });

    it('maps empty arrays/objects to undefined on read', async () => {
      const { metadata, content } = makeChunk({
        symbols: { functions: [], classes: [], interfaces: [] },
        parameters: [],
        imports: [],
        exports: [],
        importedSymbols: {},
        callSites: [],
      });
      await insertOne(db, metadata, content);

      const [r] = await db.scanWithFilter({ file: 'src/foo.ts' });
      expect(r.metadata.parameters).toBeUndefined();
      expect(r.metadata.imports).toBeUndefined();
      expect(r.metadata.exports).toBeUndefined();
      expect(r.metadata.importedSymbols).toBeUndefined();
      expect(r.metadata.callSites).toBeUndefined();
    });

    it('drops callSites with non-positive line numbers (missing-data sentinel)', async () => {
      const { metadata, content } = makeChunk({
        callSites: [
          { symbol: 'kept', line: 3 },
          { symbol: 'dropped', line: 0 },
        ],
      });
      await insertOne(db, metadata, content);
      const [r] = await db.scanWithFilter({ file: 'src/foo.ts' });
      expect(r.metadata.callSites).toEqual([{ symbol: 'kept', line: 3 }]);
    });
  });

  describe('scanWithFilter', () => {
    beforeEach(async () => {
      await insertOne(db, makeChunk({ file: 'a.ts', language: 'typescript' }).metadata, 'aaa');
      await insertOne(db, makeChunk({ file: 'b.py', language: 'python' }).metadata, 'bbb');
      await insertOne(db, makeChunk({ file: 'c.ts', language: 'typescript' }).metadata, 'ccc');
    });

    it('filters by exact file (single and IN-list)', async () => {
      expect(await db.scanWithFilter({ file: 'a.ts' })).toHaveLength(1);
      expect(await db.scanWithFilter({ file: ['a.ts', 'c.ts'] })).toHaveLength(2);
    });

    it('filters by language case-insensitively (JS-side)', async () => {
      const r = await db.scanWithFilter({ language: 'TypeScript' });
      expect(r).toHaveLength(2);
    });

    it('filters by pattern against content or file', async () => {
      expect(await db.scanWithFilter({ pattern: 'bbb' })).toHaveLength(1);
      expect(await db.scanWithFilter({ pattern: '\\.py$' })).toHaveLength(1);
    });

    it('applies limit last, after JS filters', async () => {
      const r = await db.scanWithFilter({ language: 'typescript', limit: 1 });
      expect(r).toHaveLength(1);
    });

    it('throws DatabaseError for a whitespace-only filepath', async () => {
      await expect(db.scanWithFilter({ file: '   ' })).rejects.toThrow(DatabaseError);
      await expect(db.scanWithFilter({ file: ['  ', ''] })).rejects.toThrow(DatabaseError);
    });
  });

  describe('scanAll', () => {
    it('returns all chunks with no filters', async () => {
      await insertOne(db, makeChunk({ file: 'a.ts' }).metadata, 'aaa');
      await insertOne(db, makeChunk({ file: 'b.ts' }).metadata, 'bbb');
      expect(await db.scanAll()).toHaveLength(2);
    });

    it('honors language/pattern filters', async () => {
      await insertOne(db, makeChunk({ file: 'a.ts', language: 'typescript' }).metadata, 'aaa');
      await insertOne(db, makeChunk({ file: 'b.py', language: 'python' }).metadata, 'bbb');
      expect(await db.scanAll({ language: 'python' })).toHaveLength(1);
    });
  });

  describe('querySymbols', () => {
    it('returns matching symbols with a legacy symbols object', async () => {
      await insertOne(db, makeChunk({ symbolName: 'parseThing' }).metadata, 'code');
      const results = await db.querySymbols({ pattern: 'parse' });
      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbols).toEqual({
        functions: ['foo'],
        classes: ['Bar'],
        interfaces: ['IBaz'],
      });
    });

    it('matches symbolType function against method too', async () => {
      await insertOne(db, makeChunk({ symbolName: 'm', symbolType: 'method' }).metadata, 'code');
      const results = await db.querySymbols({ symbolType: 'function' });
      expect(results).toHaveLength(1);
    });

    it('excludes empty-content chunks', async () => {
      await insertOne(db, makeChunk({ symbolName: 'ghost' }).metadata, '');
      expect(await db.querySymbols({})).toHaveLength(0);
    });
  });

  describe('deleteByFile', () => {
    it('deletes chunks for an exact file path and no-ops on non-matching paths', async () => {
      await insertOne(db, makeChunk({ file: 'a.ts' }).metadata, 'aaa');
      await insertOne(db, makeChunk({ file: 'b.ts' }).metadata, 'bbb');

      await db.deleteByFile('does/not/exist.ts');
      expect(await db.scanAll()).toHaveLength(2);

      await db.deleteByFile('a.ts');
      const remaining = await db.scanAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].metadata.file).toBe('b.ts');
    });
  });

  describe('updateFile', () => {
    it('replaces a file’s chunks in one transaction and bumps the version file', async () => {
      await insertOne(db, makeChunk({ file: 'a.ts' }).metadata, 'old content');

      await db.updateFile(
        'a.ts',
        [zeroVec()],
        [makeChunk({ file: 'a.ts' }).metadata],
        ['new content'],
      );

      const results = await db.scanWithFilter({ file: 'a.ts' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('new content');

      const version = await readVersionFile(db.dbPath);
      expect(version).toBeGreaterThan(0);
    });
  });

  describe('hasData', () => {
    it('is false when empty, true after a real insert, false for empty-content only', async () => {
      expect(await db.hasData()).toBe(false);

      await insertOne(db, makeChunk().metadata, 'real content');
      expect(await db.hasData()).toBe(true);

      await db.clear();
      await insertOne(db, makeChunk().metadata, '');
      expect(await db.hasData()).toBe(false);
    });
  });

  describe('clear', () => {
    it('empties the store but allows reinsertion', async () => {
      await insertOne(db, makeChunk().metadata, 'content');
      expect(await db.scanAll()).toHaveLength(1);

      await db.clear();
      expect(await db.scanAll()).toHaveLength(0);

      await insertOne(db, makeChunk().metadata, 'content again');
      expect(await db.scanAll()).toHaveLength(1);
    });

    it('leaves the version file intact', async () => {
      await db.updateFile('a.ts', [zeroVec()], [makeChunk({ file: 'a.ts' }).metadata], ['c']);
      const before = await readVersionFile(db.dbPath);
      expect(before).toBeGreaterThan(0);

      await db.clear();
      const after = await readVersionFile(db.dbPath);
      expect(after).toBe(before);
    });
  });

  describe('checkVersion', () => {
    it('detects a newer version once, then throttles for 1 second', async () => {
      // updateFile writes a fresh version file (currentVersion starts at 0).
      await db.updateFile('a.ts', [zeroVec()], [makeChunk({ file: 'a.ts' }).metadata], ['c']);

      expect(await db.checkVersion()).toBe(true); // detects the bump
      expect(await db.checkVersion()).toBe(false); // throttled within 1s
    });
  });

  describe('scanPaginated', () => {
    it('yields pages of the configured size', async () => {
      for (let i = 0; i < 5; i++) {
        await insertOne(db, makeChunk({ file: `f${i}.ts` }).metadata, `content ${i}`);
      }
      const pages: number[] = [];
      for await (const page of db.scanPaginated({ pageSize: 2 })) {
        pages.push(page.length);
      }
      expect(pages).toEqual([2, 2, 1]);
    });

    it('throws for a non-positive pageSize', async () => {
      const gen = db.scanPaginated({ pageSize: 0 });
      await expect(gen.next()).rejects.toThrow(DatabaseError);
    });
  });

  describe('insertBatch edge cases', () => {
    it('is a no-op for an empty batch', async () => {
      await db.insertBatch([], [], []);
      expect(await db.hasData()).toBe(false);
    });

    it('throws when array lengths mismatch', async () => {
      await expect(db.insertBatch([zeroVec()], [], ['c'])).rejects.toThrow(DatabaseError);
    });
  });

  describe('cross-repo stubs', () => {
    it('reports no cross-repo support and returns [] from cross-repo methods', async () => {
      expect(db.supportsCrossRepo).toBe(false);
      expect(await db.searchCrossRepo(zeroVec())).toEqual([]);
      expect(await db.scanCrossRepo({})).toEqual([]);
    });
  });

  describe('version accessors', () => {
    it('returns Unknown before any version and a date after', async () => {
      expect(db.getVersionDate()).toBe('Unknown');
      expect(db.getCurrentVersion()).toBe(0);

      await db.updateFile('a.ts', [zeroVec()], [makeChunk({ file: 'a.ts' }).metadata], ['c']);
      await db.checkVersion(); // bumps in-memory currentVersion from the file
      expect(db.getCurrentVersion()).toBeGreaterThan(0);
      expect(db.getVersionDate()).not.toBe('Unknown');
    });
  });
});
