import Database from 'better-sqlite3';

/** File name of the SQLite structural store inside the index directory. */
export const STRUCTURAL_DB_FILENAME = 'structural.db';

/**
 * Columns of the `chunks` table, in INSERT order. `id` (INTEGER PRIMARY KEY,
 * a rowid alias) is omitted — it's what the external-content FTS5 table
 * references via content_rowid.
 */
export const CHUNK_COLUMNS = [
  'file',
  'startLine',
  'endLine',
  'type',
  'language',
  'symbolName',
  'symbolType',
  'parentClass',
  'signature',
  'symbolTokens',
  'complexity',
  'cognitiveComplexity',
  'halsteadVolume',
  'halsteadDifficulty',
  'halsteadEffort',
  'halsteadBugs',
  'content',
  'functionNames',
  'classNames',
  'interfaceNames',
  'parameters',
  'imports',
  'exports',
  'importedSymbols',
  'callSites',
] as const;

/**
 * DDL for the structural store. startLine/endLine are INTEGER (not REAL — the
 * spike stored line numbers as REAL, which round-trips floats; fixed here).
 * JSON columns store real empties ([]/{}/'') — no Arrow placeholders.
 *
 * `chunks_fts` is an external-content FTS5 table (content='chunks'): it indexes
 * the base table in place without duplicating storage. External-content tables
 * do NOT auto-track base-table writes, so the sync triggers below are mandatory
 * — without them incremental indexing / watcher updates silently drift the
 * index. symbolTokens is an identifier-split copy of symbolName (e.g.
 * 'parseImportStatement' -> 'parse import statement') so a porter/unicode61
 * keyword search for 'parse' matches the symbol; it closes the spike's
 * camelCase tokenizer gap.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL,
  startLine INTEGER,
  endLine INTEGER,
  type TEXT,
  language TEXT,
  symbolName TEXT,
  symbolType TEXT,
  parentClass TEXT,
  signature TEXT,
  symbolTokens TEXT,
  complexity INTEGER,
  cognitiveComplexity INTEGER,
  halsteadVolume REAL,
  halsteadDifficulty REAL,
  halsteadEffort REAL,
  halsteadBugs REAL,
  content TEXT NOT NULL DEFAULT '',
  functionNames TEXT,
  classNames TEXT,
  interfaceNames TEXT,
  parameters TEXT,
  imports TEXT,
  exports TEXT,
  importedSymbols TEXT,
  callSites TEXT
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);

CREATE TABLE IF NOT EXISTS dependent_counts (
  file TEXT PRIMARY KEY,
  count INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS store_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  symbolName, symbolTokens, content,
  content='chunks', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, symbolName, symbolTokens, content)
  VALUES (new.id, new.symbolName, new.symbolTokens, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, symbolName, symbolTokens, content)
  VALUES ('delete', old.id, old.symbolName, old.symbolTokens, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, symbolName, symbolTokens, content)
  VALUES ('delete', old.id, old.symbolName, old.symbolTokens, old.content);
  INSERT INTO chunks_fts(rowid, symbolName, symbolTokens, content)
  VALUES (new.id, new.symbolName, new.symbolTokens, new.content);
END;
`;

/**
 * `dependent_counts` (added #1071) is the one non-chunk, non-FTS table: a
 * precomputed per-file reverse-dependency count keyed on the same raw
 * `chunks.file` string, so `fts-search.ts`'s ranking boost is a single indexed
 * `SELECT` rather than a whole-corpus resolution pass on the query path. See
 * dependent-counts.ts's module doc for why the count cannot be computed cheaply
 * enough to stay lazy, and for the freshness contract.
 *
 * `WITHOUT ROWID` because the table is exactly a `file -> count` map and is
 * always read whole; the implicit rowid would be pure overhead.
 *
 * Additive, and `CREATE TABLE IF NOT EXISTS`, so an index written by an older
 * version gains an EMPTY table on next open rather than needing a migration.
 * An empty table reads as "every count is 0", which is precisely the pre-#1071
 * behaviour (the boost degrades to the identity function) — a silent no-op
 * until the next full index populates it, never a wrong answer. That is why no
 * `INDEX_FORMAT_VERSION` bump (and therefore no forced whole-repo reindex) ships
 * with this change.
 *
 * That empty-table guarantee holds only for connections that actually run this
 * DDL. `OverlayBackend.openBase()` opens the shared base store
 * `{ readonly: true }`, so a pre-#1071 base index keeps NO `dependent_counts`
 * table at all and reading it throws rather than returning nothing — see
 * `OverlayBackend.baseDependentCounts`, which swallows that to an empty map.
 *
 * `store_meta` (added #1072) is the standalone store's counterpart to
 * `overlay_meta`: a one-key/value-row table recording facts ABOUT this store
 * that its data tables cannot express. It exists because the empty-table
 * degradation above is silent in a way that matters to a consumer — an empty
 * `dependent_counts` means either "an older version wrote this index and never
 * computed counts" or "counts were computed and every file genuinely has zero
 * resolved importers", and those two need different answers from
 * `search_code`. The row is written by the same call that writes the counts
 * (`writeDependentCounts`), so presence-of-flag — never table non-emptiness —
 * is what makes a `0` count trustworthy. Same reasoning, and same
 * presence-not-emptiness rule, as `OVERLAY_META.DEPENDENT_COUNTS_COMPOSED`.
 */

/** `store_meta` keys. */
export const STORE_META = {
  /**
   * Set once this store's `dependent_counts` table has actually been written
   * over its corpus (#1072). Its ABSENCE on a store that has chunks means the
   * counts were never computed here, so every `dependentCount` reads 0 for a
   * reason that has nothing to do with the code — which `search_code` reports
   * rather than asserting the zeros as fact.
   */
  DEPENDENT_COUNTS_COMPUTED: 'dependentCountsComputed',
} as const;

/** A `store_meta` key. */
export type StoreMetaKey = (typeof STORE_META)[keyof typeof STORE_META];

/** The value stored at `key`, or `null` when the key was never written. */
export function getStoreMeta(db: Database.Database, key: StoreMetaKey): string | null {
  const row = db.prepare('SELECT v FROM store_meta WHERE k = ?').get(key) as
    | { v: string | null }
    | undefined;
  return row?.v ?? null;
}

/** Write (or overwrite) `key`. */
export function setStoreMeta(db: Database.Database, key: StoreMetaKey, value: string): void {
  db.prepare('INSERT OR REPLACE INTO store_meta(k, v) VALUES (?, ?)').run(key, value);
}

/**
 * Deliberately OMITTED (YAGNI): the spike's `chunk_imports` child table +
 * composite index (dependents-seed optimization no current consumer performs),
 * the `chunks_symtri` trigram table (list_functions keeps its regex path), and
 * indices on symbolType/complexity (no current query is selective on them).
 * Add them when a feature that needs them lands.
 */

/**
 * Open (creating if needed) the structural store and ensure schema exists.
 * busy_timeout lets the MCP server watcher and a concurrent CLI index run
 * both hold write handles without immediate SQLITE_BUSY failures.
 *
 * busy_timeout MUST be the first pragma set on the connection. It only
 * applies to statements issued after it: on a brand-new/just-deleted index
 * file, several `lien serve` processes can race to open + schema-create the
 * same file (e.g. an agent firing multiple MCP tool calls in parallel right
 * after the index was wiped). If `journal_mode`/`synchronous` run first with
 * no busy_timeout yet configured, one loser gets an immediate uncaught
 * `SQLITE_BUSY: database is locked` instead of a bounded wait+retry — which
 * crashes that process before it ever reaches `server.connect()`, and the
 * MCP client sees the whole connection drop (`-32000`), not a tool-level
 * error.
 *
 * busy_timeout alone does NOT close the whole race, though: at higher
 * concurrency (several processes truly creating the file for the first time
 * at once, not just contending for a lock on an existing one), the WAL-mode
 * conversion itself can throw `SQLITE_IOERR`/`SQLITE_CANTOPEN` — a different
 * error class busy_timeout's internal retry does not cover. Callers that open
 * this file from a context where cross-process races are plausible (the MCP
 * server's own connection, a background reindex) MUST wrap the call in
 * `withOpenRetry` below rather than call this directly. See
 * `SqliteBackend.openConnection`/`clear` and `OverlayBackend.initialize`/
 * `reconnect` for the call sites, and schema.test.ts for the reproduction.
 */
export function openDatabase(dbFilePath: string): Database.Database {
  const db = new Database(dbFilePath);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Attempts before `withOpenRetry` gives up on a retryable open failure.
 * Sized against TWO constraints in tension with each other, not just "make
 * the stress test pass":
 *
 * 1. A hard ceiling this MUST fit under: `plugins/claude/hooks/hooks.json`
 *    gives every hook a 5000ms timeout, and several hooks (`annotate-read`,
 *    `augment-explore-task`, `api-delta-write`) invoke a `lien` CLI command
 *    that calls `createVectorDB().initialize()` — i.e. they run through
 *    this exact retry ladder. A ladder whose own worst-case wait approaches
 *    or exceeds 5000ms would get its hook process SIGKILLed mid-retry by
 *    Claude Code, and `lien-npx-breaker.sh` cannot tell that SIGKILL apart
 *    from an unreachable npm registry: it leaves the same stale in-flight
 *    marker either way, tripping `lien-npx-breaker.sh`'s circuit breaker
 *    and silencing ALL nudges for its 300s cooldown.
 * 2. Reliability under real concurrency — a synthetic N-processes-racing-
 *    one-brand-new-file stress test.
 *
 * These trade off against each other, and (1) wins: a ladder long enough to
 * survive 20 racing processes cleanly (~6.2s worst case) cannot fit under a
 * 5000ms hook timeout at all, let alone with headroom, so it isn't an option
 * regardless of reliability. With the constants below, the worst-case (max
 * +30% jitter) summed wait across all `OPEN_RETRY_ATTEMPTS - 1` backoffs
 * computes to 3904ms — leaving real (~1.1s) but not huge headroom under the
 * hook timeout for the actual open work, bash/npx process overhead, and node
 * startup. schema.test.ts asserts this computed ceiling directly (not this
 * comment's claim), so a future constant change that drifts it back toward
 * the hook timeout fails loudly there instead of silently in production.
 *
 * Measured empirically at this budget (repeated trials, disposable foreign
 * repo, index deleted before each run): the ORIGINAL reported bug's exact
 * shape (4 concurrent `lien serve` processes) is fully clean (0 failures
 * across repeated runs). At higher realistic-but-uncommon concurrency (6-10
 * concurrent processes racing the same brand-new file) a SMALL residual
 * remains — roughly 1 in 6-10 trials still hit the crash this PR exists to
 * fix, vs. 0 in dozens of trials at the (hook-timeout-incompatible) ~6.2s
 * budget. This is the real, disclosed tradeoff of fitting under the hook
 * timeout, not an oversight: see the PR discussion for the full measurement
 * and the case for a complementary fix (never `process.exit()` the MCP
 * server on an exhausted retry ladder; degrade to an honest empty answer
 * instead, matching the single-call case) that would close this gap without
 * needing a longer ladder.
 */
const OPEN_RETRY_ATTEMPTS = 16;
/** Backoff unit; see `openRetryDelayMs` for the jittered schedule this drives. */
const OPEN_RETRY_BASE_DELAY_MS = 25;

/**
 * Backoff for retry attempt N (1-indexed): linear growth plus up to ±30%
 * jitter. The jitter matters here specifically — without it, several
 * processes that started racing at nearly the same instant also retry in
 * near-lockstep, so they keep re-colliding on the same schedule instead of
 * spreading out and letting one of them win.
 */
function openRetryDelayMs(attempt: number): number {
  const base = OPEN_RETRY_BASE_DELAY_MS * attempt;
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(base + jitter));
}

/**
 * True for the SQLite error codes multiple processes racing to create/open
 * the SAME database file — most often one that's brand-new or was just
 * deleted — can throw. `busy_timeout` already covers ordinary lock waits on
 * an EXISTING file; these extra codes are the lower-level I/O races specific
 * to concurrent first-time creation, which busy_timeout's built-in retry does
 * not reach.
 */
function isTransientSqliteOpenError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_BUSY_SNAPSHOT' ||
    code === 'SQLITE_LOCKED' ||
    code === 'SQLITE_IOERR' ||
    code === 'SQLITE_CANTOPEN'
  );
}

/**
 * Run `open` — a function that opens/creates a fresh SQLite connection to a
 * file other processes might be racing to open/create at the same moment —
 * retrying with a short backoff on `isTransientSqliteOpenError`. Each retry
 * calls `open` again from scratch (never reuses a handle from a failed
 * attempt: a half-succeeded pragma/exec can leave that `Database` object
 * unusable), so by the time all processes have settled on who created the
 * file, every caller converges on a working connection instead of the first
 * unlucky one crashing its whole process.
 *
 * Non-transient errors (bad path, permissions, disk full) rethrow
 * immediately — this is scoped to the specific "several processes just
 * raced to touch the same file" window, not a general-purpose DB-open retry.
 */
export async function withOpenRetry<T>(open: () => T): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < OPEN_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, openRetryDelayMs(attempt)));
    }
    try {
      return open();
    } catch (error) {
      lastError = error;
      if (!isTransientSqliteOpenError(error)) throw error;
    }
  }
  throw lastError;
}
