import path from 'path';
import type Database from 'better-sqlite3';

/**
 * Approximate per-file "how many other files import this file" counts — a
 * cheap structural signal feeding fts-search.ts's ranking boost and the
 * `dependentCount` field on search_code results. This is NOT a replacement
 * for get_dependents' authoritative dependency-analyzer.ts analysis.
 *
 * Deliberately simpler than analyzeDependencies: only resolves relative
 * specifiers (`./foo`, `../bar`) against the importer's directory and strips
 * file extensions before matching exact normalized paths — no re-export
 * chain following, no Python-dotted-module / PHP-namespace heuristics, no
 * fuzzy substring boundary matching. Bare package specifiers (npm packages,
 * unresolved workspace packages) pass through unchanged and simply won't
 * match any indexed file, so they never contribute to a count. That's a
 * conservative UNDERcount, never an overcount — the right failure direction
 * for a signal that only ever boosts a ranking, never suppresses one.
 *
 * The upside of the simplification: this is O(total imports) in one linear
 * pass, not O(files × unique imports) — cheap enough to compute once per
 * SQLite connection lifetime (see the cache below) instead of needing
 * index-time precomputation, a schema migration, and a write-path change.
 */

interface ChunkImportRow {
  file: string;
  imports: string | null;
}

/**
 * Normalize a path for matching: forward slashes, trimmed, extension
 * stripped. Applied identically to both the importer and the resolved
 * import target so the two sides compare equal.
 */
export function normalizeFileForCounts(filepath: string): string {
  return filepath
    .replace(/\\/g, '/')
    .trim()
    .replace(/\.[^/.]+$/, '');
}

/**
 * Resolve a `./foo` / `../bar` specifier against the importing file's
 * directory. Bare specifiers (package names, absolute paths, Python dotted
 * modules) pass through unchanged.
 */
function resolveRelativeSpecifier(importerFile: string, specifier: string): string {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  const importerDir = path.posix.dirname(importerFile.replace(/\\/g, '/'));
  return path.posix.normalize(path.posix.join(importerDir, specifier));
}

/** Parse a chunk row's `imports` JSON column into a string array, or `[]`. */
function parseImports(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string' && s !== '')
      : [];
  } catch {
    return [];
  }
}

/** Record one (importer -> target) edge in the reverse index, skipping self-imports. */
function recordEdge(
  reverse: Map<string, Set<string>>,
  importerNormalized: string,
  target: string,
): void {
  if (target === importerNormalized) return; // self-import noise
  let importers = reverse.get(target);
  if (!importers) {
    importers = new Set();
    reverse.set(target, importers);
  }
  importers.add(importerNormalized);
}

/**
 * Build a Map of normalized file path -> number of DISTINCT other files that
 * import it, from raw (file, imports-JSON) rows off the `chunks` table.
 * Every chunk in a file carries the same file-level `imports` array (see
 * ast/chunker.ts's createChunk doc comment), so callers should pass
 * `SELECT DISTINCT file, imports` rows to avoid redundant re-processing —
 * this function is correct either way, just slower on duplicates.
 */
export function computeDependentCounts(rows: ChunkImportRow[]): Map<string, number> {
  const reverse = new Map<string, Set<string>>();

  for (const row of rows) {
    const importerNormalized = normalizeFileForCounts(row.file);
    for (const raw of parseImports(row.imports)) {
      const resolved = resolveRelativeSpecifier(row.file, raw);
      recordEdge(reverse, importerNormalized, normalizeFileForCounts(resolved));
    }
  }

  const counts = new Map<string, number>();
  for (const [target, importers] of reverse) counts.set(target, importers.size);
  return counts;
}

/**
 * Per-connection cache: keyed on the `better-sqlite3` `Database` object
 * itself. `SqliteBackend.reconnect()` (triggered by the MCP server's
 * `checkAndReconnect` whenever the on-disk version file has bumped — i.e.
 * after any full or incremental index update) always closes the old handle
 * and opens a brand new `Database` object, so this self-invalidates on every
 * index update with no extra bookkeeping. A caller that mutates the SAME
 * open connection (e.g. `updateFile`) without ever reconnecting will keep
 * seeing the pre-mutation counts until the next reconnect — acceptable for a
 * soft ranking tie-breaker, not the kind of data that needs to be
 * transactionally fresh.
 */
const CACHE = new WeakMap<Database.Database, Map<string, number>>();

/** Compute (or return the cached) dependent-count map for this connection. */
export function getDependentCounts(db: Database.Database): Map<string, number> {
  const cached = CACHE.get(db);
  if (cached) return cached;

  const rows = db.prepare('SELECT DISTINCT file, imports FROM chunks').all() as ChunkImportRow[];
  const counts = computeDependentCounts(rows);
  CACHE.set(db, counts);
  return counts;
}
