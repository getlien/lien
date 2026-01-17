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
import { detectAllFrameworks } from '../frameworks/detector-service.js';
import { getFrameworkDetector } from '../frameworks/registry.js';
import type { FrameworkConfig } from '../config/schema.js';
import type { LienConfig } from '../config/schema.js';
import type { ProgressTracker } from './progress-tracker.js';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
} from '../constants.js';
import { chunkFile } from './chunker.js';
import { computeContentHash } from './content-hash.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { createVectorDB } from '../vectordb/factory.js';
import { writeVersionFile } from '../vectordb/version.js';
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

/** Extract indexing config values using defaults */
function getIndexingConfig(rootDir: string): IndexingConfig {
  // Use defaults for all settings - no config needed!
  const repoId = extractRepoId(rootDir);
  
  // orgId is now handled in createVectorDB() via global config and git remote detection
  // No need to extract it here anymore

  return {
    concurrency: DEFAULT_CONCURRENCY,
    embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    useAST: true, // Always use AST-based chunking
    astFallback: 'line-based' as const,
    repoId,
    orgId: undefined, // Not needed here - handled in VectorDB factory
  };
}

/** Scan files by auto-detecting frameworks */
export async function scanFilesToIndex(rootDir: string): Promise<string[]> {
  // Auto-detect frameworks
  const detectedFrameworks = await detectAllFrameworks(rootDir);
  
  if (detectedFrameworks.length > 0) {
    // Convert detected frameworks to FrameworkInstance format for scanner
    const frameworks = await Promise.all(
      detectedFrameworks.map(async (detection) => {
        const detector = getFrameworkDetector(detection.name);
        if (!detector) {
          throw new Error(`Framework detector not found: ${detection.name}`);
        }
        const config = await detector.generateConfig(rootDir, detection.path);
        
        return {
          name: detection.name,
          path: detection.path,
          enabled: true,
          config: config as FrameworkConfig,
        };
      })
    );
    
    // Create a minimal config object for scanCodebaseWithFrameworks
    const tempConfig: LienConfig = {
      core: {
        chunkSize: DEFAULT_CHUNK_SIZE,
        chunkOverlap: DEFAULT_CHUNK_OVERLAP,
        concurrency: DEFAULT_CONCURRENCY,
        embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
      },
      chunking: {
        useAST: true,
        astFallback: 'line-based',
      },
      mcp: {
        port: 7133,
        transport: 'stdio',
        autoIndexOnFirstRun: true,
      },
      gitDetection: {
        enabled: true,
        pollIntervalMs: 10000,
      },
      fileWatching: {
        enabled: true,
        debounceMs: 1000,
      },
      frameworks,
    };
    
    return scanCodebaseWithFrameworks(rootDir, tempConfig);
  }
  
  // Fallback: scan common code files if no frameworks detected
    return scanCodebase({
      rootDir,
    includePatterns: [
      '**/*.{ts,tsx,js,jsx,py,php,go,rs,java,kt,swift,rb,cs}',
      '**/*.md',
      '**/*.mdx',
    ],
    excludePatterns: [
      '**/node_modules/**',
      '**/vendor/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
    ],
  });
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
  options: IndexingOptions,
  startTime: number
): Promise<IndexingResult | null> {
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  
  if (!savedManifest) {
    return null; // No manifest, need full index
  }
  
  const changes = await detectChanges(rootDir, vectorDB);
  
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

    // Compute content hash for change detection
    const contentHash = await computeContentHash(file);

    // Add chunks to batch processor (handles mutex internally)
    await batchProcessor.addChunks(chunks, file, stats.mtimeMs, contentHash);
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
/**
 * Create progress tracker for full indexing
 */
function createProgressTracker(
  files: string[],
  onProgress?: (progress: IndexingProgress) => void
): ProgressTracker {
  const processedCount = { value: 0 };
  
  return {
    incrementFiles: () => {
      processedCount.value++;
      onProgress?.({
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
}

/**
 * Save indexing results to manifest and write version file
 */
async function saveIndexResults(
  batchProcessor: ChunkBatchProcessor,
  vectorDB: VectorDBInterface,
  rootDir: string
): Promise<void> {
  const { indexedFiles } = batchProcessor.getResults();
  
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFiles(
    indexedFiles.map(entry => ({
      filepath: entry.filepath,
      lastModified: entry.mtime,
      chunkCount: entry.chunkCount,
      contentHash: entry.contentHash,
    }))
  );

  // Save git state if in a git repo
  await updateGitState(rootDir, vectorDB, manifest);

  // Write version file to mark successful completion
  await writeVersionFile(vectorDB.dbPath);
}

/**
 * Perform full indexing of the codebase
 */
async function performFullIndex(
  rootDir: string,
  vectorDB: VectorDBInterface,
  options: IndexingOptions,
  startTime: number
): Promise<IndexingResult> {
  // 1. Clear existing index
  options.onProgress?.({ phase: 'initializing', message: 'Clearing existing index...' });
  await vectorDB.clear();

  // 2. Scan for files
  options.onProgress?.({ phase: 'scanning', message: 'Scanning codebase...' });
  const files = await scanFilesToIndex(rootDir);

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

  // 3. Initialize embeddings
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
  const indexConfig = getIndexingConfig(rootDir);
  const progressTracker = createProgressTracker(files, options.onProgress);
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
    await batchProcessor.flush();
  } catch (error) {
    return {
      success: false,
      filesIndexed: progressTracker.getProcessedCount(),
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      incremental: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 6. Save results
  options.onProgress?.({ phase: 'saving', message: 'Saving index manifest...' });
  await saveIndexResults(batchProcessor, vectorDB, rootDir);

  const { processedChunks } = batchProcessor.getResults();
  options.onProgress?.({ 
    phase: 'complete', 
    message: 'Indexing complete',
    filesTotal: files.length,
    filesProcessed: progressTracker.getProcessedCount(),
    chunksProcessed: processedChunks,
  });

  return {
    success: true,
    filesIndexed: progressTracker.getProcessedCount(),
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
    
    // Initialize vector database (use factory to select backend from global config)
    options.onProgress?.({ phase: 'initializing', message: 'Initializing vector database...' });
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();
    
    // Try incremental indexing first (unless forced)
    if (!options.force) {
      const incrementalResult = await tryIncrementalIndex(rootDir, vectorDB, options, startTime);
      if (incrementalResult) {
        return incrementalResult;
      }
    }
    
    // Fall back to full index
    return await performFullIndex(rootDir, vectorDB, options, startTime);
    
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
