import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetFilesContextSchema } from '../schemas/index.js';
import { shapeResults, deduplicateResults } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import {
  normalizePath,
  matchesFile,
  getCanonicalPath,
  isTestFile,
  MAX_CHUNKS_PER_FILE,
  DEFAULT_COMPLEXITY_DELTA_THRESHOLDS,
} from '@liendev/parser';
import type { SearchResult, VectorDBInterface } from '@liendev/core';

// ============================================================================
// Types
// ============================================================================

/** Validated input from schema (after Zod defaults applied) */
interface ValidatedArgs {
  filepaths: string | string[];
  includeRelated?: boolean;
}

/** Context for helper functions (subset of ToolContext) */
interface HandlerContext {
  vectorDB: VectorDBInterface;
  log: LogFn;
  workspaceRoot: string;
}

/** A single near-or-over-budget function, as surfaced to the agent. */
export interface ComplexityHeadroomEntry {
  symbol: string;
  metric: 'cyclomatic' | 'cognitive';
  value: number;
  threshold: number;
}

/** File data with chunks, test associations, and complexity headroom. */
interface FileData {
  chunks: SearchResult[];
  testAssociations: string[];
  /** Functions at >= 80% of a threshold, worst-first, capped. May be empty. */
  headroom: ComplexityHeadroomEntry[];
  /** Count of near/over-budget functions beyond the capped list. */
  headroomOverflow: number;
}

/** Path cache for normalized path lookups */
type PathCache = Map<string, string>;

// ============================================================================
// Test-Association Scan Cache
// ============================================================================

/**
 * Cached full-table scan results used for test-association lookups, keyed
 * by indexVersion. Mirrors the `scanCache` pattern in dependency-analyzer.ts:
 * a module-level cache invalidated whenever the index is rebuilt (the
 * indexVersion signal changes), so repeated get_files_context calls within
 * one session skip the full-table scan when nothing has changed.
 *
 * Implemented as a small parallel cache rather than sharing
 * dependency-analyzer's `scanCache` directly — that cache stores a much
 * richer shape (an import index plus a per-file chunk map built for BFS
 * dependency walks) that this handler doesn't need; it only reads the flat
 * chunk list that `findTestAssociations` consumes.
 */
let testAssociationScanCache: {
  indexVersion: number;
  chunks: SearchResult[];
} | null = null;

/**
 * Clear the test-association scan cache. Exported for testing.
 */
export function clearTestAssociationScanCache(): void {
  testAssociationScanCache = null;
}

/**
 * Scan all chunks for test-association analysis, using the indexVersion-keyed
 * cache when available.
 *
 * Uses `scanAll` (a direct full-table read) instead of `scanWithFilter` with
 * no file filter, and caches the result by indexVersion so repeated
 * get_files_context calls within one session skip the scan when nothing has
 * changed.
 */
async function getOrScanAllChunksForTestAssociations(
  vectorDB: VectorDBInterface,
  indexVersion: number | undefined,
  log: LogFn,
): Promise<SearchResult[]> {
  if (
    indexVersion !== undefined &&
    testAssociationScanCache !== null &&
    testAssociationScanCache.indexVersion === indexVersion
  ) {
    log(`Using cached chunk scan for test associations (version ${indexVersion})`);
    return testAssociationScanCache.chunks;
  }

  const chunks = await vectorDB.scanAll();

  if (indexVersion !== undefined) {
    testAssociationScanCache = { indexVersion, chunks };
  }

  log(`Scanned ${chunks.length} chunks for test associations`);
  return chunks;
}

// ============================================================================
// Helper Functions (Exported for Testing)
// ============================================================================

/**
 * Search for chunks belonging to specific files.
 *
 * Uses direct file path filtering via scanWithFilter to reliably
 * retrieve all indexed chunks for the target files, avoiding the
 * previous embedding-based approach which could miss chunks when
 * file content wasn't semantically similar to the filepath string.
 *
 * @param filepaths - Array of file paths to search for
 * @param ctx - Handler context with vectorDB and embeddings
 * @returns Array of chunk arrays, one per filepath
 */
export async function searchFileChunks(
  filepaths: string[],
  ctx: HandlerContext,
): Promise<SearchResult[][]> {
  const { vectorDB, workspaceRoot } = ctx;

  // Query all chunks for all files in a single scan
  const allResults = await vectorDB.scanWithFilter({
    file: filepaths,
    limit: filepaths.length * MAX_CHUNKS_PER_FILE,
  });

  // Group results by target file using canonical path matching
  return filepaths.map(filepath => {
    const targetCanonical = getCanonicalPath(filepath, workspaceRoot);
    return allResults.filter(r => {
      const chunkCanonical = getCanonicalPath(r.metadata.file, workspaceRoot);
      return chunkCanonical === targetCanonical;
    });
  });
}

/**
 * Find related chunks for files based on lexical similarity.
 *
 * Runs an FTS5 keyword search using the first chunk of each file as the query
 * text, surfacing lexically similar code in other files.
 *
 * @param filepaths - Array of file paths
 * @param fileChunksMap - Chunks already found for each file
 * @param ctx - Handler context
 * @returns Map of filepath index to related chunks
 */
export async function findRelatedChunks(
  filepaths: string[],
  fileChunksMap: SearchResult[][],
  ctx: HandlerContext,
): Promise<SearchResult[][]> {
  const { vectorDB, workspaceRoot } = ctx;

  // Get files that have chunks (need first chunk for related search)
  const filesWithChunks = fileChunksMap
    .map((chunks, i) => ({ chunks, filepath: filepaths[i], index: i }))
    .filter(({ chunks }) => chunks.length > 0);

  if (filesWithChunks.length === 0) {
    return Array.from({ length: filepaths.length }, () => []);
  }

  // Batch all related chunk searches (lexical FTS5 on each first chunk's text)
  const relatedSearches = await Promise.all(
    filesWithChunks.map(({ chunks }) => vectorDB.search(chunks[0].content, 5)),
  );

  // Map back to original indices
  const relatedChunksMap: SearchResult[][] = Array.from({ length: filepaths.length }, () => []);

  filesWithChunks.forEach(({ filepath, index }, i) => {
    const related = relatedSearches[i];
    const targetCanonical = getCanonicalPath(filepath, workspaceRoot);

    // Filter out chunks from the same file and markdown files
    relatedChunksMap[index] = related.filter(r => {
      const chunkCanonical = getCanonicalPath(r.metadata.file, workspaceRoot);
      if (chunkCanonical === targetCanonical) return false;
      if (r.metadata.language === 'markdown') return false;
      return true;
    });
  });

  return relatedChunksMap;
}

/**
 * Create a cached path normalizer.
 *
 * Returns a function that normalizes paths with caching
 * to avoid repeated string operations.
 *
 * @param workspaceRoot - Workspace root directory
 * @returns Cached normalizer function and the cache
 */
export function createPathCache(workspaceRoot: string): {
  normalize: (path: string) => string;
  cache: PathCache;
} {
  const cache: PathCache = new Map();

  const normalize = (path: string): string => {
    if (cache.has(path)) return cache.get(path)!;
    const normalized = normalizePath(path, workspaceRoot);
    cache.set(path, normalized);
    return normalized;
  };

  return { normalize, cache };
}

/**
 * Find test files that import the given source files.
 *
 * Scans all indexed chunks to find test files that have import
 * statements matching the target files.
 *
 * @param filepaths - Array of source file paths
 * @param allChunks - All chunks from the vector database
 * @param ctx - Handler context
 * @returns Map of filepath index to array of test file paths
 */
export function findTestAssociations(
  filepaths: string[],
  allChunks: Array<{ metadata: { file: string; imports?: string[] } }>,
  ctx: HandlerContext,
): string[][] {
  const { workspaceRoot } = ctx;
  const { normalize } = createPathCache(workspaceRoot);

  return filepaths.map(filepath => {
    const normalizedTarget = normalize(filepath);
    const testFiles = new Set<string>();

    for (const chunk of allChunks) {
      const chunkFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);

      // Skip if not a test file
      if (!isTestFile(chunkFile)) continue;

      // Check if this test file imports the target
      const imports = chunk.metadata.imports || [];
      for (const imp of imports) {
        const normalizedImport = normalize(imp);
        if (matchesFile(normalizedImport, normalizedTarget)) {
          testFiles.add(chunkFile);
          break;
        }
      }
    }

    return Array.from(testFiles);
  });
}

// ============================================================================
// Complexity headroom (Mechanism 3 — prevention)
// ============================================================================

/** A function is "near budget" once it reaches this fraction of a threshold. */
const NEAR_BUDGET_RATIO = 0.8;
/** Cap the per-file headroom list so the payload stays lean. */
const MAX_HEADROOM_PER_FILE = 5;
/**
 * Cap on how many entries the human-readable WARNING LINE renders — tighter
 * than `MAX_HEADROOM_PER_FILE` (5, the data-level cap on the `complexityHeadroom`
 * array). A dogfood run surfaced a real 5-entry file rendering as a ~250-char
 * line; readability degrades past 3-4 entries, so the string caps at the 3
 * worst and names the rest instead of silently dropping them. The full,
 * uncapped list still round-trips via `complexityHeadroom` — only the string
 * is capped.
 */
const MAX_RENDERED_HEADROOM_ENTRIES = 3;

/**
 * The metrics surfaced as headroom. Deliberately just cyclomatic + cognitive —
 * the integer, intuitive, agent-actionable ones (and the pair `--threshold`
 * tunes). Halstead is left out to keep the payload lean; the write-time
 * `lien delta` gate still scores all four. Thresholds are the delta primitive's
 * defaults (handler stays zero-I/O; it does not load per-project config).
 */
const HEADROOM_METRICS: ReadonlyArray<{
  metric: ComplexityHeadroomEntry['metric'];
  value: (m: SearchResult['metadata']) => number | undefined;
  threshold: number;
}> = [
  {
    metric: 'cyclomatic',
    value: m => m.complexity,
    threshold: DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.testPaths,
  },
  {
    metric: 'cognitive',
    value: m => m.cognitiveComplexity,
    threshold: DEFAULT_COMPLEXITY_DELTA_THRESHOLDS.mentalLoad,
  },
];

/**
 * Minimal chunk shape the headroom computation needs: just the metadata,
 * not the full `SearchResult` (score/relevance are irrelevant here). Accepts
 * `SearchResult[]` (the MCP path, via the index) and `@liendev/parser`'s
 * `CodeChunk[]` (the CLI `annotate` path, via `findDependents`) alike, so both
 * callers share this one computation — see `annotate-cmd.ts`.
 */
export type HeadroomInputChunk = { metadata: SearchResult['metadata'] };

/**
 * Compute the complexity headroom for a file from its already-fetched chunks.
 *
 * No re-parse: cyclomatic/cognitive metrics are stored per chunk in the index
 * and are carried on chunk metadata. For each function/method at >= 80% of a
 * threshold, emit its single worst metric (highest value/threshold ratio) —
 * one entry per function, never two. Sorted worst-first and capped at
 * MAX_HEADROOM_PER_FILE, with an overflow count for the remainder.
 */
export function computeComplexityHeadroom(chunks: readonly HeadroomInputChunk[]): {
  entries: ComplexityHeadroomEntry[];
  overflow: number;
} {
  const bySymbol = new Map<string, ComplexityHeadroomEntry & { ratio: number }>();

  for (const { metadata: m } of chunks) {
    if (m.symbolType !== 'function' && m.symbolType !== 'method') continue;
    if (!m.symbolName) continue;
    const symbol = m.parentClass ? `${m.parentClass}.${m.symbolName}` : m.symbolName;

    let best: (ComplexityHeadroomEntry & { ratio: number }) | null = null;
    for (const spec of HEADROOM_METRICS) {
      const value = spec.value(m);
      // Skip non-finite values explicitly (mirrors fmtValue's display guard):
      // NaN would slip past the `ratio < NEAR_BUDGET_RATIO` skip (NaN
      // comparisons are false) and Infinity would pass it outright — either
      // would leak a nonsensical value into the MCP payload.
      if (value === undefined || !Number.isFinite(value) || spec.threshold <= 0) continue;
      const ratio = value / spec.threshold;
      if (ratio < NEAR_BUDGET_RATIO) continue;
      if (!best || ratio > best.ratio) {
        best = { symbol, metric: spec.metric, value, threshold: spec.threshold, ratio };
      }
    }
    if (!best) continue;

    // A function normally maps to one chunk; if it somehow appears twice, keep
    // the worst reading.
    const existing = bySymbol.get(symbol);
    if (!existing || best.ratio > existing.ratio) bySymbol.set(symbol, best);
  }

  const sorted = [...bySymbol.values()].sort((a, b) => b.ratio - a.ratio);
  const entries = sorted
    .slice(0, MAX_HEADROOM_PER_FILE)
    // Drop the internal ratio — keep the payload minimal.
    .map(({ symbol, metric, value, threshold }) => ({ symbol, metric, value, threshold }));
  const overflow = Math.max(0, sorted.length - MAX_HEADROOM_PER_FILE);

  return { entries, overflow };
}

/**
 * Render headroom entries as one imperative, agent-actionable warning line —
 * the plan-time nudge. `computeComplexityHeadroom` only produces data; this is
 * the "make it unmissable" step, shared by the `get_files_context` response
 * (`complexityHeadroomWarning`) and the CLI `annotate` command (which leads
 * its printed annotation with this same line — see `annotate-cmd.ts`).
 *
 * Renders at most `MAX_RENDERED_HEADROOM_ENTRIES` (the 3 worst), re-sorted
 * defensively by overage ratio (value/threshold) rather than trusting caller
 * order — over-threshold entries (ratio >= 1) always sort ahead of merely-near
 * ones, so a rendered entry is never bumped by a less-severe one. Anything cut
 * from the render — both entries beyond the top 3 and the pre-existing
 * `overflow` count beyond `computeComplexityHeadroom`'s own cap — is folded
 * into one explicit "… and N more at/near budget" remainder; nothing is
 * silently dropped.
 *
 * Returns `undefined` when there's nothing to warn about, so callers can
 * `if (warning)` rather than checking `entries.length` themselves.
 */
export function formatComplexityHeadroomWarning(
  entries: ComplexityHeadroomEntry[],
  overflow = 0,
): string | undefined {
  if (entries.length === 0) return undefined;
  const sorted = [...entries].sort((a, b) => b.value / b.threshold - a.value / a.threshold);
  const rendered = sorted.slice(0, MAX_RENDERED_HEADROOM_ENTRIES);
  const parts = rendered.map(
    e =>
      `${e.symbol} ${e.metric} ${e.value}/${e.threshold}${e.value >= e.threshold ? ' (over)' : ''}`,
  );
  const remainder = entries.length - rendered.length + overflow;
  const more = remainder > 0 ? `, … and ${remainder} more at/near budget` : '';
  return `⚠ Lien: ${parts.join(', ')}${more} — avoid adding complexity here; prefer extraction.`;
}

/**
 * Deduplicate chunks by file path and line range.
 *
 * Combines file chunks and related chunks, removing duplicates.
 * Delegates to the shared deduplicateResults utility.
 *
 * @param fileChunks - Primary chunks for the file
 * @param relatedChunks - Related chunks from other files
 * @returns Deduplicated array of chunks
 */
export function deduplicateChunks(
  fileChunks: SearchResult[],
  relatedChunks: SearchResult[],
): SearchResult[] {
  return deduplicateResults([...fileChunks, ...relatedChunks]);
}

/**
 * Build file data map with chunks and test associations.
 *
 * Combines results from chunk search, related chunks search,
 * and test association analysis into a single data structure.
 *
 * @param filepaths - Array of file paths
 * @param fileChunksMap - Chunks for each file
 * @param relatedChunksMap - Related chunks for each file
 * @param testAssociationsMap - Test associations for each file
 * @param workspaceRoot - Workspace root for path canonicalization
 * @returns Map of filepath to file data
 */
export function buildFilesData(
  filepaths: string[],
  fileChunksMap: SearchResult[][],
  relatedChunksMap: SearchResult[][],
  testAssociationsMap: string[][],
): Record<string, FileData> {
  const filesData: Record<string, FileData> = {};

  filepaths.forEach((filepath, i) => {
    const dedupedChunks = deduplicateChunks(fileChunksMap[i], relatedChunksMap[i] || []);
    // Headroom is computed from the file's OWN chunks (fileChunksMap[i]), not the
    // deduped set — related chunks belong to other files and must not leak into
    // this file's budget view.
    const { entries, overflow } = computeComplexityHeadroom(fileChunksMap[i]);

    filesData[filepath] = {
      chunks: dedupedChunks,
      testAssociations: testAssociationsMap[i],
      headroom: entries,
      headroomOverflow: overflow,
    };
  });

  return filesData;
}

/** Index metadata shape from context */
interface IndexInfo {
  indexVersion: number;
  indexDate: string;
}

/**
 * Build response for single file request.
 */
function buildSingleFileResponse(
  filepath: string,
  filesData: Record<string, FileData>,
  indexInfo: IndexInfo,
  note?: string,
) {
  const data = filesData[filepath];
  return {
    indexInfo,
    file: filepath,
    chunks: shapeResults(data.chunks, 'get_files_context'),
    testAssociations: data.testAssociations,
    // Omit entirely when nothing is near budget (the common case → zero bytes).
    // The warning field is spread first so it's the first thing the agent
    // reads in the serialized JSON — the imperative nudge, not just data.
    ...(data.headroom.length > 0 && {
      complexityHeadroomWarning: formatComplexityHeadroomWarning(
        data.headroom,
        data.headroomOverflow,
      ),
    }),
    ...(data.headroom.length > 0 && { complexityHeadroom: data.headroom }),
    ...(data.headroomOverflow > 0 && { complexityHeadroomMore: data.headroomOverflow }),
    ...(note && { note }),
  };
}

/**
 * Build response for multiple files request.
 */
function buildMultiFileResponse(
  filesData: Record<string, FileData>,
  indexInfo: IndexInfo,
  note?: string,
) {
  const shaped: Record<
    string,
    {
      chunks: ReturnType<typeof shapeResults>;
      testAssociations: string[];
      complexityHeadroomWarning?: string;
      complexityHeadroom?: ComplexityHeadroomEntry[];
      complexityHeadroomMore?: number;
    }
  > = {};
  for (const [filepath, data] of Object.entries(filesData)) {
    shaped[filepath] = {
      chunks: shapeResults(data.chunks, 'get_files_context'),
      testAssociations: data.testAssociations,
      ...(data.headroom.length > 0 && {
        complexityHeadroomWarning: formatComplexityHeadroomWarning(
          data.headroom,
          data.headroomOverflow,
        ),
      }),
      ...(data.headroom.length > 0 && { complexityHeadroom: data.headroom }),
      ...(data.headroomOverflow > 0 && { complexityHeadroomMore: data.headroomOverflow }),
    };
  }
  return {
    indexInfo,
    files: shaped,
    ...(note && { note }),
  };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle get_files_context tool calls.
 *
 * Gets context for one or more files including dependencies and test coverage.
 *
 * The implementation is decomposed into focused helper functions:
 * - searchFileChunks: Find chunks belonging to target files
 * - findRelatedChunks: Find semantically similar code in other files
 * - findTestAssociations: Find test files that import the target files
 * - deduplicateChunks: Remove duplicate chunks
 * - buildFilesData: Combine results into response structure
 */
export async function handleGetFilesContext(
  args: unknown,
  ctx: ToolContext,
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(GetFilesContextSchema, async (validatedArgs: ValidatedArgs) => {
    // Normalize input: convert single string to array
    const filepaths = Array.isArray(validatedArgs.filepaths)
      ? validatedArgs.filepaths
      : [validatedArgs.filepaths];

    const isSingleFile = !Array.isArray(validatedArgs.filepaths);

    log(`Getting context for: ${filepaths.join(', ')}`);

    // Check if index has been updated and reconnect if needed
    await checkAndReconnect();

    // Capture index metadata once: used both for the response and as the
    // cache key for the test-association scan below (mirrors get_dependents).
    const indexInfo = getIndexMetadata();

    // Compute workspace root for path matching
    const workspaceRoot = process.cwd().replace(/\\/g, '/');

    // Create handler context for helper functions
    const handlerCtx: HandlerContext = {
      vectorDB,
      log,
      workspaceRoot,
    };

    // Step 1: Search for chunks belonging to each file
    const fileChunksMap = await searchFileChunks(filepaths, handlerCtx);

    // Step 2: Find related chunks if requested (default: true)
    let relatedChunksMap: SearchResult[][] = [];
    if (validatedArgs.includeRelated !== false) {
      relatedChunksMap = await findRelatedChunks(filepaths, fileChunksMap, handlerCtx);
    }

    // Step 3: Scan for test associations. Uses the fast column-projected
    // scanAll path (cached by indexVersion) instead of an unfiltered
    // scanWithFilter, which is ~10x slower on large indexes — see
    // getOrScanAllChunksForTestAssociations for details.
    const allChunks = await getOrScanAllChunksForTestAssociations(
      vectorDB,
      indexInfo.indexVersion,
      log,
    );

    const testAssociationsMap = findTestAssociations(filepaths, allChunks, handlerCtx);

    // Step 4: Build combined file data with deduplication
    const filesData = buildFilesData(
      filepaths,
      fileChunksMap,
      relatedChunksMap,
      testAssociationsMap,
    );

    const totalChunks = Object.values(filesData).reduce((sum, f) => sum + f.chunks.length, 0);
    log(`Found ${totalChunks} total chunks`);

    // Step 5: Build and return response
    return isSingleFile
      ? buildSingleFileResponse(filepaths[0], filesData, indexInfo)
      : buildMultiFileResponse(filesData, indexInfo);
  })(args);
}
