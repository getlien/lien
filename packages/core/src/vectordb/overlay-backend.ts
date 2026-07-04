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

/** True for the lock-contention error codes BEGIN IMMEDIATE can raise when a
 *  peer process holds the overlay's write lock past the busy timeout. */
function isSqliteBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT';
}

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

  /**
   * Run `fn` against the overlay inside one deferred (read-only) transaction so
   * every statement it issues sees the SAME WAL snapshot. Overlay reads pair a
   * chunk scan with a mask read; without a shared snapshot a concurrent atomic
   * rebuild committing between the two statements could be observed half-applied
   * (rows from the old snapshot, mask from the new — or vice versa), which is
   * exactly the masked-but-unreplaced window this backend must never expose.
   * A deferred transaction pins the snapshot at its first read and never blocks
   * (or is blocked by) the single WAL writer.
   */
  private overlaySnapshot<T>(fn: (db: DatabaseType.Database) => T): T {
    const db = this.requireOverlay();
    return db.transaction(fn)(db);
  }

  /** Overlay records ∪ (base records not in the mask). Overlay rows + mask are
   *  read from one snapshot; the base read is on a separate, immutable-from-here
   *  connection. */
  private unionRecords(
    read: (db: DatabaseType.Database) => SqliteChunkRecord[],
  ): SqliteChunkRecord[] {
    const { overlayRecords, mask } = this.overlaySnapshot(db => ({
      overlayRecords: read(db),
      mask: this.loadMask(),
    }));
    const baseRecords = this.baseRead(read).filter(r => !mask.has(r.file));
    return [...overlayRecords, ...baseRecords];
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    const { overlayHits, mask } = this.overlaySnapshot(db => ({
      overlayHits: keywordSearch(db, query, limit),
      mask: this.loadMask(),
    }));
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
    // Snapshot the overlay rows + mask together (one WAL snapshot) so the mask
    // matches the rows even if a rebuild commits mid-iteration. The overlay is
    // small by design (only diverged files), so materializing it is cheap; the
    // large base side stays paginated to bound memory.
    const { overlayRecords, mask } = this.overlaySnapshot(db => ({
      overlayRecords: readAllRecords(db),
      mask: this.loadMask(),
    }));
    for (let i = 0; i < overlayRecords.length; i += pageSize) {
      yield overlayRecords.slice(i, i + pageSize).map(recordToUnscoredResult);
    }
    if (this.baseDb) {
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
    // Reset the OVERLAY only — never the base. A plain `DELETE FROM chunks`
    // leaves the freed pages in SQLite's freelist rather than shrinking the
    // file, and buildOverlay calls clear() at the start of every rebuild: an
    // overlay that once held many diverged files (e.g. a worktree previously
    // indexed standalone, or a branch that has since been merged back) would
    // keep that high-water-mark file size forever even after shrinking back
    // to a handful of rows — defeating the point of the overlay staying
    // small. VACUUM reclaims that space in place.
    //
    // Deliberately NOT close+delete+recreate-the-file (as SqliteBackend.clear()
    // does): that swaps the file's identity out from under any other process
    // with the same overlay open (e.g. two `lien index` runs racing on one
    // worktree), which reproduced real `SQLITE_IOERR` failures under
    // concurrent load in testing. VACUUM + a WAL checkpoint keep the same
    // file identity throughout and proved safe under the same stress test.
    const db = this.requireOverlay();
    db.exec('DELETE FROM chunks; DELETE FROM overlay_mask; DELETE FROM overlay_meta;');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
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

  /** True when the given content signature matches the one recorded at the last
   *  build — i.e. a rebuild would reproduce the identical overlay. */
  overlaySignatureMatches(signature: string): boolean {
    return this.getMeta(OVERLAY_META.SIGNATURE) === signature;
  }

  /** Base `.lien-index-version` stamp as a string (for staleness comparison). */
  async getBaseStamp(): Promise<string> {
    return String(await readVersionFile(this.baseIndexDir));
  }

  /** Refresh only the base-build stamp — no content change, no version bump.
   *  Used on the no-op rebuild path so `needsRebuild()` settles after a base
   *  reindex that left the overlay content identical. */
  refreshBaseStamp(baseIndexDir: string, baseStamp: string): void {
    const db = this.requireOverlay();
    db.transaction(() => {
      this.setMeta(OVERLAY_META.BASE_INDEX_DIR, baseIndexDir);
      this.setMeta(OVERLAY_META.BASE_STAMP, baseStamp);
    })();
  }

  /** Bump the overlay's version stamp so other connections reconnect. */
  async bumpVersion(): Promise<void> {
    await writeVersionFile(this.dbPath);
  }

  /**
   * Atomically replace the overlay's entire content — chunk rows, suppression
   * mask, and base-build metadata — in ONE transaction, so other connections
   * observe the swap all-or-nothing (WAL snapshot isolation): a reader sees the
   * complete old overlay or the complete new one, never a base file masked with
   * no replacement rows yet (the bug this method exists to kill).
   *
   * The transaction is `BEGIN IMMEDIATE` and re-reads the stored signature
   * INSIDE the write lock: if a concurrent writer (another `lien serve` on the
   * same worktree) already applied the identical overlay, this is a no-op that
   * reports `changed: false`, so the caller skips the version bump — no
   * reconnect / rebuild cascade forms. If a peer holds the write lock past the
   * busy timeout we skip as well (busy-skip: the peer's swap serves us).
   *
   * VACUUM + a WAL checkpoint run AFTER commit (VACUUM cannot run inside a
   * transaction) to reclaim pages freed by the DELETE — keeping the same file
   * identity throughout (never close+delete+recreate, which is unsafe when
   * other processes hold the overlay open). Correctness never depends on them.
   */
  applyRebuild(plan: {
    chunkBatches: ReadonlyArray<{ metadatas: ChunkMetadata[]; contents: string[] }>;
    maskFiles: readonly string[];
    baseIndexDir: string;
    baseStamp: string;
    signature: string;
  }): { changed: boolean } {
    const db = this.requireOverlay();

    const swap = db.transaction((): boolean => {
      // Always keep the base-build stamp current so needsRebuild() settles even
      // when the content itself is unchanged.
      this.setMeta(OVERLAY_META.BASE_INDEX_DIR, plan.baseIndexDir);
      this.setMeta(OVERLAY_META.BASE_STAMP, plan.baseStamp);
      if (this.getMeta(OVERLAY_META.SIGNATURE) === plan.signature) {
        return false; // identical overlay already applied (possibly by a peer)
      }
      db.exec('DELETE FROM chunks; DELETE FROM overlay_mask;');
      for (const batch of plan.chunkBatches) {
        insertChunks(db, batch.metadatas, batch.contents);
      }
      const maskInsert = db.prepare('INSERT OR IGNORE INTO overlay_mask(file) VALUES (?)');
      for (const file of plan.maskFiles) maskInsert.run(file);
      this.setMeta(OVERLAY_META.SIGNATURE, plan.signature);
      return true;
    });

    let changed: boolean;
    try {
      changed = swap.immediate();
    } catch (error) {
      if (isSqliteBusy(error)) return { changed: false }; // a peer is rebuilding
      throw error;
    }

    if (changed) this.reclaimSpace();
    return { changed };
  }

  /** Best-effort in-place disk reclamation after a content swap (same file
   *  identity — see applyRebuild). */
  private reclaimSpace(): void {
    const db = this.requireOverlay();
    try {
      db.exec('VACUUM');
    } catch {
      // A concurrent connection may hold a lock; the next rebuild reclaims.
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // best-effort
    }
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
