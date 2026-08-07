import type { SearchResult, VectorDBInterface } from '@liendev/core';
import {
  findDependents as findDependentsFromChunks,
  buildDependencyGraph,
  type FindDependentsResult,
  type DependencyGraph,
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
 * Cached call-site-level dependency graph (`@liendev/parser`'s
 * `buildDependencyGraph`), keyed by the same `indexVersion` as `scanCache`.
 * Safe to share that key: the graph is a pure function of the identical
 * chunk set `scanCache` already holds, so "index hasn't changed" invalidates
 * both together. Kept as a SEPARATE cache slot (not folded into `scanCache`)
 * because most `findDependents` calls never need it -- function/method
 * symbol queries already get exact call-site attribution from the chunk
 * scan alone. The graph is only built lazily, on demand, by
 * `getOrBuildDependencyGraph` below, for the one consumer that needs it:
 * `get-dependents.ts`'s type-symbol import-only evidence (#1015 fix
 * direction 2).
 */
let graphCache: { indexVersion: number; graph: DependencyGraph } | null = null;

/**
 * Clear the dependency scan and graph caches. Exported for testing.
 */
export function clearDependencyCache(): void {
  scanCache = null;
  graphCache = null;
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
 * Get (or build) the in-memory, call-site-level dependency graph for the
 * current chunk set -- `@liendev/parser`'s `buildDependencyGraph`, cached
 * alongside the raw chunk scan (see `graphCache`'s doc comment above).
 *
 * Reuses `getOrScanChunks` rather than re-fetching from the vectorDB, so a
 * call that misses the graph cache but hits the scan cache still avoids a
 * second `vectorDB.scanAll()`. The build itself (`buildDependencyGraph`'s
 * five-pass algorithm) is O(chunks) and NOT free on a monorepo-scale index,
 * which is exactly why this is a lazy, on-demand cache rather than something
 * `findDependents` above builds unconditionally on every call.
 */
export async function getOrBuildDependencyGraph(
  vectorDB: VectorDBInterface,
  log: (message: string, level?: 'warning') => void,
  indexVersion?: number,
): Promise<DependencyGraph> {
  if (
    indexVersion !== undefined &&
    graphCache !== null &&
    graphCache.indexVersion === indexVersion
  ) {
    return graphCache.graph;
  }

  const chunks = await getOrScanChunks(vectorDB, log, indexVersion);
  const workspaceRoot = process.cwd().replace(/\\/g, '/');
  const graph = buildDependencyGraph(chunks, workspaceRoot);
  if (indexVersion !== undefined) {
    graphCache = { indexVersion, graph };
  }
  return graph;
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
