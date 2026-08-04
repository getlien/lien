import type Database from 'better-sqlite3';
import { computeDependentCountsFromChunks } from '@liendev/parser';
import type { CodeChunk } from '@liendev/parser';

/**
 * Per-file "how many other files import this file" counts — the structural
 * signal feeding fts-search.ts's ranking boost and the `dependentCount` field
 * on `search_code` results.
 *
 * ## What changed in #1071, and why
 *
 * This module used to CONTAIN a third, private dependency resolver: ~40 lines
 * that resolved only `./foo` and `../bar` specifiers against the importer's
 * directory and otherwise compared a raw specifier string to a file path for
 * literal equality. Two consequences, both measured:
 *
 * - Every language whose imports are dotted namespaces or module URLs (C#,
 *   Java, Kotlin, Swift, Go, Rust) scored `0` for 100% of its files, so
 *   `applyStructuralBoost(ratio, 0)` was the exact identity function there —
 *   the ranking feature did nothing at all on six of eight measured languages.
 * - Its extension-stripping normalizer treated the final dotted segment of a
 *   specifier as a file extension, so `org.junit.Test` became `org.junit` and
 *   `Serilog.Core.Enrichers` became `Serilog.Core`. Even the literal-equality
 *   path was comparing corrupted strings.
 *
 * Neither the resolver nor the normalizer survives. Resolution now happens in
 * `@liendev/parser`'s `computeDependentCountsFromChunks`, which makes the same
 * guarded `importMatchesTarget` decision `findDependents`/`get_dependents`
 * make — one resolution dialect, not three.
 *
 * ## Why the counts are now stored, not computed on read
 *
 * The old resolver was cheap *because* it was wrong (one linear pass over
 * import strings), so it could be computed lazily on first search and cached
 * per connection. A correct resolver is not that cheap: measured at ~120 ms for
 * an 11k-chunk corpus and ~1.8 s for a 53k-chunk one. Paying that on the first
 * search after every reconnect would move real work into the query path.
 *
 * So the counts are precomputed at index time into the `dependent_counts`
 * table (see schema.ts) and the query path does a single `SELECT`, cached per
 * connection. The read cost is O(files with at least one dependent), and the
 * cache self-invalidates exactly as before: `reconnect()` opens a brand-new
 * `Database` object, and the `WeakMap` is keyed on that object.
 *
 * ## Freshness contract
 *
 * A full index run and an overlay rebuild both refresh the table. A single-file
 * incremental update does NOT — recomputing whole-corpus counts on every
 * watcher-triggered save would be absurd, and this is a soft ranking
 * tie-breaker, not data that needs to be transactionally fresh (the same
 * tradeoff the previous per-connection cache already documented). Counts
 * therefore lag the corpus by at most one full index run.
 *
 * An index written before this table existed simply has no rows, so every count
 * reads as `0` and the boost degrades to the pre-#1071 identity — a silent
 * no-op, never a wrong answer, until the next full index populates it.
 */

/** One row of the `dependent_counts` table. */
interface DependentCountRow {
  file: string;
  count: number;
}

/**
 * Read the stored counts for one connection, keyed on the raw `chunks.file`
 * string so `fts-search.ts` can look a row up with no normalization at all.
 *
 * Files with no dependents are absent (the writer only stores positive counts),
 * so a caller must read a missing key as `0`.
 */
export function readDependentCounts(db: Database.Database): Map<string, number> {
  const rows = db.prepare('SELECT file, count FROM dependent_counts').all() as DependentCountRow[];
  return new Map(rows.map(r => [r.file, r.count]));
}

/**
 * Per-connection cache, keyed on the `better-sqlite3` `Database` object itself.
 * `SqliteBackend.reconnect()` (triggered by the MCP server's `checkAndReconnect`
 * whenever the on-disk version file has bumped — i.e. after any index update)
 * always closes the old handle and opens a brand-new `Database`, so this
 * self-invalidates on every index update with no extra bookkeeping.
 *
 * A caller that refreshes counts on the SAME open connection would otherwise
 * see the stale map until the next reconnect, which is why
 * `writeDependentCounts` below drops the entry explicitly.
 */
const CACHE = new WeakMap<Database.Database, Map<string, number>>();

/** The stored counts for this connection, reading them at most once per handle. */
export function getDependentCounts(db: Database.Database): Map<string, number> {
  const cached = CACHE.get(db);
  if (cached) return cached;
  const counts = readDependentCounts(db);
  CACHE.set(db, counts);
  return counts;
}

/**
 * Replace the whole `dependent_counts` table with `counts`, in one transaction.
 *
 * Whole-table replacement rather than per-file upsert: a count is a property of
 * the entire corpus (removing one file's import can drop another file's count),
 * so there is no correct incremental patch for a subset of files. Only positive
 * counts are stored — a zero is the absence of a row, which keeps the table
 * proportional to the connected part of the graph rather than to the file count.
 *
 * Also clears this connection's cache entry, so a process that writes and then
 * reads on the same handle (the indexer, and every test) sees its own write.
 */
export function writeDependentCounts(db: Database.Database, counts: Map<string, number>): void {
  const insert = db.prepare('INSERT OR REPLACE INTO dependent_counts(file, count) VALUES (?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM dependent_counts');
    for (const [file, count] of counts) {
      if (count > 0) insert.run(file, count);
    }
  })();
  CACHE.delete(db);
}

/**
 * Compute counts over `chunks` and store them on `db`.
 *
 * `chunks` must be the FULL corpus the store serves — for `OverlayBackend` that
 * means the composed `(base − masked) ∪ overlay` set, not the overlay alone.
 * Counting the overlay in isolation would report a near-empty graph for a linked
 * worktree whose files mostly live in the shared base index.
 */
export function refreshDependentCounts(
  db: Database.Database,
  chunks: CodeChunk[],
  workspaceRoot: string,
): void {
  writeDependentCounts(db, computeDependentCountsFromChunks(chunks, workspaceRoot));
}
