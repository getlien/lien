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
import { openDatabase, STRUCTURAL_DB_FILENAME } from './schema.js';
import { recordToUnscoredResult, buildSearchResultMetadata } from './row-mapping.js';
import {
  normalizeFileFilter,
  readAllRecords,
  readRecordsByFiles,
  readSymbolRecords,
  paginateRecords,
} from './read-ops.js';
import {
  insertChunks,
  replaceFileChunks,
  deleteFileChunks,
  validateBatchLengths,
} from './write-ops.js';
import { keywordSearch } from './fts-search.js';

/**
 * SQLite + FTS5 structural backend implementing VectorDBInterface.
 *
 * There are no embeddings: `search` runs FTS5 keyword matching on the query
 * text. Full chunk metadata is always returned — there's no fat vector column
 * to project away.
 */
export class SqliteBackend implements VectorDBInterface {
  private db: DatabaseType.Database | null = null;
  public readonly dbPath: string;
  private readonly dbFilePath: string;
  public readonly isOverlay = false;
  private lastVersionCheck = 0;
  private currentVersion = 0;

  constructor(projectRoot: string) {
    const repoId = extractRepoId(projectRoot);
    // The manifest and .lien-index-version file live in this directory
    // too and must stay put.
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

  async insertBatch(metadatas: ChunkMetadata[], contents: string[]): Promise<void> {
    const db = this.requireDb();
    validateBatchLengths(metadatas, contents);
    insertChunks(db, metadatas, contents);
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    const db = this.requireDb();
    if (!query || query.trim().length === 0) return [];
    return keywordSearch(db, query, limit);
  }

  async scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { file, language, pattern, symbolType, limit = 100 } = options;

    // Truthy guard mirrors query.ts (`file ? ... : 'file != ""'`): an empty
    // string is treated as no filter (full scan), while a non-empty array
    // still routes through normalizeFileFilter.
    let records = file ? readRecordsByFiles(db, normalizeFileFilter(file)) : readAllRecords(db);
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
    } = {},
  ): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { language, pattern } = options;

    // Fast path: no filters → plain full read.
    if (!language && !pattern) {
      return readAllRecords(db).map(recordToUnscoredResult);
    }

    // Otherwise delegate to scanWithFilter with no result cap (parity with
    // scanAll's max(totalRows, ...) limit).
    return this.scanWithFilter({ language, pattern, limit: Number.MAX_SAFE_INTEGER });
  }

  async *scanPaginated(
    options: {
      pageSize?: number;
    } = {},
  ): AsyncGenerator<SearchResult[]> {
    const db = this.requireDb();
    const pageSize = options.pageSize ?? 1000;
    for (const page of paginateRecords(db, pageSize)) {
      yield page.map(recordToUnscoredResult);
    }
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    const db = this.requireDb();
    const { language, pattern, symbolType, limit = 50 } = options;

    // content != '' is a hard SQL prefilter (empty-content chunks excluded);
    // matchesSymbolFilter stays authoritative for the rest (legacy symbol
    // arrays can match with an empty symbolType).
    const records = readSymbolRecords(db).filter(r =>
      matchesSymbolFilter(r, { language, pattern, symbolType }),
    );

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
    deleteFileChunks(db, filepath);
  }

  async updateFile(
    filepath: string,
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    const db = this.requireDb();
    validateBatchLengths(metadatas, contents);

    // delete + insert in ONE transaction.
    replaceFileChunks(db, filepath, metadatas, contents);

    // Bump the cross-process invalidation token. currentVersion is intentionally
    // NOT bumped in-memory here — only the file is written; checkVersion picks
    // the change up on its next poll.
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
    // manifest untouched.
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

  /** Release the SQLite file handle. Not part of VectorDBInterface; callers
   * that own the backend's lifecycle (tests, shutdown paths) use it to free
   * file descriptors deterministically before removing the store. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async reconnect(): Promise<void> {
    try {
      this.close();
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

  static async load(projectRoot: string): Promise<SqliteBackend> {
    const db = new SqliteBackend(projectRoot);
    await db.initialize();
    return db;
  }
}
