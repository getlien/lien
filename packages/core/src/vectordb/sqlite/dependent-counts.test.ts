import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { openDatabase, STORE_META, setStoreMeta } from './schema.js';
import {
  readDependentCounts,
  writeDependentCounts,
  getDependentCounts,
  refreshDependentCounts,
  hasComputedDependentCounts,
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

/**
 * #1072: "an older index that never computed counts" and "a corpus whose counts
 * are all legitimately 0" produce byte-identical tables. Only stored state can
 * tell them apart, which is what the flag is for — and getting this wrong in
 * either direction is a shipped defect (#1071's silent zeros one way, #1014's
 * trained-out false caveat the other).
 */
describe('hasComputedDependentCounts', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-depcounts-flag-'));
    db = openDatabase(path.join(tmpDir, 'structural.db'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('is false on a fresh store that has never had counts written', () => {
    expect(hasComputedDependentCounts(db)).toBe(false);
  });

  it('is true after a write that stored rows', () => {
    writeDependentCounts(db, new Map([['src/a.ts', 2]]));
    expect(hasComputedDependentCounts(db)).toBe(true);
  });

  it('is TRUE after a write whose every count was legitimately 0 — the load-bearing case', () => {
    // A Swift-only corpus: whole-module imports name no file, so nothing
    // resolves and the table stays empty. Row presence alone would call this
    // "never computed" and hedge a correct, freshly-indexed answer.
    writeDependentCounts(db, new Map([['Sources/A.swift', 0]]));

    expect(readDependentCounts(db).size).toBe(0);
    expect(hasComputedDependentCounts(db)).toBe(true);
  });

  it('is true for a table with rows but no flag (an index written between #1071 and #1072)', () => {
    // Simulate that vintage: rows written by the #1071-era writer, which had no
    // flag to set. Rows can only come from a real computation, so they are
    // sufficient proof on their own.
    db.prepare('INSERT INTO dependent_counts(file, count) VALUES (?, ?)').run('src/a.ts', 4);
    expect(hasComputedDependentCounts(db)).toBe(true);
  });

  it('survives a rewrite to an all-zero corpus without regressing to false', () => {
    writeDependentCounts(db, new Map([['src/a.ts', 2]]));
    writeDependentCounts(db, new Map([['src/a.ts', 0]]));

    expect(readDependentCounts(db).size).toBe(0);
    expect(hasComputedDependentCounts(db)).toBe(true);
  });

  it('reads the flag, not just the rows: a flagged empty table is still computed', () => {
    setStoreMeta(db, STORE_META.DEPENDENT_COUNTS_COMPUTED, '1');
    expect(readDependentCounts(db).size).toBe(0);
    expect(hasComputedDependentCounts(db)).toBe(true);
  });
});
