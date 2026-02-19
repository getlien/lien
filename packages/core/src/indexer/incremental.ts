import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import type { EmbeddingService } from '../embeddings/types.js';
import type { VectorDBInterface } from '../vectordb/types.js';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  EMBEDDING_MICRO_BATCH_SIZE,
} from '../constants.js';
import { ManifestManager } from './manifest.js';
import type { Result } from '../utils/result.js';
import { Ok, Err, isOk } from '../utils/result.js';
import { chunkFile, computeContentHash, extractRepoId } from '@liendev/parser';
import type { CodeChunk } from '@liendev/parser';

/**
 * Normalize a file path to a consistent relative format.
 * This ensures paths from different sources (git diff, scanner, etc.)
 * are stored and queried consistently in the index.
 *
 * @param filepath - Absolute or relative file path
 * @param rootDir - Workspace root directory (defaults to cwd)
 * @returns Relative path from rootDir
 */
export function normalizeToRelativePath(filepath: string, rootDir?: string): string {
  // Normalize root and strip trailing slash to ensure consistent comparison
  const root = (rootDir || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '');
  const normalized = filepath.replace(/\\/g, '/');

  // If already relative, return as-is
  if (!path.isAbsolute(filepath)) {
    return normalized;
  }

  // Convert absolute to relative
  if (normalized.startsWith(root + '/')) {
    return normalized.slice(root.length + 1);
  }
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length);
  }

  // Fallback: use path.relative
  return path.relative(root, filepath).replace(/\\/g, '/');
}

export interface IncrementalIndexOptions {
  verbose?: boolean;
  rootDir?: string; // Root directory for extracting repoId
}

/**
 * Result of processing a file's content into chunks and embeddings.
 */
interface ProcessFileResult {
  chunkCount: number;
  vectors: Float32Array[];
  chunks: CodeChunk[];
  texts: string[];
}

/**
 * Result of processing a single file for incremental indexing.
 */
interface FileProcessResult {
  filepath: string;
  result: ProcessFileResult | null; // null for empty files
  mtime: number;
  contentHash: string; // Content hash for change detection
}

/**
 * Shared helper that processes file content into chunks and embeddings.
 * This is the core logic shared between indexSingleFile and indexMultipleFiles.
 *
 * Returns null for empty files (0 chunks), which callers should handle appropriately.
 *
 * @param filepath - Path to the file being processed
 * @param content - File content
 * @param embeddings - Embeddings service
 * @param config - Lien configuration
 * @param verbose - Whether to log verbose output
 * @returns ProcessFileResult for non-empty files, null for empty files
 */
async function processFileContent(
  filepath: string,
  content: string,
  embeddings: EmbeddingService,
  verbose: boolean,
  rootDir?: string,
): Promise<ProcessFileResult | null> {
  // Use defaults for all chunk settings
  const chunkSize = DEFAULT_CHUNK_SIZE;
  const chunkOverlap = DEFAULT_CHUNK_OVERLAP;
  const useAST = true; // Always use AST-based chunking
  const astFallback = 'line-based' as const;

  // Extract tenant context for multi-tenant scenarios
  // orgId is now handled in createVectorDB() via global config and git remote detection
  const repoId = rootDir ? extractRepoId(rootDir) : undefined;
  const orgId = undefined; // Not needed here - handled in VectorDB factory

  // Chunk the file
  const chunks = chunkFile(filepath, content, {
    chunkSize,
    chunkOverlap,
    useAST,
    astFallback,
    repoId,
    orgId,
  });

  if (chunks.length === 0) {
    // Empty file - return null so caller can handle appropriately
    if (verbose) {
      console.error(`[Lien] Empty file (0 chunks): ${filepath}`);
    }
    return null;
  }

  // Generate embeddings for all chunks
  // Use micro-batching to prevent event loop blocking
  const texts = chunks.map(c => c.content);
  const vectors: Float32Array[] = [];

  for (let j = 0; j < texts.length; j += EMBEDDING_MICRO_BATCH_SIZE) {
    const microBatch = texts.slice(j, Math.min(j + EMBEDDING_MICRO_BATCH_SIZE, texts.length));
    const microResults = await embeddings.embedBatch(microBatch);
    vectors.push(...microResults);

    // Yield to event loop for responsiveness
    if (texts.length > EMBEDDING_MICRO_BATCH_SIZE) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return {
    chunkCount: chunks.length,
    vectors,
    chunks,
    texts,
  };
}

/**
 * Indexes a single file incrementally by updating its chunks in the vector database.
 * This is the core function for incremental reindexing - it handles file changes,
 * deletions, and additions.
 *
 * @param filepath - Absolute path to the file to index
 * @param vectorDB - Initialized VectorDB instance
 * @param embeddings - Initialized embeddings service
 * @param config - Lien configuration
 * @param options - Optional settings
 */
export async function indexSingleFile(
  filepath: string,
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  options: IncrementalIndexOptions = {},
): Promise<void> {
  const { verbose, rootDir } = options;

  // Normalize to relative path for consistent storage and queries
  // This ensures paths from git diff (absolute) match paths from scanner (relative)
  const normalizedPath = normalizeToRelativePath(filepath);

  try {
    // Check if file exists (use original filepath for filesystem operations)
    try {
      await fs.access(filepath);
    } catch {
      // File doesn't exist - delete from index and manifest using normalized path
      if (verbose) {
        console.error(`[Lien] File deleted: ${normalizedPath}`);
      }
      await vectorDB.deleteByFile(normalizedPath);

      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.removeFile(normalizedPath);
      return;
    }

    // Read file content
    const content = await fs.readFile(filepath, 'utf-8');

    // Process file content (chunking + embeddings) - use normalized path for storage
    const result = await processFileContent(
      normalizedPath,
      content,
      embeddings,
      verbose || false,
      rootDir,
    );

    // Get actual file mtime and compute content hash for manifest
    const stats = await fs.stat(filepath);
    const contentHash = await computeContentHash(filepath);
    const manifest = new ManifestManager(vectorDB.dbPath);

    if (result === null) {
      // Empty file - remove from vector DB but keep in manifest with chunkCount: 0
      await vectorDB.deleteByFile(normalizedPath);
      await manifest.updateFile(normalizedPath, {
        filepath: normalizedPath,
        lastModified: stats.mtimeMs,
        chunkCount: 0,
        contentHash,
      });
      return;
    }

    // Non-empty file - update in database (atomic: delete old + insert new)
    await vectorDB.updateFile(
      normalizedPath,
      result.vectors,
      result.chunks.map(c => c.metadata),
      result.texts,
    );

    // Update manifest after successful indexing
    await manifest.updateFile(normalizedPath, {
      filepath: normalizedPath,
      lastModified: stats.mtimeMs,
      chunkCount: result.chunkCount,
      contentHash,
    });

    if (verbose) {
      console.error(`[Lien] ✓ Updated ${normalizedPath} (${result.chunkCount} chunks)`);
    }
  } catch (error) {
    // Log error but don't throw - we want to continue with other files
    console.error(`[Lien] ⚠️  Failed to index ${normalizedPath}: ${error}`);
  }
}

/**
 * Process a single file, returning a Result type.
 * This helper makes error handling explicit and testable.
 *
 * @param filepath - Original filepath (may be absolute)
 * @param normalizedPath - Normalized relative path for storage
 */
async function processSingleFileForIndexing(
  filepath: string,
  normalizedPath: string,
  embeddings: EmbeddingService,
  verbose: boolean,
  rootDir?: string,
): Promise<Result<FileProcessResult, string>> {
  try {
    // Read file stats and content using original path (for filesystem access)
    const stats = await fs.stat(filepath);
    const content = await fs.readFile(filepath, 'utf-8');
    const contentHash = await computeContentHash(filepath);

    // Process content using normalized path (for storage)
    const result = await processFileContent(normalizedPath, content, embeddings, verbose, rootDir);

    return Ok({
      filepath: normalizedPath, // Store normalized path
      result,
      mtime: stats.mtimeMs,
      contentHash,
    });
  } catch (error) {
    return Err(`Failed to process ${normalizedPath}: ${error}`);
  }
}

/**
 * Handle indexing result for an empty file
 */
async function handleEmptyFile(
  storedPath: string,
  mtime: number,
  contentHash: string,
  vectorDB: VectorDBInterface,
): Promise<void> {
  // Remove from vector DB
  try {
    await vectorDB.deleteByFile(storedPath);
  } catch {
    // Ignore errors if file wasn't in index
  }

  // Update manifest immediately for empty files (not batched)
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFile(storedPath, {
    filepath: storedPath,
    lastModified: mtime,
    chunkCount: 0,
    contentHash,
  });
}

/**
 * Handle indexing result for a non-empty file
 */
async function handleNonEmptyFile(
  storedPath: string,
  processResult: ProcessFileResult,
  mtime: number,
  contentHash: string,
  vectorDB: VectorDBInterface,
  verbose: boolean,
  manifestEntries: Array<{
    filepath: string;
    chunkCount: number;
    mtime: number;
    contentHash: string;
  }>,
): Promise<void> {
  // Delete old chunks if they exist
  try {
    await vectorDB.deleteByFile(storedPath);
  } catch {
    // Ignore - file might not be in index yet
  }

  // Insert new chunks
  await vectorDB.insertBatch(
    processResult.vectors,
    processResult.chunks.map(c => c.metadata),
    processResult.texts,
  );

  // Queue manifest update (batch at end)
  manifestEntries.push({
    filepath: storedPath,
    chunkCount: processResult.chunkCount,
    mtime,
    contentHash,
  });

  if (verbose) {
    console.error(`[Lien] ✓ Updated ${storedPath} (${processResult.chunkCount} chunks)`);
  }
}

/**
 * Handle file deletion (file doesn't exist or couldn't be read)
 */
async function handleFileNotFound(
  normalizedPath: string,
  errorMessage: string,
  vectorDB: VectorDBInterface,
  verbose: boolean,
): Promise<void> {
  if (verbose) {
    console.error(`[Lien] ${errorMessage}`);
  }

  try {
    await vectorDB.deleteByFile(normalizedPath);
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.removeFile(normalizedPath);
  } catch {
    if (verbose) {
      console.error(`[Lien] Note: ${normalizedPath} not in index`);
    }
  }
}

/**
 * Apply a single file's processing result to the vector DB.
 * Handles success (empty/non-empty) and failure (file not found) cases.
 */
async function applyFileResult(
  result: Result<FileProcessResult, string>,
  normalizedPath: string,
  vectorDB: VectorDBInterface,
  verbose: boolean,
  manifestEntries: Array<{
    filepath: string;
    chunkCount: number;
    mtime: number;
    contentHash: string;
  }>,
): Promise<void> {
  if (isOk(result)) {
    const { filepath: storedPath, result: processResult, mtime, contentHash } = result.value;

    if (processResult === null) {
      await handleEmptyFile(storedPath, mtime, contentHash, vectorDB);
    } else {
      await handleNonEmptyFile(
        storedPath,
        processResult,
        mtime,
        contentHash,
        vectorDB,
        verbose,
        manifestEntries,
      );
    }
  } else {
    await handleFileNotFound(normalizedPath, result.error, vectorDB, verbose);
  }
}

/**
 * Indexes multiple files incrementally.
 * Files are processed concurrently (read, chunk, embed) with p-limit, and each
 * file's vector DB updates are enqueued for writing as soon as its processing
 * completes. This creates a pipelined flow where DB writes are ordered safely
 * for concurrent-unfriendly DBs, without waiting for all files to finish first.
 *
 * Uses Result type for explicit error handling, making it easier to test
 * and reason about failure modes.
 *
 * Note: This function counts both successfully indexed files AND successfully
 * handled deletions (files that don't exist but were removed from the index).
 *
 * @param filepaths - Array of absolute file paths to index
 * @param vectorDB - Initialized VectorDB instance
 * @param embeddings - Initialized embeddings service
 * @param options - Optional settings
 * @returns Number of successfully processed files (indexed or deleted)
 */
export async function indexMultipleFiles(
  filepaths: string[],
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  options: IncrementalIndexOptions = {},
): Promise<number> {
  const { verbose, rootDir } = options;
  let processedCount = 0;

  // Batch manifest updates for performance
  const manifestEntries: Array<{
    filepath: string;
    chunkCount: number;
    mtime: number;
    contentHash: string;
  }> = [];

  // Process files with bounded concurrency, applying each result to the DB as it completes.
  // This avoids collecting all embeddings in memory before writing.
  const limit = pLimit(DEFAULT_CONCURRENCY);
  const writeQueue: Promise<void>[] = [];
  let writeChain = Promise.resolve();

  for (const filepath of filepaths) {
    const task = limit(async () => {
      const normalizedPath = normalizeToRelativePath(filepath);
      const result = await processSingleFileForIndexing(
        filepath,
        normalizedPath,
        embeddings,
        verbose || false,
        rootDir,
      );

      // Chain DB writes sequentially (safe for concurrent-unfriendly DBs).
      // Catch errors per-write so one failure doesn't break the chain.
      writeChain = writeChain.then(async () => {
        try {
          await applyFileResult(
            result,
            normalizedPath,
            vectorDB,
            verbose || false,
            manifestEntries,
          );
          processedCount++;
        } catch (error) {
          console.error(`[Lien] DB write failed for ${normalizedPath}: ${error}`);
        }
      });
    });
    writeQueue.push(task);
  }

  await Promise.all(writeQueue);
  await writeChain;

  // Batch update manifest at the end (much faster than updating after each file)
  if (manifestEntries.length > 0) {
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.updateFiles(
      manifestEntries.map(entry => ({
        filepath: entry.filepath,
        lastModified: entry.mtime, // Use actual file mtime for accurate change detection
        chunkCount: entry.chunkCount,
        contentHash: entry.contentHash, // Include content hash for change detection
      })),
    );
  }

  return processedCount;
}
