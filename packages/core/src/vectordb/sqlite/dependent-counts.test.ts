import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { openDatabase } from './schema.js';
import {
  readDependentCounts,
  writeDependentCounts,
  getDependentCounts,
  refreshDependentCounts,
} from './dependent-counts.js';

/**
 * These tests cover the STORAGE half of the dependent-count path. The
 * resolution half moved to `@liendev/parser`'s `computeDependentCountsFromChunks`
 * in #1071 (this file used to test a private relative-only resolver that scored
 * 0 for 100% of files in six languages); its own tests, including the
 * brute-force equivalence property, live in
 * `packages/parser/src/dependent-count-index.test.ts`.
 */

function chunk(file: string, imports: string[] = []): ChunkMetadata {
  return {
    file,
    startLine: 1,
    endLine: 5,
    type: 'function',
    language: 'typescript',
    imports,
  } as ChunkMetadata;
}

describe('dependent_counts storage', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-depcounts-'));
    db = openDatabase(path.join(tmpDir, 'structural.db'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts empty, so every count reads as 0 (the pre-#1071 identity-boost behavior)', () => {
    expect(readDependentCounts(db).size).toBe(0);
  });

  it('round-trips a written map, keyed on the raw file string', () => {
    writeDependentCounts(db, new Map([['src/utils/logger.ts', 3]]));
    // Keyed on the raw path exactly as stored — NOT an extension-stripped or
    // otherwise normalized form. fts-search looks a row up by `record.file`.
    expect(readDependentCounts(db).get('src/utils/logger.ts')).toBe(3);
  });

  it('stores only positive counts, so a zero is the absence of a row', () => {
    writeDependentCounts(
      db,
      new Map([
        ['a.ts', 2],
        ['b.ts', 0],
      ]),
    );
    const counts = readDependentCounts(db);
    expect(counts.get('a.ts')).toBe(2);
    expect(counts.has('b.ts')).toBe(false);
  });

  it('replaces the whole table rather than merging (a count is a corpus-wide property)', () => {
    writeDependentCounts(
      db,
      new Map([
        ['stale.ts', 9],
        ['kept.ts', 1],
      ]),
    );
    writeDependentCounts(db, new Map([['kept.ts', 4]]));
    const counts = readDependentCounts(db);
    expect(counts.has('stale.ts')).toBe(false);
    expect(counts.get('kept.ts')).toBe(4);
  });

  it('caches per connection but invalidates that cache on write', () => {
    writeDependentCounts(db, new Map([['a.ts', 1]]));
    const first = getDependentCounts(db);
    expect(getDependentCounts(db)).toBe(first); // same object — cached, not re-read

    writeDependentCounts(db, new Map([['a.ts', 7]]));
    expect(getDependentCounts(db).get('a.ts')).toBe(7);
  });

  it('refreshDependentCounts resolves a relative import edge end to end', () => {
    const chunks = [
      { content: 'export function log() {}', metadata: chunk('src/utils/logger.ts') },
      { content: 'log()', metadata: chunk('src/a.ts', ['./utils/logger']) },
      { content: 'log()', metadata: chunk('src/b.ts', ['./utils/logger']) },
    ];
    refreshDependentCounts(db, chunks, '/workspace');
    expect(readDependentCounts(db).get('src/utils/logger.ts')).toBe(2);
  });

  it('refreshDependentCounts resolves a NON-RELATIVE specifier — the #1071 regression', () => {
    // A Go package-directory import, in the exact shape the index stores after
    // #867 strips the `go.mod` module prefix. The deleted resolver passed any
    // non-`./`-prefixed specifier through untouched and could then only match a
    // file path that literally EQUALLED it — and no path equals a directory —
    // so every Go file scored 0. `importMatchesTarget` applies Go's real
    // package-directory semantics (#887) instead.
    const goChunk = (file: string, imports: string[] = []) =>
      ({ ...chunk(file, imports), language: 'go' }) as ChunkMetadata;
    const chunks = [
      { content: 'func StringToBytes() {}', metadata: goChunk('internal/bytesconv/bytesconv.go') },
      {
        content: 'bytesconv.StringToBytes()',
        metadata: goChunk('tree.go', ['internal/bytesconv']),
      },
    ];
    refreshDependentCounts(db, chunks, '/workspace');
    expect(readDependentCounts(db).get('internal/bytesconv/bytesconv.go')).toBe(1);
  });
});
