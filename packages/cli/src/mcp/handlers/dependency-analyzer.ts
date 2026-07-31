import type { SearchResult, VectorDBInterface } from '@liendev/core';
import {
  findDependents as findDependentsFromChunks,
  type FindDependentsResult,
} from '@liendev/parser';

export type { ComplexityMetrics, DependentInfo, SymbolUsage } from '@liendev/parser';

/**
 * The CLI's instantiation of `@liendev/parser`'s generic
 * `FindDependentsResult<T>` at `T = SearchResult` -- the richer chunk shape
 * `vectorDB.scanAll()` returns. See that type's doc comment for why a plain
 * `CodeChunk` is enough for the analysis itself (the `SearchResult`-only
 * fields, `score`/`relevance`, are never read by `findDependents`).
 */
export type DependencyAnalysisResult = FindDependentsResult<SearchResult>;

/**
 * Cached raw chunk scan, to avoid re-fetching from the vectorDB when the
 * index hasn't changed. Keyed by indexVersion — when the index is rebuilt,
 * the version changes and the cache is invalidated automatically.
 *
 * Deliberately holds only the raw scan result, not a pre-built import index:
 * `@liendev/parser`'s `findDependents` builds its own index from whatever
 * chunks it's given (the same style as its `analyzeDependencies` sibling),
 * so this cache's only job is "don't hit the vectorDB again for the same
 * indexVersion" -- the (cheap, in-memory) index build itself runs once per
 * `findDependents` call either way.
 */
let scanCache: { indexVersion: number; chunks: SearchResult[] } | null = null;

/**
 * Clear the dependency scan cache. Exported for testing.
 */
export function clearDependencyCache(): void {
  scanCache = null;
}

/**
 * Get chunks from cache, or fetch a fresh full scan from the vectorDB.
 *
 * Uses `scanAll()` rather than `scanPaginated()` deliberately: offset-based
 * paging cost is O(N²) in chunk count, and a single full-table read is
 * ~24x faster on monorepo-scale indexes (5.3s -> 217ms locally). Memory is
 * unchanged in practice -- every chunk ends up accumulated into JS-side
 * maps downstream regardless.
 */
async function getOrScanChunks(
  vectorDB: VectorDBInterface,
  log: (message: string, level?: 'warning') => void,
  indexVersion?: number,
): Promise<SearchResult[]> {
  if (indexVersion !== undefined && scanCache !== null && scanCache.indexVersion === indexVersion) {
    log(`Using cached chunk scan (${scanCache.chunks.length} chunks, version ${indexVersion})`);
    return scanCache.chunks;
  }

  const chunks = await vectorDB.scanAll();
  if (indexVersion !== undefined) {
    scanCache = { indexVersion, chunks };
  }
  log(`Scanned ${chunks.length} chunks for imports...`);
  return chunks;
}

/**
 * Find all files that depend on a target file, including transitive
 * dependents through re-export chains, optionally tracking usages of a
 * specific symbol. Thin vectorDB-backed wrapper over `@liendev/parser`'s
 * `findDependents` -- see that function's doc comment for the actual
 * algorithm (import-graph BFS, re-export resolution, C# type-reference
 * recovery, complexity metrics, and the honesty-caveat flags on the
 * result). This wrapper's only jobs are: fetch (and cache) the chunk set
 * from the vectorDB via `getOrScanChunks`, and hand it to the parser's
 * pure, chunk-based engine.
 */
export async function findDependents(
  vectorDB: VectorDBInterface,
  filepath: string,
  log: (message: string, level?: 'warning') => void,
  symbol?: string,
  indexVersion?: number,
  depth: number = 1,
  maxNodes: number = 500,
  /**
   * Surface the full normalized chunk set on the result.
   * Callers opt in by passing `true` only if they need the chunks
   * (e.g., the annotator for test-association + complexity lookups).
   * Default `false` keeps memory cost down for the common MCP path.
   */
  includeAllChunks: boolean = false,
): Promise<DependencyAnalysisResult> {
  const chunks = await getOrScanChunks(vectorDB, log, indexVersion);
  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  return findDependentsFromChunks(
    chunks,
    filepath,
    log,
    workspaceRoot,
    symbol,
    depth,
    maxNodes,
    includeAllChunks,
  );
}
