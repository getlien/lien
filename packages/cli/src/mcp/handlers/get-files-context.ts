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
} from '@liendev/parser';
import type { SearchResult, EmbeddingService, VectorDBInterface } from '@liendev/core';
import {
  FILE_CONTEXT_COLUMNS,
  RELATED_CHUNKS_COLUMNS,
  TEST_ASSOCIATIONS_COLUMNS,
} from './columns.js';

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
  embeddings: EmbeddingService;
  log: LogFn;
  workspaceRoot: string;
}

/** File data with chunks and test associations */
interface FileData {
  chunks: SearchResult[];
  testAssociations: string[];
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
 * Uses `scanAll` — a direct column-projected `table.query()` — instead of
 * `scanWithFilter` with no file filter. Without a file filter,
 * `scanWithFilter` routes through a full-table zero-vector ANN search
 * (`table.search(...).where(...)`), which is roughly 10x slower than
 * `scanAll`'s direct scan on large indexes (see the fast-path comment on
 * `scanAll` in packages/core/src/vectordb/query.ts).
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

  const chunks = await vectorDB.scanAll({ columns: TEST_ASSOCIATIONS_COLUMNS });

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
    columns: FILE_CONTEXT_COLUMNS,
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
 * Find related chunks for files based on semantic similarity.
 *
 * Uses the first chunk of each file to find semantically similar code
 * in other files.
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
  const { vectorDB, embeddings, workspaceRoot } = ctx;

  // Get files that have chunks (need first chunk for related search)
  const filesWithChunks = fileChunksMap
    .map((chunks, i) => ({ chunks, filepath: filepaths[i], index: i }))
    .filter(({ chunks }) => chunks.length > 0);

  if (filesWithChunks.length === 0) {
    return Array.from({ length: filepaths.length }, () => []);
  }

  // Batch embedding calls for all first chunks
  const relatedEmbeddings = await Promise.all(
    filesWithChunks.map(({ chunks }) => embeddings.embed(chunks[0].content)),
  );

  // Batch all related chunk searches
  const relatedSearches = await Promise.all(
    relatedEmbeddings.map((embedding, i) =>
      vectorDB.search(embedding, 5, filesWithChunks[i].chunks[0].content, {
        columns: RELATED_CHUNKS_COLUMNS,
      }),
    ),
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

    filesData[filepath] = {
      chunks: dedupedChunks,
      testAssociations: testAssociationsMap[i],
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
    { chunks: ReturnType<typeof shapeResults>; testAssociations: string[] }
  > = {};
  for (const [filepath, data] of Object.entries(filesData)) {
    shaped[filepath] = {
      chunks: shapeResults(data.chunks, 'get_files_context'),
      testAssociations: data.testAssociations,
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
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

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
      embeddings,
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
