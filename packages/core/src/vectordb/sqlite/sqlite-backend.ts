import fs from 'fs/promises';
import path from 'path';
import type DatabaseType from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { extractRepoId, getLienHome } from '@liendev/parser';
import type { SearchResult, VectorDBInterface } from '../types.js';
import { DatabaseError, wrapError } from '../../errors/index.js';
import { readVersionFile, writeVersionFile } from '../version.js';
import {
  filterByLanguage,
  filterByPattern,
  filterBySymbolType,
  matchesSymbolFilter,
  buildLegacySymbols,
} from '../filters.js';
import { openDatabase, STRUCTURAL_DB_FILENAME, CHUNK_COLUMNS } from './schema.js';
import {
  chunkToRow,
  parseRow,
  recordToUnscoredResult,
  buildSearchResultMetadata,
  type SqliteChunkRecord,
} from './row-mapping.js';
import { keywordSearch } from './fts-search.js';

const INSERT_SQL = `INSERT INTO chunks (${CHUNK_COLUMNS.join(', ')}) VALUES (${CHUNK_COLUMNS.map(
  c => '@' + c,
).join(', ')})`;

/**
 * A row identity requires a non-empty file and non-empty content. Mirrors
 * query.ts:isValidRecord so scan paths drop empty-content rows identically to
 * LanceDB (content is always a string here — the column is NOT NULL).
 */
function isValidRecord(r: SqliteChunkRecord): boolean {
  if (!r.file || r.file.length === 0) return false;
  if (r.content.trim().length === 0) return false;
  return true;
}

/**
 * Trim + validate a file filter into a list of exact-match paths. Empty or
 * whitespace-only paths throw — matching query.ts buildFileWhereClause.
 */
function normalizeFileFilter(file: string | string[]): string[] {
  if (typeof file === 'string') {
    const trimmed = file.trim();
    if (trimmed.length === 0) {
      throw new DatabaseError('Invalid file filter: file path must be non-empty');
    }
    return [trimmed];
  }
  const cleaned = file.map(f => f.trim()).filter(f => f.length > 0);
  if (cleaned.length === 0) {
    throw new DatabaseError('Invalid file filter: at least one non-empty file path is required');
  }
  return cleaned;
}

function validateBatchLengths(
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): void {
  if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
    throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length', {
      vectorsLength: vectors.length,
      metadatasLength: metadatas.length,
      contentsLength: contents.length,
    });
  }
}

/**
 * SQLite + FTS5 structural backend implementing VectorDBInterface.
 *
 * Embeddings are ignored entirely: `vectors` arguments are accepted (for
 * interface parity) but never stored, and `search` runs FTS5 keyword matching
 * on the query text rather than a vector ANN. The `columns` projection is
 * accepted and ignored everywhere — there's no fat vector column to skip, so
 * full metadata is always returned (the interface doc permits this).
 */
export class SqliteBackend implements VectorDBInterface {
  private db: DatabaseType.Database | null = null;
  public readonly dbPath: string;
  private readonly dbFilePath: string;
  public readonly supportsCrossRepo = false;
  private lastVersionCheck = 0;
  private currentVersion = 0;

  constructor(projectRoot: string) {
    const repoId = extractRepoId(projectRoot);
    // Same directory as LanceDB's table dir — the manifest and
    // .lien-index-version file live here too and must stay put.
    this.dbPath = path.join(getLienHome(), '.lien', 'indices', repoId);
    this.dbFilePath = path.join(this.dbPath, STRUCTURAL_DB_FILENAME);
  }

  private requireDb(): DatabaseType.Database {
    if (!this.db) {
      throw new DatabaseError('Vector database not initialized');
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dbPath, { recursive: true });
      this.db = openDatabase(this.dbFilePath);
      this.currentVersion = await readVersionFile(this.dbPath);
    } catch (error: unknown) {
      throw wrapError(error, 'Failed to initialize vector database', { dbPath: this.dbPath });
    }
  }

  async insertBatch(
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    const db = this.requireDb();
    validateBatchLengths(vectors, metadatas, contents);
    // Empty batch is a no-op.
    if (metadatas.length === 0) return;

    // Single transaction, one prepared statement. No adaptive half-split retry:
    // that existed only for LanceDB/Arrow large-batch flakiness, which SQLite
    // doesn't have.
    const insert = db.prepare(INSERT_SQL);
    const insertAll = db.transaction((rows: ReturnType<typeof chunkToRow>[]) => {
      for (const row of rows) insert.run(row);
    });
    insertAll(metadatas.map((metadata, i) => chunkToRow(contents[i], metadata)));
  }

  async search(
    _queryVector: Float32Array,
    limit: number = 5,
    query?: string,
    _options: { columns?: string[] } = {},
  ): Promise<SearchResult[]> {
    const db = this.requireDb();
    // No query text → no lexical search possible. LanceDB always had a vector,
    // so this path has no current caller; keep it total anyway.
    if (!query || query.trim().length === 0) return [];
    return keywordSearch(db, query, limit);
  }

  async scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
    columns?: string[];
  }): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { file, language, pattern, symbolType, limit = 100 } = options;

    let rawRows: Record<string, unknown>[];
    // Truthy guard mirrors query.ts (`file ? ... : 'file != ""'`): an empty
    // string is treated as no filter (full scan), while a non-empty array
    // still routes through normalizeFileFilter.
    if (file) {
      const files = normalizeFileFilter(file);
      const placeholders = files.map(() => '?').join(', ');
      rawRows = db
        .prepare(`SELECT * FROM chunks WHERE file IN (${placeholders}) ORDER BY id`)
        .all(...files) as Record<string, unknown>[];
    } else {
      rawRows = db.prepare('SELECT * FROM chunks ORDER BY id').all() as Record<string, unknown>[];
    }

    let records = rawRows.map(parseRow).filter(isValidRecord);
    if (language) records = filterByLanguage(records, language);
    if (pattern) records = filterByPattern(records, pattern);
    if (symbolType) records = filterBySymbolType(records, symbolType);

    // slice LAST, after JS filters — same order as query.ts.
    return records.slice(0, limit).map(recordToUnscoredResult);
  }

  async scanAll(
    options: {
      language?: string;
      pattern?: string;
      columns?: string[];
    } = {},
  ): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { language, pattern } = options;

    // Fast path: no filters → plain full read.
    if (!language && !pattern) {
      const rawRows = db.prepare('SELECT * FROM chunks ORDER BY id').all() as Record<
        string,
        unknown
      >[];
      return rawRows.map(parseRow).filter(isValidRecord).map(recordToUnscoredResult);
    }

    // Otherwise delegate to scanWithFilter with no result cap (parity with
    // scanAll's max(totalRows, ...) limit).
    return this.scanWithFilter({ language, pattern, limit: Number.MAX_SAFE_INTEGER });
  }

  async *scanPaginated(
    options: {
      pageSize?: number;
      columns?: string[];
    } = {},
  ): AsyncGenerator<SearchResult[]> {
    const db = this.requireDb();
    const pageSize = options.pageSize ?? 1000;
    if (pageSize <= 0) {
      throw new DatabaseError('pageSize must be a positive number');
    }

    const stmt = db.prepare("SELECT * FROM chunks WHERE file != '' ORDER BY id LIMIT ? OFFSET ?");
    let offset = 0;
    while (true) {
      const rawRows = stmt.all(pageSize, offset) as Record<string, unknown>[];
      if (rawRows.length === 0) break;

      const page = rawRows.map(parseRow).filter(isValidRecord).map(recordToUnscoredResult);
      if (page.length > 0) yield page;

      if (rawRows.length < pageSize) break;
      offset += pageSize;
    }
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
    columns?: string[];
  }): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { language, pattern, symbolType, limit = 50 } = options;

    // content != '' is a hard SQL prefilter (empty-content chunks excluded);
    // matchesSymbolFilter stays authoritative for the rest (legacy symbol
    // arrays can match with an empty symbolType).
    const rawRows = db
      .prepare("SELECT * FROM chunks WHERE content != '' ORDER BY id")
      .all() as Record<string, unknown>[];

    const records = rawRows
      .map(parseRow)
      .filter(r => isValidRecord(r) && matchesSymbolFilter(r, { language, pattern, symbolType }));

    return records.slice(0, limit).map(r => ({
      content: r.content,
      metadata: { ...buildSearchResultMetadata(r), symbols: buildLegacySymbols(r) },
      score: 0,
      relevance: 'not_relevant' as const,
    }));
  }

  async deleteByFile(filepath: string): Promise<void> {
    const db = this.requireDb();
    // Exact match, no normalization — caller normalizes. FTS stays in sync via
    // the AFTER DELETE trigger.
    db.prepare('DELETE FROM chunks WHERE file = ?').run(filepath);
  }

  async updateFile(
    filepath: string,
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    const db = this.requireDb();
    validateBatchLengths(vectors, metadatas, contents);

    // delete + insert in ONE transaction (an improvement over LanceDB's
    // non-transactional two-step; same observable outcome).
    const del = db.prepare('DELETE FROM chunks WHERE file = ?');
    const insert = db.prepare(INSERT_SQL);
    const apply = db.transaction((rows: ReturnType<typeof chunkToRow>[]) => {
      del.run(filepath);
      for (const row of rows) insert.run(row);
    });
    apply(metadatas.map((metadata, i) => chunkToRow(contents[i], metadata)));

    // Bump the cross-process invalidation token. currentVersion is intentionally
    // NOT bumped in-memory here — this matches LanceDB (maintenance.updateFile
    // only writes the file); checkVersion picks the change up on its next poll.
    await writeVersionFile(this.dbPath);
  }

  async hasData(): Promise<boolean> {
    if (!this.db) return false;
    try {
      const row = this.db.prepare("SELECT 1 FROM chunks WHERE content != '' LIMIT 1").get();
      return row !== undefined;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    const db = this.requireDb();
    // Close the handle to release the file, remove the db + WAL/SHM sidecars,
    // then reopen a fresh empty store. Leaves .lien-index-version and the
    // manifest untouched (LanceDB clear only removes the table dir).
    db.close();
    this.db = null;
    await Promise.all(
      [this.dbFilePath, `${this.dbFilePath}-wal`, `${this.dbFilePath}-shm`].map(f =>
        fs.rm(f, { force: true }),
      ),
    );
    this.db = openDatabase(this.dbFilePath);
  }

  async checkVersion(): Promise<boolean> {
    const now = Date.now();
    // Cache version checks for 1 second to minimize I/O.
    if (now - this.lastVersionCheck < 1000) {
      return false;
    }
    this.lastVersionCheck = now;

    try {
      const version = await readVersionFile(this.dbPath);
      if (version > this.currentVersion) {
        this.currentVersion = version;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async reconnect(): Promise<void> {
    try {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      await this.initialize();
    } catch (error) {
      throw wrapError(error, 'Failed to reconnect to vector database');
    }
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  getVersionDate(): string {
    if (this.currentVersion === 0) {
      return 'Unknown';
    }
    return new Date(this.currentVersion).toLocaleString();
  }

  async searchCrossRepo(
    _queryVector: Float32Array,
    _limit?: number,
    _options?: { repoIds?: string[]; branch?: string; columns?: string[] },
  ): Promise<SearchResult[]> {
    return [];
  }

  async scanCrossRepo(_options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
    columns?: string[];
  }): Promise<SearchResult[]> {
    return [];
  }

  static async load(projectRoot: string): Promise<SqliteBackend> {
    const db = new SqliteBackend(projectRoot);
    await db.initialize();
    return db;
  }
}
