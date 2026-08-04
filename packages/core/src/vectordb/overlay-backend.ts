import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import type { ChunkMetadata } from '@liendev/parser';
import { getIndexDir } from '../utils/index-dir.js';
import { ManifestManager } from '../indexer/manifest.js';
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
import {
  keywordSearchRanked,
  computeRankingKey,
  structuralRankingEnabled,
  testFileRankingEnabled,
} from './sqlite/fts-search.js';
import type { RankedResult } from './sqlite/fts-search.js';
import {
  hasComputedDependentCounts,
  readDependentCounts,
  refreshDependentCounts as refreshOverlayDependentCounts,
} from './sqlite/dependent-counts.js';
import {
  openOverlayDatabase,
  OVERLAY_META,
  STRUCTURAL_DB_FILENAME,
} from './sqlite/overlay-schema.js';
import { withOpenRetry } from './sqlite/schema.js';

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
/**
 * Merge two corpora's already-ranked hit lists into one order (#1071).
 *
 * `keywordSearchRanked` applies the ranking key (structural boost, test-file
 * demotion) WITHIN each corpus -- the composed sort key is internal to that
 * function, EXCEPT it is not thrown away here: both `overlayHits` and
 * `baseHits` are `RankedResult[]`, still carrying the raw bm25 `ratio` each
 * hit was scored with, not yet trimmed down to the public `SearchResult`
 * shape. `computeRankingKey` -- the exact same composition
 * `keywordSearchRanked` uses -- is reapplied here over the merged list on
 * that RAW ratio, never a re-derived copy of the composition logic (see that
 * function's own doc comment on why this codebase treats a second definition
 * of one ranking decision as a bug generator).
 *
 * This used to reconstruct `ratio` from the public `score` field
 * (`1 - hit.score / 2`) instead of carrying it through. That is UNSOUND:
 * `score = round4((1 - ratio) * 2)` (see `scoreRow`) rounds to 4 decimal
 * places, so it is not invertible -- two hits, one from each corpus, whose
 * raw ratios differ by less than the rounding granularity (~0.00005) can
 * round to the IDENTICAL `score`. Reconstructing from that collided score
 * produces an artificial tie between two hits that were never actually tied,
 * which `Array.prototype.sort`'s stability then resolves by ARRAY POSITION --
 * `overlayHits` is concatenated before `baseHits` in `merged`, so the overlay
 * hit silently wins regardless of which hit's true ratio was actually better
 * (found in review, #1080). That silent mis-ordering is concentrated exactly
 * in the near-tie population `applyStructuralBoost`/`applyTestFileDemotion`
 * exist to adjudicate correctly -- not a remote corner case. Carrying the raw
 * `ratio` through instead removes the reconstruction (and the tie it can
 * fabricate) entirely; see the close-score regression in
 * `overlay-backend.test.ts`. `ratio` is stripped from the return value at the
 * very end, exactly where `keywordSearch` itself strips it -- `score`'s
 * public, rounded meaning is unchanged; only the internal merge decision
 * stops going through it.
 *
 * With BOTH `LIEN_STRUCTURAL_RANKING=off` and `LIEN_TEST_FILE_RANKING=off`
 * this is pure `score` ascending, identical to the pre-#1071 merge (ordering
 * on the public, rounded `score` directly here is fine -- nothing is
 * reconstructed FROM it), so each escape hatch keeps meaning what it says
 * independently of the other.
 *
 * Exported so this exact merge decision is unit-testable against
 * hand-constructed `RankedResult` fixtures with precise ratio values --
 * reproducing a genuine bm25 rounding collision from real indexed content
 * would mean engineering 5th-decimal-place floating point coincidences,
 * which is neither reliable nor readable as a test.
 */
export function mergeRankedHits(
  overlayHits: RankedResult[],
  baseHits: RankedResult[],
  limit: number,
): SearchResult[] {
  const merged = [...overlayHits, ...baseHits];
  const ranked =
    structuralRankingEnabled() || testFileRankingEnabled()
      ? [...merged].sort(
          (a, b) =>
            computeRankingKey(b.ratio, b.metadata.dependentCount ?? 0, b.metadata.file) -
            computeRankingKey(a.ratio, a.metadata.dependentCount ?? 0, a.metadata.file),
        )
      : [...merged].sort((a, b) => a.score - b.score);
  return ranked.slice(0, limit).map(({ ratio: _ratio, ...result }) => result);
}

export class OverlayBackend implements VectorDBInterface {
  public readonly dbPath: string;
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
      // withOpenRetry: the overlay file may be brand-new, with other worktree
      // serves racing to create/open it at the same instant.
      this.overlayDb = await withOpenRetry(() => openOverlayDatabase(this.overlayDbFilePath));
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

  /**
   * The composed reverse-dependency counts for this worktree (#1071).
   *
   * Each connection's own `dependent_counts` table describes only its own
   * corpus, so reading either in isolation is the #1050/#1051 mistake: the
   * overlay alone reports near-zero for a fresh worktree whose files mostly live
   * in the shared base, and the base alone cannot see the worktree's own
   * divergences.
   *
   * `refreshDependentCounts()` resolves that by writing the FULL composed map
   * into the overlay table, so once it has run the overlay table is the whole
   * truth and is used ALONE. It deliberately is not merged over the base, which
   * would be wrong in a way that is easy to miss (found in review): a zero is
   * stored as the ABSENCE of a row, so a file whose count legitimately drops to
   * 0 in this worktree — the worktree masked its only base importer — has no
   * overlay row to override the base's stale positive value with. Merging would
   * resurrect that old count as if nothing had changed.
   *
   * The base is consulted only when this overlay has never had composed counts
   * written at all (an overlay built by a version predating #1071). Then the
   * base's own counts still serve every unmasked base file, which is strictly
   * better than collapsing the whole worktree to 0 — and, being pre-#1071 data,
   * it cannot be masking a divergence this overlay knows about.
   *
   * Keyed on the presence of the `DEPENDENT_COUNTS_COMPOSED` meta flag rather
   * than on the table being non-empty, so a composed corpus whose every count is
   * genuinely 0 (nothing imports anything) is not mistaken for "never computed"
   * and silently handed the base's numbers.
   */
  private composedDependentCounts(): Map<string, number> {
    const overlay = this.requireOverlay();
    if (this.getMeta(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED)) {
      return readDependentCounts(overlay);
    }
    return new Map([...this.baseDependentCounts(), ...readDependentCounts(overlay)]);
  }

  /**
   * The base store's own stored counts, or an empty map if it has none to give.
   *
   * The base connection is opened `{ readonly: true }` by `openBase()`, so
   * `openDatabase`'s `CREATE TABLE IF NOT EXISTS` never runs against it — a base
   * index written by a pre-#1071 version genuinely has no `dependent_counts`
   * table, and the read throws `SQLITE_ERROR: no such table`. That must degrade
   * to "no base counts" (the pre-#1071 behaviour: every count 0, boost =
   * identity), never crash `search()`. Mirrors `baseRead`'s existing
   * swallow-to-empty resilience, which exists because the base can also vanish
   * mid-serve.
   */
  private baseDependentCounts(): Map<string, number> {
    if (!this.baseDb) return new Map();
    try {
      return readDependentCounts(this.baseDb);
    } catch {
      return new Map();
    }
  }

  /**
   * See `VectorDBInterface.hasDependentCounts`. Mirrors the two branches of
   * `composedDependentCounts` exactly, because the only sound honesty answer is
   * "whatever the read path this response was actually served from can prove".
   *
   * - Composed flag set → the overlay table alone is the whole truth, and the
   *   flag is direct proof a composition ran over THIS worktree's corpus.
   * - Flag absent → `composedDependentCounts` serves the BASE's counts, so the
   *   honest answer is whatever the base store can prove about its own table.
   *
   * #1085 is what happens when this method answers about one of the two
   * on-disk locations instead of the composition: keyed on the overlay's flag
   * alone, a fresh linked worktree — every agent session in this repo's own
   * fleet — got the "this index predates reverse-dependency counting" note and
   * had 100% of its `dependentCount`s dropped, *while the base's counts were
   * ranking the very results in that response*. The note and the ordering
   * cannot both be right, and the base's `dependentCountsComputed|1` says which
   * one was. Checking one location rather than the composition is the
   * #1050/#1051 shape; keeping the two in one place is how it stops recurring.
   *
   * Not the reasoning review rightly rejected on #1078. That was
   * `composedDependentCounts().size > 0` — the size of the MERGED map, which is
   * no evidence at all, since a merge can resurrect a base count for a file
   * whose last importer this worktree masked. This asks the BASE store whether
   * IT computed counts over ITS corpus, via the same `hasComputedDependentCounts`
   * predicate `SqliteBackend` uses, and the base corpus is precisely the corpus
   * those merged numbers describe. The resurrection hazard is real but it is
   * staleness, which is #1072's case 4: an accepted trade for a soft ranking
   * tie-breaker, documented on the field, deliberately not caveated — and
   * suppressing every count does not fix it, it just also lies about why.
   *
   * Read-free in the common case: one small meta lookup on the overlay, then at
   * most one on the base. Only a base whose schema predates the flag (0.75.4)
   * costs a count-table scan, and `getDependentCounts` caches that per handle.
   */
  async hasDependentCounts(): Promise<boolean> {
    if (this.getMeta(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED) !== null) return true;
    return this.baseDb !== null && hasComputedDependentCounts(this.baseDb);
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    // One corpus-wide count map for BOTH corpora — see composedDependentCounts.
    const counts = this.composedDependentCounts();
    // RankedResult, not SearchResult -- mergeRankedHits needs the raw ratio
    // each hit was scored with, not the rounded public `score` (see its doc
    // comment for why reconstructing from `score` is unsound).
    const { overlayHits, mask } = this.overlaySnapshot(db => ({
      overlayHits: keywordSearchRanked(db, query, limit, counts),
      mask: this.loadMask(),
    }));
    const baseHits = this.baseRead(db => keywordSearchRanked(db, query, limit, counts)).filter(
      h => !mask.has(h.metadata.file),
    );
    // BM25 ranks are corpus-relative; merging two corpora yields an approximate
    // global order (documented v1 caveat).
    return mergeRankedHits(overlayHits, baseHits, limit);
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

  /**
   * Effective indexed-file view: overlay-tracked files (added + modified —
   * a modified file is masked out of the base AND written into the overlay,
   * see `buildOverlay`) UNION un-masked base files. A masked base file with
   * no overlay replacement (a real deletion in this worktree) is correctly
   * excluded from both sides — the file no longer exists here, so reporting
   * it as unindexed is the right call, not a false positive.
   *
   * That last guarantee depends on the overlay's own manifest never holding
   * a STALE entry for a file that used to be diverged (modified/added) but
   * no longer is — e.g. modified, then deleted, or modified back to match
   * base. `buildOverlay` maintains this by reconciling the overlay manifest
   * (removing entries outside the current diverged set, not just merging
   * new ones in) on every build that changes the overlay's content; if that
   * reconciliation is ever dropped, a modify-then-delete file would resurface
   * here as falsely "indexed" via the overlay side of the union.
   *
   * This is what `findUnindexedPaths` (get_dependents/get_complexity/
   * get_files_context's "not found in the index" diagnostic) must consult
   * instead of the overlay's own manifest alone — see #1014.
   */
  async getIndexedFiles(): Promise<string[]> {
    const overlayFiles = await new ManifestManager(this.dbPath).getIndexedFiles();
    const mask = this.loadMask();
    const baseFiles = [...this.baseHashes.keys()].filter(f => !mask.has(f));
    return [...new Set([...overlayFiles, ...baseFiles])];
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

    if (changed) {
      // Derived-data refresh belongs with the swap that invalidates it, not with
      // the caller: `buildOverlay` should not have to remember that a content
      // change makes the ranking counts stale (#1071). Deliberately AFTER the
      // commit rather than inside the swap transaction -- the swap must stay the
      // minimal all-or-nothing content exchange, and a stale count is a soft
      // ranking imprecision, not a corpus inconsistency.
      this.refreshDependentCountsSync();
      this.reclaimSpace();
    }
    return { changed };
  }

  /**
   * Compose this overlay's `dependent_counts` if, and only if, it never has
   * (#1084) — the worktree counterpart of the indexer's
   * `backfillDependentCounts` for a standalone store. Returns whether it did
   * any work, so a caller can bump the version stamp exactly when there is
   * something new for a live `lien serve` to reconnect for.
   *
   * Needed because the one existing trigger never reaches an overlay whose
   * content is already correct: `applyRebuild` refreshes on a real swap, and
   * `buildOverlay` returns before calling it at all when the signature already
   * matches. An overlay built by a version predating the composed map therefore
   * had no path to one, so `lien index` — the remedy #1072's note prints — could
   * not complete the migration. This is what makes that note's promise true.
   *
   * Called from `performOverlayIndex` rather than from inside `buildOverlay`'s
   * fast path, which is where it would otherwise belong: `buildOverlay` is
   * already over its cognitive-complexity budget, and #1073 had to relocate a
   * call out of that same file for the same reason (the review gate counts
   * ABSOLUTE violations in touched files, not deltas).
   *
   * Gated on the stored flag, never on the table looking empty: a composed corpus
   * whose every count is legitimately 0 must not be recomposed forever, and
   * (per `composedDependentCounts`) an empty overlay table is also how a real
   * all-zero composition is stored.
   */
  backfillDependentCounts(): boolean {
    if (this.getMeta(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED) !== null) return false;
    try {
      this.refreshDependentCountsSync();
    } catch (error) {
      // A peer `lien serve` on this worktree holds the write lock; its own
      // backfill serves us. Busy-skip rather than fail the index run, exactly as
      // `applyRebuild` does — piled-up serves on one worktree are a documented
      // reality here, and this is a soft ranking tie-breaker.
      if (isSqliteBusy(error)) return false;
      throw error;
    }
    return true;
  }

  /**
   * Recompute the overlay's `dependent_counts` table over the COMPOSED corpus
   * (#1071): `unionRecords(readAllRecords)` is `(base − masked) ∪ overlay`, the
   * exact set every read path here serves. Writing base-derived counts into the
   * overlay table is correct precisely because the base store is opened
   * read-only and can never be written from a worktree — the overlay is the only
   * place a composed answer can live.
   *
   * Runs after `applyRebuild`, outside its swap transaction: the swap must stay
   * the minimal all-or-nothing content exchange, and a stale count is a soft
   * ranking imprecision, not a corpus inconsistency.
   */
  async refreshDependentCounts(): Promise<void> {
    this.refreshDependentCountsSync();
  }

  /**
   * The actual work behind `refreshDependentCounts`, synchronous so
   * `applyRebuild` (which is sync, and is the point at which the counts become
   * stale) can call it directly.
   */
  private refreshDependentCountsSync(): void {
    const chunks = this.unionRecords(readAllRecords).map(recordToUnscoredResult);
    refreshOverlayDependentCounts(this.requireOverlay(), chunks, this.worktreeRoot);
    // Marks the overlay table authoritative from here on — see
    // `composedDependentCounts` for why presence-of-flag and not non-emptiness.
    this.setMeta(OVERLAY_META.DEPENDENT_COUNTS_COMPOSED, '1');
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

  /**
   * Reconnect WITHOUT ever leaving `overlayDb`/`baseDb` null OR closed-but-
   * still-referenced: build the new overlay connection first, swap it in,
   * and only THEN close the retired ones — and only on the success path.
   * Same rationale as `SqliteBackend.reconnect()` — `checkAndReconnect` runs
   * this on the shared instance concurrent tool handlers use, so both
   * failure modes are user-visible, not internal bookkeeping:
   *  - close-then-open (the original bug): a null window where
   *    `requireOverlay()` throws "Overlay database not initialized".
   *  - closing the old handles unconditionally in a `finally` (a regression
   *    introduced while fixing the first one): when opening the new overlay
   *    connection itself throws — e.g. the retry ladder in `withOpenRetry`
   *    is exhausted — the swap below never runs, so `oldOverlayDb`/
   *    `oldBaseDb` still ARE `this.overlayDb`/`this.baseDb`. Closing them
   *    anyway poisons both for the rest of the process instead of leaving
   *    the still-valid old connections in place. The fix: the closes only
   *    happen after `this.overlayDb = newOverlayDb` — i.e. only once the
   *    new connection has actually taken over.
   */
  async reconnect(): Promise<void> {
    const oldOverlayDb = this.overlayDb;
    const oldBaseDb = this.baseDb;
    let newOverlayDb: DatabaseType.Database;
    try {
      await fs.mkdir(this.dbPath, { recursive: true });
      newOverlayDb = await withOpenRetry(() => openOverlayDatabase(this.overlayDbFilePath));
    } catch (error) {
      // Opening the new overlay connection failed (including an exhausted
      // withOpenRetry ladder) — `this.overlayDb`/`this.baseDb` are
      // untouched, still the valid old connections.
      throw wrapError(error, 'Failed to reconnect to overlay database');
    }

    this.overlayDb = newOverlayDb;
    this.openBase(); // sets this.baseDb directly; own try/catch, non-fatal
    this.baseHashes = await this.loadBaseHashes();
    this.currentVersion = await readVersionFile(this.dbPath);

    // Only reachable once the swap above succeeded, so the old handles are
    // genuinely retired — safe to close.
    try {
      oldOverlayDb?.close();
    } catch {
      // Best-effort: already swapped away.
    }
    try {
      oldBaseDb?.close();
    } catch {
      // Best-effort: already swapped away.
    }
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  getVersionDate(): string {
    if (this.currentVersion === 0) return 'Unknown';
    return new Date(this.currentVersion).toLocaleString();
  }
}
