import type Database from 'better-sqlite3';
import { openDatabase } from './schema.js';

/** File name of the overlay's structural store (same layout as a standalone
 *  index — the overlay reuses the exact `chunks` + `chunks_fts` schema). */
export { STRUCTURAL_DB_FILENAME } from './schema.js';

/** overlay_meta keys. */
export const OVERLAY_META = {
  /** Absolute path of the base index dir this overlay was diffed against. */
  BASE_INDEX_DIR: 'baseIndexDir',
  /** Base `.lien-index-version` value captured at overlay build time. */
  BASE_STAMP: 'baseStamp',
  /** Base index format version captured at overlay build time. */
  BASE_FORMAT_VERSION: 'baseFormatVersion',
} as const;

/**
 * Overlay-only tables, layered on top of the standard chunks schema:
 *  - `overlay_mask`: base file paths (relative, forward-slash) suppressed from
 *    base reads — the modified-in-worktree and deleted-in-worktree files.
 *  - `overlay_meta`: single-key/value rows recording which base build this
 *    overlay was diffed against (for staleness detection on serve start).
 *
 * Both are inert in a standalone index, so sharing `structural.db` is safe.
 */
const OVERLAY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS overlay_mask (
  file TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS overlay_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

/**
 * Open (creating if needed) the overlay's structural store: the standard
 * `chunks` + `chunks_fts` schema plus the overlay mask/meta tables.
 */
export function openOverlayDatabase(dbFilePath: string): Database.Database {
  const db = openDatabase(dbFilePath);
  db.exec(OVERLAY_SCHEMA_SQL);
  return db;
}
