import type Database from 'better-sqlite3';
import { parseRow, type SqliteChunkRecord } from './row-mapping.js';
import { DatabaseError } from '../../errors/index.js';

/**
 * Trim + validate a file filter into a list of exact-match paths. Empty or
 * whitespace-only paths throw — matching query.ts buildFileWhereClause.
 */
export function normalizeFileFilter(file: string | string[]): string[] {
  if (typeof file === 'string') {
    const trimmed = file.trim();
    if (trimmed.length === 0) {
      throw new DatabaseError('Invalid file filter: file path must be non-empty');
    }
    return [trimmed];
  }
  const cleaned = file.map(f => f.trim()).filter(f => f.length > 0);
  if (cleaned.length === 0) {
    throw new DatabaseError('Invalid file filter: at least one non-empty file path is required');
  }
  return cleaned;
}

/**
 * Low-level read primitives over a `chunks` table, shared by `SqliteBackend`
 * (single store) and `OverlayBackend` (base + overlay union). Keeping the scan
 * SQL + parse + validate in one place stops the two backends from drifting.
 */

/**
 * A row identity requires a non-empty file and non-empty content. Scan paths
 * drop empty-content rows (content is always a string here — NOT NULL).
 */
export function isValidRecord(r: SqliteChunkRecord): boolean {
  if (!r.file || r.file.length === 0) return false;
  if (r.content.trim().length === 0) return false;
  return true;
}

/** All valid chunk records, ordered by rowid. */
export function readAllRecords(db: Database.Database): SqliteChunkRecord[] {
  const rows = db.prepare('SELECT * FROM chunks ORDER BY id').all() as Record<string, unknown>[];
  return rows.map(parseRow).filter(isValidRecord);
}

/** Valid chunk records whose `file` is in the exact-match list, ordered by rowid. */
export function readRecordsByFiles(db: Database.Database, files: string[]): SqliteChunkRecord[] {
  if (files.length === 0) return [];
  const placeholders = files.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT * FROM chunks WHERE file IN (${placeholders}) ORDER BY id`)
    .all(...files) as Record<string, unknown>[];
  return rows.map(parseRow).filter(isValidRecord);
}

/** Valid chunk records with non-empty content (symbol-query prefilter), by rowid. */
export function readSymbolRecords(db: Database.Database): SqliteChunkRecord[] {
  const rows = db.prepare("SELECT * FROM chunks WHERE content != '' ORDER BY id").all() as Record<
    string,
    unknown
  >[];
  return rows.map(parseRow).filter(isValidRecord);
}

/**
 * Yield pages of valid chunk records via LIMIT/OFFSET iteration, so callers
 * never load the whole table into memory. Stops after the first short page.
 */
export function* paginateRecords(
  db: Database.Database,
  pageSize: number,
): Generator<SqliteChunkRecord[]> {
  if (pageSize <= 0) {
    throw new DatabaseError('pageSize must be a positive number');
  }
  const stmt = db.prepare("SELECT * FROM chunks WHERE file != '' ORDER BY id LIMIT ? OFFSET ?");
  let offset = 0;
  while (true) {
    const rawRows = stmt.all(pageSize, offset) as Record<string, unknown>[];
    if (rawRows.length === 0) break;
    const page = rawRows.map(parseRow).filter(isValidRecord);
    if (page.length > 0) yield page;
    if (rawRows.length < pageSize) break;
    offset += pageSize;
  }
}
