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
 * Deliberately generous (well beyond what a handful of concurrent MCP tool
 * calls needs): measured under a synthetic 10-processes-racing-one-brand-new
 * -file stress test, `SQLITE_IOERR` during the WAL-mode conversion recurred
 * across several retries in a row before settling — a lower budget left a
 * small but real tail of crashes at that concurrency. Total worst-case wait
 * (sum of all backoffs, see `openRetryDelayMs`) stays well under the ~1-2s a
 * full background reindex takes anyway, so this only adds latency to the
 * unlucky first caller hitting a torn-down index, never to steady state.
 */
const OPEN_RETRY_ATTEMPTS = 20;
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
