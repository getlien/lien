// FTS5 lexical index layered on the SAME relational schema the
// better-sqlite3 adapter uses (lib/adapters.mjs) — `chunks` + `chunk_imports`,
// identical columns, identical indices. This is what makes the "hybrid"
// queries in fts5.mjs a single SQL statement: the FTS5 virtual tables JOIN
// straight onto the structural columns (complexity, symbolType, language) and
// the import-graph child table, with no separate store to reconcile.
//
// Two FTS5 virtual tables, both EXTERNAL CONTENT (no duplicated row storage —
// they index `chunks` in place via content_rowid):
//
//   chunks_fts    Porter-stemmed keyword index over symbolName + content.
//                 The "BM25 ranked keyword search" story. symbolName is a
//                 separate column (not concatenated into content) so a match
//                 on the symbol's own name can be weighted higher via
//                 bm25(chunks_fts, symbolWeight, contentWeight).
//
//   chunks_symtri Trigram-tokenized index over symbolName only. Substring
//                 search ("find symbols containing X") without a full-table
//                 scan + regex — the indexed upgrade for list_functions.
//
// Porter/unicode61 tokenizes on non-alphanumeric boundaries only — it does
// NOT split camelCase/PascalCase, so a keyword search for "parse" will not
// match a symbol named `parseImportStatement` via the symbolName column
// (the whole identifier is one token). It works for content because real
// source text has whitespace-separated words in comments/strings/statements.
// See FTS5-SEARCH.md for where this bites in practice.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALL_STORE_COLUMNS, NUMERIC_COLUMNS, chunkToRow } from './shared.mjs';

/** Build a fresh FTS5-augmented structural DB from the corpus. Returns an open (read-write) Database. */
export function buildFts5Database(corpus, dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  const columnDDL = ALL_STORE_COLUMNS.map(c =>
    NUMERIC_COLUMNS.has(c) ? `${c} REAL` : `${c} TEXT`,
  ).join(', ');
  db.exec(`CREATE TABLE chunks (id INTEGER PRIMARY KEY, ${columnDDL});`);
  db.exec(`CREATE TABLE chunk_imports (chunk_id INTEGER, import_path TEXT);`);

  const cols = ALL_STORE_COLUMNS;
  const insert = db.prepare(
    `INSERT INTO chunks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  );
  const insertImp = db.prepare('INSERT INTO chunk_imports (chunk_id, import_path) VALUES (?, ?)');
  const tx = db.transaction(rows => {
    rows.forEach(row => {
      const info = insert.run(cols.map(c => row[c]));
      const chunkId = Number(info.lastInsertRowid);
      for (const imp of JSON.parse(row.imports)) insertImp.run(chunkId, imp);
      for (const p of Object.keys(JSON.parse(row.importedSymbols))) insertImp.run(chunkId, p);
    });
  });
  tx(corpus.map(chunkToRow));

  db.exec('CREATE INDEX idx_chunks_file ON chunks(file);');
  db.exec('CREATE INDEX idx_chunks_symboltype ON chunks(symbolType);');
  db.exec('CREATE INDEX idx_chunks_complexity ON chunks(complexity);');
  db.exec('CREATE INDEX idx_import_path ON chunk_imports(import_path);');
  // Composite index in the JOIN direction the hybrid queries actually walk
  // (FTS match -> chunk -> its imports, filtered by import_path). Without
  // this, SQLite's only option is the import_path-only index, which turns a
  // "per-matched-chunk lookup" into a full re-scan of every chunk sharing
  // that import path for EACH FTS match — ~4.4s/query on this corpus
  // instead of ~2ms. Real finding, not a hypothetical: caught by EXPLAIN
  // QUERY PLAN while building this spike.
  db.exec('CREATE INDEX idx_chunk_imports_chunk_id ON chunk_imports(chunk_id, import_path);');

  // --- Keyword/BM25 index: porter-stemmed, symbolName + content. ---
  db.exec(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      symbolName,
      content,
      content='chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    );
  `);
  db.exec(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');`);

  // --- Symbol substring index: trigram, symbolName only (case-insensitive by default). ---
  db.exec(`
    CREATE VIRTUAL TABLE chunks_symtri USING fts5(
      symbolName,
      content='chunks',
      content_rowid='id',
      tokenize='trigram'
    );
  `);
  db.exec(`INSERT INTO chunks_symtri(chunks_symtri) VALUES('rebuild');`);

  return db;
}

export function openFts5Database(dbPath, opts = {}) {
  return new Database(dbPath, opts);
}

/**
 * Build an FTS5 MATCH expression that OR-joins whitespace-separated query
 * words. Plain FTS5 bareword-list syntax is an implicit AND, which is too
 * strict for natural-language-ish queries against short code chunks (zero
 * hits if not every word appears in the SAME chunk); OR + BM25 ranking lets
 * partial matches surface but still rank multi-term matches highest.
 */
export function orQuery(text) {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w.replace(/"/g, '""')}"`);
  return words.join(' OR ');
}

/** Keyword search: BM25-ranked, porter-stemmed, over symbolName + content. */
export function keywordSearch(db, queryText, { limit = 5, symbolWeight = 4.0, contentWeight = 1.0 } = {}) {
  return db
    .prepare(
      `SELECT c.file, c.startLine, c.endLine, c.symbolName, c.symbolType, c.language,
              bm25(chunks_fts, ?, ?) AS rank
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(symbolWeight, contentWeight, orQuery(queryText), limit);
}

/** Symbol substring search: trigram-indexed, no full scan. */
export function symbolSubstringSearch(db, pattern, { limit = 5 } = {}) {
  return db
    .prepare(
      `SELECT c.file, c.startLine, c.endLine, c.symbolName, c.symbolType, c.language
       FROM chunks_symtri t
       JOIN chunks c ON c.id = t.rowid
       WHERE t.symbolName MATCH ?
       ORDER BY c.file
       LIMIT ?`,
    )
    .all(pattern, limit);
}
