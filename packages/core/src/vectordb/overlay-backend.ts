import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { getIndexDir } from '@liendev/parser';
import type { SearchResult, VectorDBInterface } from './types.js';
import { wrapError } from '../errors/index.js';
import { readVersionFile, writeVersionFile } from './version.js';
import {
  filterByLanguage,
  filterByPattern,
  filterBySymbolType,
  matchesSymbolFilter,
  buildLegacySymbols,
} from './filters.js';
import type { SqliteChunkRecord } from './sqlite/row-mapping.js';
import { recordToUnscoredResult, buildSearchResultMetadata } from './sqlite/row-mapping.js';
import {
  normalizeFileFilter,
  readAllRecords,
  readRecordsByFiles,
  readSymbolRecords,
  paginateRecords,
} from './sqlite/read-ops.js';
import {
  insertChunks,
  replaceFileChunks,
  deleteFileChunks,
  validateBatchLengths,
} from './sqlite/write-ops.js';
import { keywordSearch } from './sqlite/fts-search.js';
import {
  openOverlayDatabase,
  OVERLAY_META,
  STRUCTURAL_DB_FILENAME,
} from './sqlite/overlay-schema.js';

const MANIFEST_FILE = 'manifest.json';

/**
 * Worktree overlay backend: reads = writable overlay UNION read-only base
 * (minus masked base files); writes touch the overlay only.
 *
 * The overlay stores full chunk rows (same schema as a standalone index) for
 * files that differ from the base checkout, plus a `overlay_mask` table naming
 * base files to suppress (modified + deleted). The base is opened
 * `{ readonly: true }` so a worktree process can NEVER mutate the main
 * checkout's index. See docs/architecture/worktree-aware-indexing.md.
 *
 * Mask reconciliation hinges on one fact — is a file present in the base
 * manifest? — so it needs no re-hashing:
 *   - `deleteByFile(f)`: drop overlay rows; if `f ∈ base` → mask it. This covers
 *     both a plain deletion and the "delete old chunks" step that precedes an
 *     `insertBatch` on the incremental write path.
 *   - `insertBatch` / `updateFile`: write overlay rows; `updateFile` also masks
 *     `f` when `f ∈ base`.
 */
export class OverlayBackend implements VectorDBInterface {
  public readonly dbPath: string;
  public readonly supportsCrossRepo = false;
  public readonly isOverlay = true;
  public readonly worktreeRoot: string;
  public readonly baseIndexDir: string;

  private readonly overlayDbFilePath: string;
  private readonly baseDbFilePath: string;
  private overlayDb: DatabaseType.Database | null = null;
  private baseDb: DatabaseType.Database | null = null;
  /** Base per-file content hashes (relative path -> hash), loaded from the base
   *  manifest at initialize; drives mask reconciliation and the build diff. */
  private baseHashes = new Map<string, string>();
  private lastVersionCheck = 0;
  private currentVersion = 0;

  constructor(projectRoot: string, baseIndexDir: string) {
    this.worktreeRoot = projectRoot;
    this.baseIndexDir = baseIndexDir;
    this.dbPath = getIndexDir(projectRoot);
    this.overlayDbFilePath = path.join(this.dbPath, STRUCTURAL_DB_FILENAME);
    this.baseDbFilePath = path.join(baseIndexDir, STRUCTURAL_DB_FILENAME);
  }

  private requireOverlay(): DatabaseType.Database {
    if (!this.overlayDb) {
      throw wrapError(new Error('not initialized'), 'Overlay database not initialized');
    }
    return this.overlayDb;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dbPath, { recursive: true });
      this.overlayDb = openOverlayDatabase(this.overlayDbFilePath);
      this.openBase();
      this.baseHashes = await this.loadBaseHashes();
      this.currentVersion = await readVersionFile(this.dbPath);
    } catch (error: unknown) {
      throw wrapError(error, 'Failed to initialize overlay database', { dbPath: this.dbPath });
    }
  }

  /** Open the base read-only. Failure (missing/locked) is non-fatal: reads then
   *  serve overlay-only and the next serve start re-resolves to standalone. */
  private openBase(): void {
    try {
      const db = new Database(this.baseDbFilePath, { readonly: true, fileMustExist: true });
      db.pragma('busy_timeout = 5000');
      this.baseDb = db;
    } catch {
      this.baseDb = null;
    }
  }

  private async loadBaseHashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    try {
      const raw = await fs.readFile(path.join(this.baseIndexDir, MANIFEST_FILE), 'utf-8');
      const parsed = JSON.parse(raw) as {
        files?: Record<string, { contentHash?: string }>;
      };
      for (const [filepath, entry] of Object.entries(parsed.files ?? {})) {
        if (entry.contentHash) hashes.set(filepath, entry.contentHash);
      }
    } catch {
      // No/unreadable base manifest — mask reconciliation degrades to "never
      // mask" (base rows always visible). Resolution normally prevents this.
    }
    return hashes;
  }

  /** Run a read against the base, swallowing errors to [] (base may vanish
   *  mid-serve). Returns [] when there is no base connection. */
  private baseRead<T>(fn: (db: DatabaseType.Database) => T[]): T[] {
    if (!this.baseDb) return [];
    try {
      return fn(this.baseDb);
    } catch {
      return [];
    }
  }

  private loadMask(): Set<string> {
    const db = this.requireOverlay();
    const rows = db.prepare('SELECT file FROM overlay_mask').all() as { file: string }[];
    return new Set(rows.map(r => r.file));
  }

  /** Overlay records ∪ (base records not in the mask). */
  private unionRecords(
    read: (db: DatabaseType.Database) => SqliteChunkRecord[],
  ): SqliteChunkRecord[] {
    const overlayRecords = read(this.requireOverlay());
    const mask = this.loadMask();
    const baseRecords = this.baseRead(read).filter(r => !mask.has(r.file));
    return [...overlayRecords, ...baseRecords];
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    const overlayHits = keywordSearch(this.requireOverlay(), query, limit);
    const mask = this.loadMask();
    const baseHits = this.baseRead(db => keywordSearch(db, query, limit)).filter(
      h => !mask.has(h.metadata.file),
    );
    // BM25 ranks are corpus-relative; merging two corpora yields an approximate
    // global order (documented v1 caveat). score is lower-is-better.
    return [...overlayHits, ...baseHits].sort((a, b) => a.score - b.score).slice(0, limit);
  }

  async scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { file, language, pattern, symbolType, limit = 100 } = options;

    let records = file
      ? this.unionRecords(db => readRecordsByFiles(db, normalizeFileFilter(file)))
      : this.unionRecords(readAllRecords);
    if (language) records = filterByLanguage(records, language);
    if (pattern) records = filterByPattern(records, pattern);
    if (symbolType) records = filterBySymbolType(records, symbolType);

    return records.slice(0, limit).map(recordToUnscoredResult);
  }

  async scanAll(options: { language?: string; pattern?: string } = {}): Promise<SearchResult[]> {
    const { language, pattern } = options;
    if (!language && !pattern) {
      return this.unionRecords(readAllRecords).map(recordToUnscoredResult);
    }
    return this.scanWithFilter({ language, pattern, limit: Number.MAX_SAFE_INTEGER });
  }

  async querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { language, pattern, symbolType, limit = 50 } = options;
    const records = this.unionRecords(readSymbolRecords).filter(r =>
      matchesSymbolFilter(r, { language, pattern, symbolType }),
    );
    return records.slice(0, limit).map(r => ({
      content: r.content,
      metadata: { ...buildSearchResultMetadata(r), symbols: buildLegacySymbols(r) },
      score: 0,
      relevance: 'not_relevant' as const,
    }));
  }

  async *scanPaginated(options: { pageSize?: number } = {}): AsyncGenerator<SearchResult[]> {
    const pageSize = options.pageSize ?? 1000;
    // Overlay pages first, then masked base pages — each store paginated
    // independently so neither is fully materialized in memory.
    for (const page of paginateRecords(this.requireOverlay(), pageSize)) {
      yield page.map(recordToUnscoredResult);
    }
    if (this.baseDb) {
      const mask = this.loadMask();
      for (const page of paginateRecords(this.baseDb, pageSize)) {
        const kept = page.filter(r => !mask.has(r.file)).map(recordToUnscoredResult);
        if (kept.length > 0) yield kept;
      }
    }
  }

  // ── Writes (overlay only) ─────────────────────────────────────────────

  async insertBatch(metadatas: ChunkMetadata[], contents: string[]): Promise<void> {
    validateBatchLengths(metadatas, contents);
    insertChunks(this.requireOverlay(), metadatas, contents);
  }

  async updateFile(
    filepath: string,
    metadatas: ChunkMetadata[],
    contents: string[],
  ): Promise<void> {
    validateBatchLengths(metadatas, contents);
    replaceFileChunks(this.requireOverlay(), filepath, metadatas, contents);
    if (this.baseHashes.has(filepath)) this.maskBasePath(filepath);
    await writeVersionFile(this.dbPath);
  }

  async deleteByFile(filepath: string): Promise<void> {
    deleteFileChunks(this.requireOverlay(), filepath);
    // Suppress the (still present) base rows for this path. Covers a real
    // deletion AND the delete-old-chunks step before an incremental insertBatch
    // (in which case the file diverged from base and must stay masked).
    if (this.baseHashes.has(filepath)) this.maskBasePath(filepath);
  }

  async clear(): Promise<void> {
    // Reset the OVERLAY only — never the base. Close the handle, remove the
    // db + WAL/SHM sidecars, then reopen a fresh empty store — mirrors
    // SqliteBackend.clear(). An in-place `DELETE FROM chunks` leaves the
    // freed pages in SQLite's freelist rather than shrinking the file, and
    // buildOverlay calls clear() at the start of every rebuild: an overlay
    // that once held many diverged files (e.g. a branch that has since been
    // merged back, or a worktree indexed standalone before this feature
    // existed) would keep that high-water-mark file size forever even after
    // shrinking back to a handful of rows — defeating the point of the
    // overlay staying small.
    this.requireOverlay();
    this.overlayDb?.close();
    this.overlayDb = null;
    await Promise.all(
      [
        this.overlayDbFilePath,
        `${this.overlayDbFilePath}-wal`,
        `${this.overlayDbFilePath}-shm`,
      ].map(f => fs.rm(f, { force: true })),
    );
    this.overlayDb = openOverlayDatabase(this.overlayDbFilePath);
  }

  async hasData(): Promise<boolean> {
    if (this.overlayHasRows()) return true;
    return (
      this.baseRead(db => {
        const row = db.prepare("SELECT 1 FROM chunks WHERE content != '' LIMIT 1").get();
        return row !== undefined ? [true] : [];
      }).length > 0
    );
  }

  private overlayHasRows(): boolean {
    if (!this.overlayDb) return false;
    try {
      const row = this.overlayDb.prepare("SELECT 1 FROM chunks WHERE content != '' LIMIT 1").get();
      return row !== undefined;
    } catch {
      return false;
    }
  }

  // ── Overlay build support (driven by indexer/overlay-index.ts) ─────────

  /** Base per-file content hashes (relative path -> hash). */
  getBaseHashes(): ReadonlyMap<string, string> {
    return this.baseHashes;
  }

  /** Add a base file path to the suppression mask (idempotent). */
  maskBasePath(filepath: string): void {
    this.requireOverlay()
      .prepare('INSERT OR IGNORE INTO overlay_mask(file) VALUES (?)')
      .run(filepath);
  }

  private setMeta(key: string, value: string): void {
    this.requireOverlay()
      .prepare(
        'INSERT INTO overlay_meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      )
      .run(key, value);
  }

  private getMeta(key: string): string | null {
    const row = this.requireOverlay().prepare('SELECT v FROM overlay_meta WHERE k = ?').get(key) as
      | { v: string }
      | undefined;
    return row ? row.v : null;
  }

  /** Record which base build this overlay was diffed against + stamp the
   *  overlay version file. Called at the end of a build. */
  async recordBaseBuild(): Promise<void> {
    const stamp = await readVersionFile(this.baseIndexDir);
    this.setMeta(OVERLAY_META.BASE_INDEX_DIR, this.baseIndexDir);
    this.setMeta(OVERLAY_META.BASE_STAMP, String(stamp));
    await writeVersionFile(this.dbPath);
  }

  /**
   * True when the overlay must be rebuilt against the base: it was never built,
   * or the base has been reindexed since (its version stamp moved). Cheap —
   * two small reads.
   */
  async needsRebuild(): Promise<boolean> {
    const recorded = this.getMeta(OVERLAY_META.BASE_STAMP);
    if (recorded === null) return true;
    const currentBaseStamp = await readVersionFile(this.baseIndexDir);
    return String(currentBaseStamp) !== recorded;
  }

  // ── Lifecycle / version plumbing (over the overlay dir) ────────────────

  async checkVersion(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastVersionCheck < 1000) return false;
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

  close(): void {
    if (this.overlayDb) {
      this.overlayDb.close();
      this.overlayDb = null;
    }
    if (this.baseDb) {
      this.baseDb.close();
      this.baseDb = null;
    }
  }

  async reconnect(): Promise<void> {
    try {
      this.close();
      await this.initialize();
    } catch (error) {
      throw wrapError(error, 'Failed to reconnect to overlay database');
    }
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  getVersionDate(): string {
    if (this.currentVersion === 0) return 'Unknown';
    return new Date(this.currentVersion).toLocaleString();
  }

  async scanCrossRepo(_options: {
    language?: string;
    pattern?: string;
    limit?: number;
    repoIds?: string[];
    branch?: string;
  }): Promise<SearchResult[]> {
    return [];
  }
}
