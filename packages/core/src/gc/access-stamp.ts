import fs from 'fs/promises';
import path from 'path';

/**
 * Name of the access-stamp file inside an index directory. Its content is an
 * epoch-ms timestamp recording when a `lien serve` last opened this index.
 *
 * This is deliberately distinct from `.lien-index-version` (which tracks the
 * last write / reindex) — the stamp tracks last use so `lien gc --stale` can
 * reclaim indices for repos nobody has served in a while. It is touched on
 * serve start only (a single cheap write), NOT on every query.
 */
export const ACCESS_STAMP_FILE = '.lien-accessed';

/**
 * Record that this index was just accessed (opened by a serve). Best-effort:
 * failures are swallowed since the stamp is a convenience for GC, not critical.
 *
 * @param indexDir - Path to the index directory
 */
export async function writeAccessStamp(indexDir: string): Promise<void> {
  try {
    await fs.mkdir(indexDir, { recursive: true });
    const stampPath = path.join(indexDir, ACCESS_STAMP_FILE);
    await fs.writeFile(stampPath, Date.now().toString(), 'utf-8');
  } catch {
    // Best-effort — a missing access stamp only makes an index look older to
    // `lien gc --stale`, which falls back to other timestamps.
  }
}

/**
 * Read the last-access timestamp from an index directory.
 *
 * @param indexDir - Path to the index directory
 * @returns Epoch-ms timestamp, or null if the stamp is absent/unreadable
 */
export async function readAccessStamp(indexDir: string): Promise<number | null> {
  try {
    const stampPath = path.join(indexDir, ACCESS_STAMP_FILE);
    const content = await fs.readFile(stampPath, 'utf-8');
    const timestamp = parseInt(content.trim(), 10);
    return Number.isNaN(timestamp) ? null : timestamp;
  } catch {
    return null;
  }
}
