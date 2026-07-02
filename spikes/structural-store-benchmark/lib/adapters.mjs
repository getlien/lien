// Structural-store adapters. Each exposes the SAME minimal surface the five
// Lien consumers actually need — scanAll, scanWithFilter (point lookup by
// file), querySymbols, plus build/open/close and a dbPath for on-disk sizing.
// The LanceDB adapter wraps the REAL @liendev/core VectorDB so the baseline is
// measured exactly as it runs in production today (vectors present, zero-vector
// ANN scans, sentinel-flattened arrays). The SQL adapters store structural
// columns only (no vectors) with arrays/maps as JSON text.

import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  EMBEDDING_DIMENSION,
  SCALAR_COLUMNS,
  NUMERIC_COLUMNS,
  JSON_COLUMNS,
  ALL_STORE_COLUMNS,
  chunkToRow,
  rowToSearchResult,
  projectionToStoreColumns,
  SYMBOL_TYPE_MATCHES,
  importCore,
} from './shared.mjs';

const escapeSql = v => `'${String(v).replace(/'/g, "''")}'`;

// A deterministic pseudo-random vector so the LanceDB baseline stores a real
// 384-dim Float32 payload (identical on-disk vector weight to production);
// values are irrelevant to the structural scans we measure.
function makeVector(seed) {
  const v = new Float32Array(EMBEDDING_DIMENSION);
  let s = seed * 2654435761;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return v;
}

// JS-side symbol filter shared by the SQL querySymbols implementations. Mirrors
// core/vectordb/query.ts matchesSymbolFilter (regex on symbolName + legacy
// arrays; symbolType via SYMBOL_TYPE_MATCHES).
function matchesSymbolFilterJs(sr, { pattern, symbolType }) {
  const m = sr.metadata;
  const legacy = [
    ...(m.symbols?.functions ?? []),
    ...(m.symbols?.classes ?? []),
    ...(m.symbols?.interfaces ?? []),
  ];
  const astName = m.symbolName || '';
  if (legacy.length === 0 && !astName) return false;
  if (pattern) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
    if (re && !(legacy.some(s => re.test(s)) || re.test(astName))) return false;
  }
  if (symbolType) {
    const allowed = SYMBOL_TYPE_MATCHES[symbolType];
    if (m.symbolType) return allowed?.has(m.symbolType) ?? false;
    return legacy.length > 0;
  }
  return true;
}

// ===========================================================================
// LanceDB baseline — wraps the real production VectorDB.
// ===========================================================================
// LanceDB returns array columns as Arrow Vectors. query.ts's
// buildSearchResultMetadata leaves `imports`/`parameters` as raw Vectors
// (downstream production code iterates them with for..of), but the portable
// consumers used here (parser's findTestAssociationsFromChunks .some(), etc.)
// need plain arrays. Converting is a REAL part of LanceDB's deserialization
// cost that the SQL backends don't pay, so we time it inside the adapter.
const toPlain = v => (v && typeof v.toArray === 'function' ? v.toArray() : v);
function normalizeArrowArrays(results) {
  for (const r of results) {
    const m = r.metadata;
    if (m.imports) m.imports = toPlain(m.imports);
    if (m.parameters) m.parameters = toPlain(m.parameters);
    if (m.exports) m.exports = toPlain(m.exports);
    if (m.symbols) {
      m.symbols.functions = toPlain(m.symbols.functions);
      m.symbols.classes = toPlain(m.symbols.classes);
      m.symbols.interfaces = toPlain(m.symbols.interfaces);
    }
  }
  return results;
}

async function makeLanceAdapter() {
  const { VectorDB } = await importCore('vectordb/lancedb.js');
  const projectRoot = path.join(DATA_DIR, 'lancedb-project');
  let db = null;
  const adapter = {
    name: 'lancedb',
    supportsCrossRepo: false,
    dbPath: null,
    async build(chunks) {
      fs.mkdirSync(projectRoot, { recursive: true });
      db = new VectorDB(projectRoot);
      adapter.dbPath = db.dbPath;
      // Clear any prior index at this path for a clean build.
      fs.rmSync(db.dbPath, { recursive: true, force: true });
      await db.initialize();
      const BATCH = 2000;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const vectors = slice.map((_, j) => makeVector(i + j));
        const metadatas = slice.map(c => c.metadata);
        const contents = slice.map(c => c.content);
        await db.insertBatch(vectors, metadatas, contents);
      }
    },
    async open() {
      db = new VectorDB(projectRoot);
      adapter.dbPath = db.dbPath;
      await db.initialize();
    },
    async scanAll(opts = {}) {
      return normalizeArrowArrays(await db.scanAll(opts));
    },
    async scanWithFilter(opts = {}) {
      return normalizeArrowArrays(await db.scanWithFilter(opts));
    },
    async querySymbols(opts = {}) {
      return normalizeArrowArrays(await db.querySymbols(opts));
    },
    async close() {
      db = null;
    },
  };
  return adapter;
}

// ===========================================================================
// better-sqlite3 — synchronous C binding.
// ===========================================================================
async function makeSqliteAdapter() {
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.join(DATA_DIR, 'sqlite', 'chunks.db');
  let db = null;

  const columnDDL = ALL_STORE_COLUMNS.map(c =>
    NUMERIC_COLUMNS.has(c) ? `${c} REAL` : `${c} TEXT`,
  ).join(', ');

  function selectRows(sql, params = []) {
    return db
      .prepare(sql)
      .all(...params)
      .map(rowToSearchResult);
  }

  const adapter = {
    name: 'better-sqlite3',
    supportsCrossRepo: false,
    dbPath,
    async build(chunks) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.exec(`CREATE TABLE chunks (id INTEGER PRIMARY KEY, ${columnDDL});`);
      // Child table for the import-graph seed: turns the O(N) scan into an
      // O(log N) indexed lookup (the headline structural upgrade).
      db.exec(`CREATE TABLE chunk_imports (chunk_id INTEGER, import_path TEXT);`);

      const cols = ALL_STORE_COLUMNS;
      const insert = db.prepare(
        `INSERT INTO chunks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      );
      const insertImp = db.prepare(
        'INSERT INTO chunk_imports (chunk_id, import_path) VALUES (?, ?)',
      );
      const tx = db.transaction(rows => {
        rows.forEach((row, idx) => {
          const info = insert.run(cols.map(c => row[c]));
          const chunkId = Number(info.lastInsertRowid);
          const imps = JSON.parse(row.imports);
          const impSyms = JSON.parse(row.importedSymbols);
          for (const imp of imps) insertImp.run(chunkId, imp);
          for (const p of Object.keys(impSyms)) insertImp.run(chunkId, p);
        });
      });
      tx(chunks.map(chunkToRow));
      db.exec('CREATE INDEX idx_chunks_file ON chunks(file);');
      db.exec('CREATE INDEX idx_chunks_symboltype ON chunks(symbolType);');
      db.exec('CREATE INDEX idx_import_path ON chunk_imports(import_path);');
      db.close();
      db = null;
    },
    async open() {
      db = new Database(dbPath, { readonly: true });
    },
    async scanAll(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      let rows = selectRows(`SELECT ${cols.join(',')} FROM chunks`);
      if (opts.language)
        rows = rows.filter(r => r.metadata.language?.toLowerCase() === opts.language.toLowerCase());
      return rows;
    },
    async scanWithFilter(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      if (opts.file) {
        const files = Array.isArray(opts.file) ? opts.file : [opts.file];
        const placeholders = files.map(() => '?').join(',');
        return selectRows(
          `SELECT ${cols.join(',')} FROM chunks WHERE file IN (${placeholders})`,
          files,
        );
      }
      return this.scanAll(opts);
    },
    async querySymbols(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      const where = ["content != ''"];
      const params = [];
      if (opts.language) {
        where.push('lower(language) = ?');
        params.push(opts.language.toLowerCase());
      }
      if (opts.symbolType) {
        const allowed = [...(SYMBOL_TYPE_MATCHES[opts.symbolType] ?? [])];
        // Push down symbolType (rows may still have empty symbolType and match
        // via legacy arrays, so keep the JS pass authoritative).
        where.push(`(symbolType IN (${allowed.map(() => '?').join(',')}) OR symbolType = '')`);
        params.push(...allowed);
      }
      const sql = `SELECT ${cols.join(',')} FROM chunks WHERE ${where.join(' AND ')}`;
      const rows = selectRows(sql, params).filter(r => matchesSymbolFilterJs(r, opts));
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    },
    // Bonus: indexed import-graph seed (single indexed lookup, no full scan).
    async dependentsSeedIndexed(normalizedTargetLike) {
      const rows = db
        .prepare(
          `SELECT DISTINCT c.file FROM chunk_imports ci JOIN chunks c ON c.id = ci.chunk_id
           WHERE ci.import_path LIKE ?`,
        )
        .all(`%${normalizedTargetLike}%`);
      return rows.map(r => r.file);
    },
    async close() {
      if (db) db.close();
      db = null;
    },
  };
  return adapter;
}

// ===========================================================================
// @libsql/client — Turso's Rust SQLite fork, async-only local file mode.
// ===========================================================================
async function makeLibsqlAdapter() {
  const { createClient } = await import('@libsql/client');
  const dbPath = path.join(DATA_DIR, 'libsql', 'chunks.db');
  let client = null;

  const columnDDL = ALL_STORE_COLUMNS.map(c =>
    NUMERIC_COLUMNS.has(c) ? `${c} REAL` : `${c} TEXT`,
  ).join(', ');

  const adapter = {
    name: 'libsql',
    supportsCrossRepo: false,
    dbPath,
    async build(chunks) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      client = createClient({ url: `file:${dbPath}` });
      await client.execute('PRAGMA journal_mode = WAL');
      await client.execute(`CREATE TABLE chunks (id INTEGER PRIMARY KEY, ${columnDDL})`);
      await client.execute('CREATE TABLE chunk_imports (chunk_id INTEGER, import_path TEXT)');

      const cols = ALL_STORE_COLUMNS;
      const insertSql = `INSERT INTO chunks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      // Batch inserts; libsql batch() runs them in one implicit transaction.
      const BATCH = 1000;
      const rows = chunks.map(chunkToRow);
      let chunkId = 1;
      for (let i = 0; i < rows.length; i += BATCH) {
        const stmts = [];
        for (const row of rows.slice(i, i + BATCH)) {
          stmts.push({ sql: insertSql, args: cols.map(c => row[c]) });
          const imps = JSON.parse(row.imports);
          const impSyms = JSON.parse(row.importedSymbols);
          for (const imp of imps)
            stmts.push({ sql: 'INSERT INTO chunk_imports VALUES (?, ?)', args: [chunkId, imp] });
          for (const p of Object.keys(impSyms))
            stmts.push({ sql: 'INSERT INTO chunk_imports VALUES (?, ?)', args: [chunkId, p] });
          chunkId++;
        }
        await client.batch(stmts, 'write');
      }
      await client.execute('CREATE INDEX idx_chunks_file ON chunks(file)');
      await client.execute('CREATE INDEX idx_chunks_symboltype ON chunks(symbolType)');
      await client.execute('CREATE INDEX idx_import_path ON chunk_imports(import_path)');
      await client.close();
      client = null;
    },
    async open() {
      client = createClient({ url: `file:${dbPath}` });
    },
    async scanAll(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      const rs = await client.execute(`SELECT ${cols.join(',')} FROM chunks`);
      let rows = rs.rows.map(rowToSearchResult);
      if (opts.language)
        rows = rows.filter(r => r.metadata.language?.toLowerCase() === opts.language.toLowerCase());
      return rows;
    },
    async scanWithFilter(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      if (opts.file) {
        const files = Array.isArray(opts.file) ? opts.file : [opts.file];
        const placeholders = files.map(() => '?').join(',');
        const rs = await client.execute({
          sql: `SELECT ${cols.join(',')} FROM chunks WHERE file IN (${placeholders})`,
          args: files,
        });
        return rs.rows.map(rowToSearchResult);
      }
      return this.scanAll(opts);
    },
    async querySymbols(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      const where = ["content != ''"];
      const args = [];
      if (opts.language) {
        where.push('lower(language) = ?');
        args.push(opts.language.toLowerCase());
      }
      if (opts.symbolType) {
        const allowed = [...(SYMBOL_TYPE_MATCHES[opts.symbolType] ?? [])];
        where.push(`(symbolType IN (${allowed.map(() => '?').join(',')}) OR symbolType = '')`);
        args.push(...allowed);
      }
      const rs = await client.execute({
        sql: `SELECT ${cols.join(',')} FROM chunks WHERE ${where.join(' AND ')}`,
        args,
      });
      const rows = rs.rows.map(rowToSearchResult).filter(r => matchesSymbolFilterJs(r, opts));
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    },
    async dependentsSeedIndexed(normalizedTargetLike) {
      const rs = await client.execute({
        sql: `SELECT DISTINCT c.file FROM chunk_imports ci JOIN chunks c ON c.id = ci.chunk_id
              WHERE ci.import_path LIKE ?`,
        args: [`%${normalizedTargetLike}%`],
      });
      return rs.rows.map(r => r.file);
    },
    async close() {
      if (client) await client.close();
      client = null;
    },
  };
  return adapter;
}

// ===========================================================================
// @duckdb/node-api — columnar/vectorized engine.
// ===========================================================================
async function makeDuckdbAdapter() {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const dbPath = path.join(DATA_DIR, 'duckdb', 'chunks.duckdb');
  let instance = null;
  let conn = null;

  const columnDDL = ALL_STORE_COLUMNS.map(c => {
    if (c === 'startLine' || c === 'endLine') return `${c} INTEGER`;
    if (NUMERIC_COLUMNS.has(c)) return `${c} DOUBLE`;
    return `${c} VARCHAR`;
  }).join(', ');

  async function rowsFor(sql, params) {
    const reader = params ? await conn.runAndReadAll(sql, params) : await conn.runAndReadAll(sql);
    return reader.getRowObjects().map(rowToSearchResult);
  }

  const adapter = {
    name: 'duckdb',
    supportsCrossRepo: false,
    dbPath,
    async build(chunks) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}.wal`, { force: true });
      instance = await DuckDBInstance.create(dbPath);
      conn = await instance.connect();
      await conn.run(`CREATE TABLE chunks (id INTEGER, ${columnDDL})`);
      await conn.run('CREATE TABLE chunk_imports (chunk_id INTEGER, import_path VARCHAR)');

      // Bulk load via the appender (DuckDB's fast path — row-by-row INSERT is
      // its weak spot).
      const app = await conn.createAppender('chunks');
      const impApp = await conn.createAppender('chunk_imports');
      let id = 0;
      for (const chunk of chunks) {
        const row = chunkToRow(chunk);
        id++;
        app.appendInteger(id);
        for (const c of ALL_STORE_COLUMNS) {
          if (c === 'startLine' || c === 'endLine') app.appendInteger(Number(row[c]) | 0);
          else if (NUMERIC_COLUMNS.has(c)) app.appendDouble(Number(row[c]) || 0);
          else app.appendVarchar(String(row[c] ?? ''));
        }
        app.endRow();
        for (const imp of JSON.parse(row.imports)) {
          impApp.appendInteger(id);
          impApp.appendVarchar(String(imp));
          impApp.endRow();
        }
        for (const p of Object.keys(JSON.parse(row.importedSymbols))) {
          impApp.appendInteger(id);
          impApp.appendVarchar(String(p));
          impApp.endRow();
        }
      }
      app.flushSync();
      app.closeSync();
      impApp.flushSync();
      impApp.closeSync();
      await conn.run('CREATE INDEX idx_import_path ON chunk_imports(import_path)');
      conn.closeSync?.();
      instance.closeSync?.();
      conn = null;
      instance = null;
    },
    async open() {
      instance = await DuckDBInstance.create(dbPath);
      conn = await instance.connect();
    },
    async scanAll(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      let rows = await rowsFor(`SELECT ${cols.join(',')} FROM chunks`);
      if (opts.language)
        rows = rows.filter(r => r.metadata.language?.toLowerCase() === opts.language.toLowerCase());
      return rows;
    },
    async scanWithFilter(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      if (opts.file) {
        const files = Array.isArray(opts.file) ? opts.file : [opts.file];
        const list = files.map(escapeSql).join(',');
        return rowsFor(`SELECT ${cols.join(',')} FROM chunks WHERE file IN (${list})`);
      }
      return this.scanAll(opts);
    },
    async querySymbols(opts = {}) {
      const cols = projectionToStoreColumns(opts.columns);
      const where = ["content != ''"];
      if (opts.language) where.push(`lower(language) = ${escapeSql(opts.language.toLowerCase())}`);
      if (opts.symbolType) {
        const allowed = [...(SYMBOL_TYPE_MATCHES[opts.symbolType] ?? [])];
        where.push(`(symbolType IN (${allowed.map(escapeSql).join(',')}) OR symbolType = '')`);
      }
      const rows = (
        await rowsFor(`SELECT ${cols.join(',')} FROM chunks WHERE ${where.join(' AND ')}`)
      ).filter(r => matchesSymbolFilterJs(r, opts));
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    },
    async dependentsSeedIndexed(normalizedTargetLike) {
      const reader = await conn.runAndReadAll(
        `SELECT DISTINCT c.file FROM chunk_imports ci JOIN chunks c ON c.id = ci.chunk_id
         WHERE ci.import_path LIKE ${escapeSql('%' + normalizedTargetLike + '%')}`,
      );
      return reader.getRowObjects().map(r => r.file);
    },
    async close() {
      conn?.closeSync?.();
      instance?.closeSync?.();
      conn = null;
      instance = null;
    },
  };
  return adapter;
}

export async function makeAdapter(backend) {
  switch (backend) {
    case 'lancedb':
      return makeLanceAdapter();
    case 'better-sqlite3':
      return makeSqliteAdapter();
    case 'libsql':
      return makeLibsqlAdapter();
    case 'duckdb':
      return makeDuckdbAdapter();
    default:
      throw new Error(`unknown backend: ${backend}`);
  }
}

export const ALL_BACKENDS = ['lancedb', 'better-sqlite3', 'libsql', 'duckdb'];
