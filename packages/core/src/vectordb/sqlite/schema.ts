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
 */
export function openDatabase(dbFilePath: string): Database.Database {
  const db = new Database(dbFilePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  return db;
}
