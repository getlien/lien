import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetFilesContextSchema } from '../schemas/index.js';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '../utils/path-matching.js';
import { shapeResults } from '../utils/metadata-shaper.js';
import type { ToolResult } from '../utils/metadata-shaper.js';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';
import type { SearchResult, LocalEmbeddings, VectorDBInterface } from '@liendev/core';

/**
 * Maximum number of chunks to scan for test association analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

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
  embeddings: LocalEmbeddings;
  log: LogFn;
  workspaceRoot: string;
}

/** File data with chunks and test associations */
interface FileData {
  chunks: SearchResult[] | ToolResult[];
  testAssociations: string[];
}

/** Path cache for normalized path lookups */
type PathCache = Map<string, string>;

// ============================================================================
// Helper Functions (Exported for Testing)
// ============================================================================

/**
 * Search for chunks belonging to specific files.
 * 
 * Batches embedding and search operations for all filepaths at once
 * to reduce latency.
 * 
 * @param filepaths - Array of file paths to search for
 * @param ctx - Handler context with vectorDB and embeddings
 * @returns Map of filepath index to matching chunks
 */
export async function searchFileChunks(
  filepaths: string[],
  ctx: HandlerContext
): Promise<SearchResult[][]> {
  const { vectorDB, embeddings, workspaceRoot } = ctx;
  
  // Batch embedding calls for all filepaths at once
  const fileEmbeddings = await Promise.all(
    filepaths.map(fp => embeddings.embed(fp))
  );

  // Batch all initial file searches in parallel
  const allFileSearches = await Promise.all(
    fileEmbeddings.map((embedding, i) =>
      vectorDB.search(embedding, 50, filepaths[i])
    )
  );

  // Filter results to only include chunks from each target file
  // Use exact matching with getCanonicalPath to avoid false positives
  return filepaths.map((filepath, i) => {
    const allResults = allFileSearches[i];
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
  ctx: HandlerContext
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
    filesWithChunks.map(({ chunks }) => embeddings.embed(chunks[0].content))
  );

  // Batch all related chunk searches
  const relatedSearches = await Promise.all(
    relatedEmbeddings.map((embedding, i) =>
      vectorDB.search(embedding, 5, filesWithChunks[i].chunks[0].content)
    )
  );

  // Map back to original indices
  const relatedChunksMap: SearchResult[][] = Array.from(
    { length: filepaths.length },
    () => []
  );
  
  filesWithChunks.forEach(({ filepath, index }, i) => {
    const related = relatedSearches[i];
    const targetCanonical = getCanonicalPath(filepath, workspaceRoot);
    
    // Filter out chunks from the same file using exact matching
    relatedChunksMap[index] = related.filter(r => {
      const chunkCanonical = getCanonicalPath(r.metadata.file, workspaceRoot);
      return chunkCanonical !== targetCanonical;
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
export function createPathCache(
  workspaceRoot: string
): { normalize: (path: string) => string; cache: PathCache } {
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
  ctx: HandlerContext
): string[][] {
  const { workspaceRoot } = ctx;
  const { normalize } = createPathCache(workspaceRoot);

  return filepaths.map((filepath) => {
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
 * Combines file chunks and related chunks, removing duplicates
 * based on canonical file path + line range.
 * 
 * @param fileChunks - Primary chunks for the file
 * @param relatedChunks - Related chunks from other files
 * @param workspaceRoot - Workspace root for path canonicalization
 * @returns Deduplicated array of chunks
 */
export function deduplicateChunks(
  fileChunks: SearchResult[],
  relatedChunks: SearchResult[],
  workspaceRoot: string
): SearchResult[] {
  const seenChunks = new Set<string>();
  
  return [...fileChunks, ...relatedChunks].filter(chunk => {
    const canonicalFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    const chunkId = `${canonicalFile}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    
    if (seenChunks.has(chunkId)) return false;
    seenChunks.add(chunkId);
    return true;
  });
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
  workspaceRoot: string
): Record<string, FileData> {
  const filesData: Record<string, FileData> = {};
  
  filepaths.forEach((filepath, i) => {
    const dedupedChunks = deduplicateChunks(
      fileChunksMap[i],
      relatedChunksMap[i] || [],
      workspaceRoot
    );
    
    filesData[filepath] = {
      chunks: dedupedChunks,
      testAssociations: testAssociationsMap[i],
    };
  });
  
  return filesData;
}

/**
 * Build warning note when scan limit is reached.
 */
function buildScanLimitNote(hitScanLimit: boolean): string | undefined {
  return hitScanLimit
    ? 'Scanned 10,000 chunks (limit reached). Test associations may be incomplete for large codebases.'
    : undefined;
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
  note?: string
) {
  return {
    indexInfo,
    file: filepath,
    chunks: filesData[filepath].chunks,
    testAssociations: filesData[filepath].testAssociations,
    ...(note && { note }),
  };
}

/**
 * Build response for multiple files request.
 */
function buildMultiFileResponse(
  filesData: Record<string, FileData>,
  indexInfo: IndexInfo,
  note?: string
) {
  return {
    indexInfo,
    files: filesData,
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
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, embeddings, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetFilesContextSchema,
    async (validatedArgs: ValidatedArgs) => {
      // Normalize input: convert single string to array
      const filepaths = Array.isArray(validatedArgs.filepaths)
        ? validatedArgs.filepaths
        : [validatedArgs.filepaths];

      const isSingleFile = !Array.isArray(validatedArgs.filepaths);

      log(`Getting context for: ${filepaths.join(', ')}`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

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
        relatedChunksMap = await findRelatedChunks(
          filepaths,
          fileChunksMap,
          handlerCtx
        );
      }

      // Step 3: Scan for test associations
      const allChunks = await vectorDB.scanWithFilter({ limit: SCAN_LIMIT });
      const hitScanLimit = allChunks.length === SCAN_LIMIT;
      
      if (hitScanLimit) {
        log(
          `Scanned ${SCAN_LIMIT} chunks (limit reached). Test associations may be incomplete for large codebases.`,
          'warning'
        );
      }

      const testAssociationsMap = findTestAssociations(
        filepaths,
        allChunks,
        handlerCtx
      );

      // Step 4: Build combined file data with deduplication
      const filesData = buildFilesData(
        filepaths,
        fileChunksMap,
        relatedChunksMap,
        testAssociationsMap,
        workspaceRoot
      );

      // Shape metadata for context efficiency
      for (const fileData of Object.values(filesData)) {
        fileData.chunks = shapeResults(fileData.chunks as SearchResult[], 'get_files_context');
      }

      const totalChunks = Object.values(filesData).reduce(
        (sum, f) => sum + f.chunks.length,
        0
      );
      log(`Found ${totalChunks} total chunks`);

      // Step 5: Build and return response
      const note = buildScanLimitNote(hitScanLimit);
      const indexInfo = getIndexMetadata();
      
      return isSingleFile
        ? buildSingleFileResponse(filepaths[0], filesData, indexInfo, note)
        : buildMultiFileResponse(filesData, indexInfo, note);
    }
  )(args);
}
