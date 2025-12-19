/**
 * Core indexing module - programmatic API without CLI dependencies.
 * 
 * This module provides the core indexing functionality that can be used by:
 * - @liendev/cli (with UI wrapper)
 * - @liendev/action (directly)
 * - @liendev/cloud (worker processes)
 * - Third-party integrations
 */

import fs from 'fs/promises';
import pLimit from 'p-limit';
import path from 'path';
import crypto from 'crypto';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { createVectorDB } from '../vectordb/factory.js';
import { configService } from '../config/service.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isLegacyConfig, isModernConfig, type LienConfig, type LegacyLienConfig } from '../config/schema.js';
import { ManifestManager } from './manifest.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';
import { GitStateTracker } from '../git/tracker.js';
import { detectChanges } from './change-detector.js';
import { indexMultipleFiles } from './incremental.js';
import type { EmbeddingService } from '../embeddings/types.js';
import { ChunkBatchProcessor } from './chunk-batch-processor.js';
import type { VectorDBInterface } from '../vectordb/types.js';

/**
 * Options for indexing a codebase
 */
export interface IndexingOptions {
  /** Root directory to index (defaults to cwd) */
  rootDir?: string;
  /** Show verbose output */
  verbose?: boolean;
  /** Force full reindex, skip incremental */
  force?: boolean;
  /** Pre-initialized embedding service (for warm workers) */
  embeddings?: EmbeddingService;
  /** Pre-loaded config (skip loading from disk) */
  config?: LienConfig;
  /** Progress callback for external UI */
  onProgress?: (progress: IndexingProgress) => void;
}

/**
 * Progress information during indexing
 */
export interface IndexingProgress {
  phase: 'initializing' | 'scanning' | 'embedding' | 'indexing' | 'saving' | 'complete';
  message: string;
  filesTotal?: number;
  filesProcessed?: number;
  chunksProcessed?: number;
}

/**
 * Result of indexing operation
 */
export interface IndexingResult {
  success: boolean;
  filesIndexed: number;
  chunksCreated: number;
  durationMs: number;
  incremental: boolean;
  error?: string;
}

/** Extracted config values with defaults for indexing */
interface IndexingConfig {
  concurrency: number;
  embeddingBatchSize: number;
  chunkSize: number;
  chunkOverlap: number;
  useAST: boolean;
  astFallback: 'line-based' | 'error';
  repoId?: string;
  orgId?: string;
}

/**
 * Extract repository identifier from project root.
 * Uses project name + path hash for stable, unique identification.
 */
function extractRepoId(projectRoot: string): string {
  const projectName = path.basename(projectRoot);
  const pathHash = crypto
    .createHash('md5')
    .update(projectRoot)
    .digest('hex')
    .substring(0, 8);
  return `${projectName}-${pathHash}`;
}

/** Extract indexing config values with defaults */
function getIndexingConfig(
  config: LienConfig | LegacyLienConfig,
  rootDir: string
): IndexingConfig {
  const baseConfig = isModernConfig(config)
    ? {
        concurrency: config.core.concurrency,
        embeddingBatchSize: config.core.embeddingBatchSize,
        chunkSize: config.core.chunkSize,
        chunkOverlap: config.core.chunkOverlap,
        useAST: config.chunking.useAST,
        astFallback: config.chunking.astFallback,
      }
    : {
        // Legacy defaults
        concurrency: 4,
        embeddingBatchSize: 50,
        chunkSize: 75,
        chunkOverlap: 10,
        useAST: true,
        astFallback: 'line-based' as const,
      };

  // Extract tenant context for multi-tenant scenarios
  // Note: storage config will be added in Phase 3, so we check safely
  const repoId = extractRepoId(rootDir);
  const orgId = isModernConfig(config) && (config as any).storage?.qdrant?.orgId
    ? (config as any).storage.qdrant.orgId
    : undefined;

  return {
    ...baseConfig,
    repoId,
    orgId,
  };
}

/** Scan files based on config type */
async function scanFilesToIndex(
  rootDir: string,
  config: LienConfig | LegacyLienConfig
): Promise<string[]> {
  if (isModernConfig(config) && config.frameworks.length > 0) {
    return scanCodebaseWithFrameworks(rootDir, config);
  }
  if (isLegacyConfig(config)) {
    return scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude,
    });
  }
  return scanCodebase({ rootDir, includePatterns: [], excludePatterns: [] });
}

/**
 * Update git state after indexing (if in a git repo).
 */
async function updateGitState(
  rootDir: string,
  vectorDB: VectorDBInterface,
  manifest: ManifestManager
): Promise<void> {
  const gitAvailable = await isGitAvailable();
  const isRepo = await isGitRepo(rootDir);
  
  if (!gitAvailable || !isRepo) {
    return;
  }
  
  const gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
  await gitTracker.initialize();
  const gitState = gitTracker.getState();
  
  if (gitState) {
    await manifest.updateGitState(gitState);
  }
}

/**
 * Handle file deletions during incremental indexing.
 */
async function handleDeletions(
  deletedFiles: string[],
  vectorDB: VectorDBInterface,
  manifest: ManifestManager
): Promise<number> {
  if (deletedFiles.length === 0) {
    return 0;
  }
  
  let removedCount = 0;
  
  for (const filepath of deletedFiles) {
    try {
      await vectorDB.deleteByFile(filepath);
      await manifest.removeFile(filepath);
      removedCount++;
    } catch {
      // Continue on error, just count failures
    }
  }
  
  return removedCount;
}

/**
 * Handle file updates (additions and modifications) during incremental indexing.
 */
async function handleUpdates(
  addedFiles: string[],
  modifiedFiles: string[],
  vectorDB: VectorDBInterface,
  embeddings: EmbeddingService,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  rootDir: string
): Promise<number> {
  const filesToIndex = [...addedFiles, ...modifiedFiles];
  
  if (filesToIndex.length === 0) {
    return 0;
  }
  
  const count = await indexMultipleFiles(
    filesToIndex,
    vectorDB,
    embeddings,
    config,
    { verbose: options.verbose, rootDir }
  );
  
  await writeVersionFile(vectorDB.dbPath);
  return count;
}

/**
 * Try incremental indexing if a manifest exists.
 * Returns result if incremental completed, null if full index needed.
 */
async function tryIncrementalIndex(
  rootDir: string,
  vectorDB: VectorDBInterface,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  startTime: number
): Promise<IndexingResult | null> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  
  if (!savedManifest) {
    return null; // No manifest, need full index
  }
  
  const changes = await detectChanges(rootDir, vectorDB, config);
  
  if (changes.reason === 'full') {
    return null;
  }
  
  const totalChanges = changes.added.length + changes.modified.length;
  const totalDeleted = changes.deleted.length;
  
  if (totalChanges === 0 && totalDeleted === 0) {
    options.onProgress?.({
      phase: 'complete',
      message: 'Index is up to date - no changes detected',
      filesTotal: 0,
      filesProcessed: 0,
    });
    return {
      success: true,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: true,
    };
  }
  
  options.onProgress?.({
    phase: 'embedding',
    message: `Detected ${totalChanges} files to index, ${totalDeleted} to remove`,
  });
  
  // Initialize embeddings for incremental update
  const embeddings = options.embeddings ?? new LocalEmbeddings();
  if (!options.embeddings) {
    await embeddings.initialize();
  }
  
  // Process changes
  await handleDeletions(changes.deleted, vectorDB, manifest);
  const indexedCount = await handleUpdates(
    changes.added,
    changes.modified,
    vectorDB,
    embeddings,
    config,
    options,
    rootDir
  );
  
  // Update git state
  await updateGitState(rootDir, vectorDB, manifest);
  
  options.onProgress?.({
    phase: 'complete',
    message: `Updated ${indexedCount} file${indexedCount !== 1 ? 's' : ''}, removed ${totalDeleted}`,
    filesTotal: totalChanges + totalDeleted,
    filesProcessed: indexedCount + totalDeleted,
  });
  
  return {
    success: true,
    filesIndexed: indexedCount,
    chunksCreated: 0, // Not tracked in incremental mode
    durationMs: Date.now() - startTime,
    incremental: true,
  };
}

/**
 * Process a single file for indexing.
 * Extracts chunks and adds them to the batch processor.
 *
 * @returns true if file was processed successfully, false if skipped
 */
async function processFileForIndexing(
  file: string,
  batchProcessor: ChunkBatchProcessor,
  indexConfig: IndexingConfig,
  progressTracker: { incrementFiles: () => void },
  _verbose: boolean
): Promise<boolean> {
  try {
    // Get file stats to capture actual modification time
    const stats = await fs.stat(file);
    const content = await fs.readFile(file, 'utf-8');

    const chunks = chunkFile(file, content, {
      chunkSize: indexConfig.chunkSize,
      chunkOverlap: indexConfig.chunkOverlap,
      useAST: indexConfig.useAST,
      astFallback: indexConfig.astFallback,
      repoId: indexConfig.repoId,
      orgId: indexConfig.orgId,
    });

    if (chunks.length === 0) {
      progressTracker.incrementFiles();
      return false;
    }

    // Add chunks to batch processor (handles mutex internally)
    await batchProcessor.addChunks(chunks, file, stats.mtimeMs);
    progressTracker.incrementFiles();

    return true;
  } catch {
    progressTracker.incrementFiles();
    return false;
  }
}

/**
 * Perform a full index of the codebase.
 */
async function performFullIndex(
  rootDir: string,
  vectorDB: VectorDBInterface,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  startTime: number
): Promise<IndexingResult> {
  // 1. Clear existing index (required for schema changes)
  options.onProgress?.({ phase: 'initializing', message: 'Clearing existing index...' });
  await vectorDB.clear();

  // 2. Scan for files
  options.onProgress?.({ phase: 'scanning', message: 'Scanning codebase...' });
  const files = await scanFilesToIndex(rootDir, config);

  if (files.length === 0) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: 'No files found to index',
    };
  }

  // 3. Initialize embeddings model
  options.onProgress?.({ 
    phase: 'embedding', 
    message: 'Loading embedding model...',
    filesTotal: files.length,
  });
  
  const embeddings = options.embeddings ?? new LocalEmbeddings();
  if (!options.embeddings) {
    await embeddings.initialize();
  }

  // 4. Setup processing infrastructure
  const indexConfig = getIndexingConfig(config, rootDir);
  const processedCount = { value: 0 };
  
  // Create a simple progress tracker that works with callbacks
  const progressTracker = {
    incrementFiles: () => {
      processedCount.value++;
      options.onProgress?.({
        phase: 'indexing',
        message: `Processing files...`,
        filesTotal: files.length,
        filesProcessed: processedCount.value,
      });
    },
    incrementChunks: () => {},
    getProcessedCount: () => processedCount.value,
    start: () => {},
    stop: () => {},
  };
  
  const batchProcessor = new ChunkBatchProcessor(vectorDB, embeddings, {
    batchThreshold: 100,
    embeddingBatchSize: indexConfig.embeddingBatchSize,
  }, progressTracker);

  options.onProgress?.({ 
    phase: 'indexing', 
    message: `Processing ${files.length} files...`,
    filesTotal: files.length,
    filesProcessed: 0,
  });

  try {
    // 5. Process files with concurrency limit
    const limit = pLimit(indexConfig.concurrency);
    const filePromises = files.map(file =>
      limit(() => processFileForIndexing(
        file,
        batchProcessor,
        indexConfig,
        progressTracker,
        options.verbose ?? false
      ))
    );

    await Promise.all(filePromises);

    // 6. Flush remaining chunks
    await batchProcessor.flush();
  } catch (error) {
    return {
      success: false,
      filesIndexed: processedCount.value,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 7. Save results
  options.onProgress?.({ phase: 'saving', message: 'Saving index manifest...' });
  const { processedChunks, indexedFiles } = batchProcessor.getResults();
  
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFiles(
    indexedFiles.map(entry => ({
      filepath: entry.filepath,
      lastModified: entry.mtime,
      chunkCount: entry.chunkCount,
    }))
  );

  // Save git state if in a git repo
  await updateGitState(rootDir, vectorDB, manifest);

  // Write version file to mark successful completion
  await writeVersionFile(vectorDB.dbPath);

  options.onProgress?.({ 
    phase: 'complete', 
    message: 'Indexing complete',
    filesTotal: files.length,
    filesProcessed: processedCount.value,
    chunksProcessed: processedChunks,
  });

  return {
    success: true,
    filesIndexed: processedCount.value,
    chunksCreated: processedChunks,
    durationMs: Date.now() - startTime,
    incremental: false,
  };
}

/**
 * Index a codebase, creating vector embeddings for semantic search.
 * 
 * This is the main entry point for indexing. It:
 * - Tries incremental indexing first (if not forced)
 * - Falls back to full indexing if needed
 * - Provides progress callbacks for UI integration
 * 
 * @param options - Indexing options
 * @returns Indexing result with stats
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const result = await indexCodebase({ rootDir: '/path/to/project' });
 * 
 * // With progress callback
 * const result = await indexCodebase({
 *   rootDir: '/path/to/project',
 *   onProgress: (p) => console.log(`${p.phase}: ${p.message}`)
 * });
 * 
 * // With pre-initialized embeddings (warm worker)
 * const embeddings = new LocalEmbeddings();
 * await embeddings.initialize();
 * const result = await indexCodebase({ embeddings });
 * ```
 */
export async function indexCodebase(options: IndexingOptions = {}): Promise<IndexingResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const startTime = Date.now();
  
  try {
    options.onProgress?.({ phase: 'initializing', message: 'Loading configuration...' });
    
    // Load configuration
    const config = options.config ?? await configService.load(rootDir);
    
    // Initialize vector database (use factory to select backend)
    options.onProgress?.({ phase: 'initializing', message: 'Initializing vector database...' });
    const vectorDB = createVectorDB(rootDir, config);
    await vectorDB.initialize();
    
    // Try incremental indexing first (unless forced)
    if (!options.force) {
      const incrementalResult = await tryIncrementalIndex(rootDir, vectorDB, config, options, startTime);
      if (incrementalResult) {
        return incrementalResult;
      }
    }
    
    // Fall back to full index
    return await performFullIndex(rootDir, vectorDB, config, options, startTime);
    
  } catch (error) {
    return {
      success: false,
      filesIndexed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export types for convenience
export type { FileIndexEntry } from './chunk-batch-processor.js';
