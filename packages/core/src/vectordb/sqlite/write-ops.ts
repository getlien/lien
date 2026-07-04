import type Database from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { CHUNK_COLUMNS } from './schema.js';
import { chunkToRow } from './row-mapping.js';
import { DatabaseError } from '../../errors/index.js';

/** Assert metadatas/contents arrays are the same length before a batch write. */
export function validateBatchLengths(metadatas: ChunkMetadata[], contents: string[]): void {
  if (metadatas.length !== contents.length) {
    throw new DatabaseError('Metadatas and contents arrays must have the same length', {
      metadatasLength: metadatas.length,
      contentsLength: contents.length,
    });
  }
}

/**
 * Low-level write primitives over a `chunks` table, shared by `SqliteBackend`
 * and `OverlayBackend`. The external-content FTS5 table stays in sync via the
 * schema's triggers, so callers never touch `chunks_fts` directly.
 */

/** `INSERT INTO chunks (...) VALUES (@...)` bound to CHUNK_COLUMNS order. */
export const INSERT_SQL = `INSERT INTO chunks (${CHUNK_COLUMNS.join(', ')}) VALUES (${CHUNK_COLUMNS.map(
  c => '@' + c,
).join(', ')})`;

/** Insert a batch of chunks in a single transaction. Empty batch is a no-op. */
export function insertChunks(
  db: Database.Database,
  metadatas: ChunkMetadata[],
  contents: string[],
): void {
  if (metadatas.length === 0) return;
  const insert = db.prepare(INSERT_SQL);
  const insertAll = db.transaction((rows: ReturnType<typeof chunkToRow>[]) => {
    for (const row of rows) insert.run(row);
  });
  insertAll(metadatas.map((metadata, i) => chunkToRow(contents[i], metadata)));
}

/** Replace all chunks for one file (delete + insert) in a single transaction. */
export function replaceFileChunks(
  db: Database.Database,
  filepath: string,
  metadatas: ChunkMetadata[],
  contents: string[],
): void {
  const del = db.prepare('DELETE FROM chunks WHERE file = ?');
  const insert = db.prepare(INSERT_SQL);
  const apply = db.transaction((rows: ReturnType<typeof chunkToRow>[]) => {
    del.run(filepath);
    for (const row of rows) insert.run(row);
  });
  apply(metadatas.map((metadata, i) => chunkToRow(contents[i], metadata)));
}

/** Delete all chunks for one file. FTS stays in sync via the AFTER DELETE trigger. */
export function deleteFileChunks(db: Database.Database, filepath: string): void {
  db.prepare('DELETE FROM chunks WHERE file = ?').run(filepath);
}
