import type { ChunkMetadata } from '@liendev/parser';
import type { RelevanceCategory } from './relevance.js';

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata & {
    /**
     * How many other indexed files import this chunk's file — a structural
     * ranking signal (see vectordb/sqlite/dependent-counts.ts). Resolved with
     * the same guarded `importMatchesTarget` decision `get_dependents` makes
     * (#1071), but still NOT the authoritative `get_dependents` count: it is
     * file-level only and does not follow re-export/barrel chains, so it is a
     * FLOOR.
     *
     * Two staleness properties a consumer must know, because neither is visible
     * in the value itself:
     * - It is read from the precomputed `dependent_counts` table, refreshed by a
     *   full index run (and an overlay rebuild), NOT by every incremental
     *   single-file update. So a count can lag the working tree by at most one
     *   full index run — an accepted trade for a soft ranking tie-breaker, see
     *   dependent-counts.ts's "Freshness contract".
     * - An index written before that table existed has no rows, so every count
     *   reads 0. A uniformly-zero corpus therefore means "stale index" at least
     *   as often as it means "nothing imports anything". Ask
     *   `hasDependentCounts()` rather than inferring it from the zeros — that
     *   inference is unsound for a corpus whose counts are legitimately all 0.
     *
     * Consequently a `0` means "no import edge resolved", never a verified
     * "nothing depends on this". This type keeps the raw number in both cases;
     * distinguishing them for a consumer is the MCP layer's job (#1072), and
     * `search_code` now omits the field outright where it cannot be resolved —
     * see `mcp/utils/dependent-count-honesty.ts` in the cli package.
     *
     * Only populated by the FTS `search` path today; other VectorDBInterface
     * methods (scanAll, querySymbols, ...) leave it undefined.
     */
    dependentCount?: number;
  };
  /**
   * Search score. For lexical `search`, a BM25-derived value where lower
   * means a better match. For scroll/scan operations (scanWithFilter, scanAll,
   * querySymbols) this is always 0 because no scoring is performed.
   */
  score: number;
  /**
   * Relevance category derived from the score. For scroll/scan operations that
   * do not compute scores this is always 'not_relevant' to indicate the
   * results are unscored rather than irrelevant.
   */
  relevance: RelevanceCategory;
}

/** Maps symbolType filter values to the set of matching record types */
export const SYMBOL_TYPE_MATCHES: Record<string, Set<string>> = {
  function: new Set(['function', 'method']),
  method: new Set(['method']),
  class: new Set(['class']),
  interface: new Set(['interface']),
};

export interface VectorDBInterface {
  /** Path to local storage (used for manifest and version files) */
  readonly dbPath: string;
  initialize(): Promise<void>;
  insertBatch(metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  /** Lexical (FTS5/BM25) full-text search over the query string. */
  search(query: string, limit?: number): Promise<SearchResult[]>;
  scanWithFilter(options: {
    file?: string | string[];
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  scanAll(options?: { language?: string; pattern?: string }): Promise<SearchResult[]>;
  querySymbols(options: {
    language?: string;
    pattern?: string;
    symbolType?: 'function' | 'method' | 'class' | 'interface';
    limit?: number;
  }): Promise<SearchResult[]>;
  clear(): Promise<void>;
  deleteByFile(filepath: string): Promise<void>;
  updateFile(filepath: string, metadatas: ChunkMetadata[], contents: string[]): Promise<void>;
  hasData(): Promise<boolean>;
  checkVersion(): Promise<boolean>;
  /** Scan all chunks using paginated iteration. Yields pages to avoid loading everything into memory. */
  scanPaginated(options?: { pageSize?: number }): AsyncGenerator<SearchResult[]>;
  reconnect(): Promise<void>;
  getCurrentVersion(): number;
  getVersionDate(): string;
  /** True for the worktree overlay backend (shared read-only base + writable
   *  overlay). Lets the indexer route to the overlay build instead of a full
   *  reindex of the worktree. */
  readonly isOverlay: boolean;
  /**
   * Relative file paths this backend currently considers indexed — the
   * source of truth for "is this path known to the index at all" existence
   * checks (see `findUnindexedPaths` in the MCP layer, which drives the
   * `get_dependents`/`get_complexity`/`get_files_context` unindexed-path
   * caveat).
   *
   * For `SqliteBackend` this is just its own manifest. For `OverlayBackend`
   * it is deliberately NOT a plain union of the base and overlay manifests:
   * reads there are base (minus masked base files) UNION overlay, so this
   * must mirror that same masking to stay correct — see
   * `OverlayBackend.getIndexedFiles()`.
   */
  getIndexedFiles(): Promise<string[]>;
  /**
   * Recompute and persist the per-file reverse-dependency counts that feed
   * `search_code`'s structural ranking boost (#1071). Whole-corpus and
   * whole-table: a file's count depends on every other file's imports, so
   * there is no correct patch for a subset — see
   * `sqlite/dependent-counts.ts`'s module doc.
   *
   * Called at the end of a full index run and after an overlay rebuild, NOT on
   * every incremental single-file update; the counts are a soft ranking
   * tie-breaker with an explicit "lags by at most one full index" contract.
   *
   * `OverlayBackend` computes over the composed `(base − masked) ∪ overlay`
   * corpus, never the overlay alone.
   */
  refreshDependentCounts(): Promise<void>;
  /**
   * True when the `dependentCount` values this backend serves were actually
   * computed over its corpus, so a `0` means "no import edge resolved for this
   * file" (#1072). False when they were never computed here at all — an index
   * written before `refreshDependentCounts` existed — in which case every count
   * reads 0 for a reason that has nothing to do with the code.
   *
   * Deliberately NOT derivable from the counts themselves: a corpus whose every
   * count is legitimately 0 (Swift's whole-module imports name no file, so no
   * edge resolves anywhere) is indistinguishable from "never computed" on the
   * numbers alone. That is the distinction #1014 got wrong in the other
   * direction, so this is answered from stored state, never from result shape.
   */
  hasDependentCounts(): Promise<boolean>;
}
