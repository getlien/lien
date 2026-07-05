import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { STRUCTURAL_DB_FILENAME } from '../vectordb/sqlite/schema.js';

/** Lock-contention error codes `BEGIN IMMEDIATE` raises when another process
 *  holds the structural store's write lock past the busy timeout. Mirrors the
 *  busy-skip classifier the overlay rebuild path uses (see #682). */
function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT';
}

/** Short busy timeout for the probe — fail fast rather than block GC on a
 *  peer's in-flight write. */
const PROBE_BUSY_TIMEOUT_MS = 200;

/** Outcome of probing an index's structural store for a live writer. */
export type LockProbeResult =
  | 'unlocked' // BEGIN IMMEDIATE + ROLLBACK succeeded — safe to reclaim
  | 'locked' // SQLITE_BUSY — a live process holds the write lock
  | 'unprobeable'; // any other error — can't tell, so don't risk it

/**
 * Detect whether a live process (a `lien serve`, watcher, or concurrent index)
 * currently holds the index's structural store open for writing, so GC can skip
 * it and never delete a store out from under an active process.
 *
 * Follows the #682 busy-skip philosophy: open a *writable* connection with a
 * short busy timeout and attempt `BEGIN IMMEDIATE` (the write-lock acquisition).
 * A `SQLITE_BUSY` means a peer holds the lock. Deletion safety fails CLOSED:
 * any OTHER error (permission denied, read-only filesystem, corrupt db) is
 * 'unprobeable' rather than 'unlocked' — GC must not delete a store it
 * couldn't actually verify is free.
 *
 * @param indexDir - Path to the index directory
 * @returns the probe outcome; only 'unlocked' clears the index for GC
 */
export function probeIndexLock(indexDir: string): LockProbeResult {
  const dbFilePath = path.join(indexDir, STRUCTURAL_DB_FILENAME);

  // No structural store (e.g. a legacy lance-only dir) → nothing holds it.
  if (!fs.existsSync(dbFilePath)) return 'unlocked';

  let db: Database.Database | undefined;
  try {
    db = new Database(dbFilePath);
    db.pragma(`busy_timeout = ${PROBE_BUSY_TIMEOUT_MS}`);
    // BEGIN IMMEDIATE takes the write lock up front; a peer holding it past the
    // busy timeout throws SQLITE_BUSY.
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return 'unlocked';
  } catch (error) {
    if (isSqliteBusy(error)) return 'locked'; // a live process is writing — skip
    return 'unprobeable'; // couldn't open/query it — fail closed, skip
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close failures
    }
  }
}
