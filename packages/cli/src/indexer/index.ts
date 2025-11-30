import fs from 'fs/promises';
import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { CodeChunk } from './types.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isLegacyConfig, isModernConfig, type LienConfig, type LegacyLienConfig } from '../config/schema.js';
import { ManifestManager } from './manifest.js';
import { detectChanges } from './change-detector.js';
import { indexMultipleFiles } from './incremental.js';
import { getIndexingMessage, getEmbeddingMessage, getModelLoadingMessage } from '../utils/loading-messages.js';
import { EMBEDDING_MICRO_BATCH_SIZE } from '../constants.js';
import { IndexingProgressTracker } from './progress-tracker.js';
import type { EmbeddingService } from '../embeddings/types.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
  force?: boolean;  // Force full reindex, skip incremental
}

interface ChunkWithContent {
  chunk: CodeChunk;
  content: string;
}

/**
 * Helper functions extracted from indexCodebase
 * These make the main function more readable and testable
 */

/**
 * Update git state after indexing (if in a git repo).
 */
async function updateGitState(
  rootDir: string,
  vectorDB: VectorDB,
  manifest: ManifestManager
): Promise<void> {
  const { isGitAvailable, isGitRepo } = await import('../git/utils.js');
  const { GitStateTracker } = await import('../git/tracker.js');
  
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
  vectorDB: VectorDB,
  manifest: ManifestManager,
  spinner: Ora
): Promise<void> {
  if (deletedFiles.length === 0) {
    return;
  }
  
  spinner.start(`Removing ${deletedFiles.length} deleted files...`);
  let removedCount = 0;
  
  for (const filepath of deletedFiles) {
    try {
      await vectorDB.deleteByFile(filepath);
      await manifest.removeFile(filepath);
      removedCount++;
    } catch (err) {
      spinner.warn(
        `Failed to remove file "${filepath}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  
  spinner.succeed(`Removed ${removedCount}/${deletedFiles.length} deleted files`);
}

/**
 * Handle file updates (additions and modifications) during incremental indexing.
 */
async function handleUpdates(
  addedFiles: string[],
  modifiedFiles: string[],
  vectorDB: VectorDB,
  embeddings: EmbeddingService,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  spinner: Ora
): Promise<void> {
  const filesToIndex = [...addedFiles, ...modifiedFiles];
  
  if (filesToIndex.length === 0) {
    return;
  }
  
  spinner.start(`Reindexing ${filesToIndex.length} changed files...`);
  const count = await indexMultipleFiles(
    filesToIndex,
    vectorDB,
    embeddings,
    config,
    { verbose: options.verbose }
  );
  
  await writeVersionFile(vectorDB.dbPath);
  spinner.succeed(
    `Incremental reindex complete: ${count}/${filesToIndex.length} files indexed successfully`
  );
}

/**
 * Try incremental indexing if a manifest exists.
 * Returns true if incremental indexing completed, false if full index needed.
 */
async function tryIncrementalIndex(
  rootDir: string,
  vectorDB: VectorDB,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  spinner: Ora
): Promise<boolean> {
  spinner.text = 'Checking for changes...';
  const manifest = new ManifestManager(vectorDB.dbPath);
  const savedManifest = await manifest.load();
  
  if (!savedManifest) {
    return false; // No manifest, need full index
  }
  
  const changes = await detectChanges(rootDir, vectorDB, config);
  
  if (changes.reason === 'full') {
    spinner.text = 'Full reindex required...';
    return false;
  }
  
  const totalChanges = changes.added.length + changes.modified.length;
  const totalDeleted = changes.deleted.length;
  
  if (totalChanges === 0 && totalDeleted === 0) {
    spinner.succeed('No changes detected - index is up to date!');
    return true;
  }
  
  spinner.succeed(
    `Detected changes: ${totalChanges} files to index, ${totalDeleted} to remove (${changes.reason} detection)`
  );
  
  // Initialize embeddings for incremental update
  spinner.start(getModelLoadingMessage());
  const embeddings = new LocalEmbeddings();
  await embeddings.initialize();
  spinner.succeed('Embedding model loaded');
  
  // Process changes
  await handleDeletions(changes.deleted, vectorDB, manifest, spinner);
  await handleUpdates(changes.added, changes.modified, vectorDB, embeddings, config, options, spinner);
  
  // Update git state
  await updateGitState(rootDir, vectorDB, manifest);
  
  console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  return true;
}

/**
 * Perform a full index of the codebase.
 */
async function performFullIndex(
  rootDir: string,
  vectorDB: VectorDB,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  spinner: Ora
): Promise<void> {
  // 1. Scan for files (framework-aware if frameworks configured)
  spinner.text = 'Scanning codebase...';
  let files: string[];
  
  if (isModernConfig(config) && config.frameworks.length > 0) {
    // Use framework-aware scanning for new configs
    files = await scanCodebaseWithFrameworks(rootDir, config);
  } else if (isLegacyConfig(config)) {
    // Fall back to legacy scanning for old configs
    files = await scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude,
    });
  } else {
    // Modern config with no frameworks - use empty patterns
    files = await scanCodebase({
      rootDir,
      includePatterns: [],
      excludePatterns: [],
    });
  }
  
  if (files.length === 0) {
    spinner.fail('No files found to index');
    return;
  }
  
  spinner.text = `Found ${files.length} files`;
  
  // 2. Initialize embeddings model
  spinner.text = getModelLoadingMessage();
  const embeddings = new LocalEmbeddings();
  await embeddings.initialize();
  spinner.succeed('Embedding model loaded');
  
  // 3. Process files concurrently
  const concurrency = isModernConfig(config) 
    ? config.core.concurrency 
    : 4;
  const embeddingBatchSize = isModernConfig(config)
    ? config.core.embeddingBatchSize
    : 50;
  // Use smaller batch size to keep UI responsive (process more frequently)
  const vectorDBBatchSize = 100;
  
  spinner.start(`Processing files with ${concurrency}x concurrency...`);
  
  const startTime = Date.now();
  let processedChunks = 0;
  
  // Accumulator for chunks across multiple files
  const chunkAccumulator: ChunkWithContent[] = [];
  const limit = pLimit(concurrency);
  
  // Track successfully indexed files for manifest
  const indexedFileEntries: Array<{ filepath: string; chunkCount: number; mtime: number }> = [];
  
  // Create progress tracker
  const progressTracker = new IndexingProgressTracker(files.length, spinner);
  progressTracker.start();
  
  try {
    // Mutex to prevent concurrent access to shared state (chunkAccumulator, indexedFileEntries)
    // This prevents race conditions when multiple concurrent tasks try to:
    // 1. Push to shared arrays
    // 2. Check accumulator length threshold
    // 3. Trigger processing
    let addChunksLock: Promise<void> | null = null;
    let processingLock: Promise<void> | null = null;
    
    // Function to process accumulated chunks
    const processAccumulatedChunks = async () => {
    // Wait for any in-progress processing to complete
    if (processingLock) {
      await processingLock;
    }
    
    if (chunkAccumulator.length === 0) return;
    
    // Acquire lock by creating a promise that will resolve when we're done
    let releaseLock: () => void;
    processingLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    
    try {
      const toProcess = chunkAccumulator.splice(0, chunkAccumulator.length);
      
      // Process embeddings in smaller batches AND insert incrementally to keep UI responsive
      for (let i = 0; i < toProcess.length; i += embeddingBatchSize) {
        const batch = toProcess.slice(i, Math.min(i + embeddingBatchSize, toProcess.length));
        
        // Update progress message
        progressTracker.setMessage(getEmbeddingMessage());
        
        // Process embeddings in micro-batches to prevent event loop blocking
        const texts = batch.map(item => item.content);
        const embeddingVectors: Float32Array[] = [];
        
        for (let j = 0; j < texts.length; j += EMBEDDING_MICRO_BATCH_SIZE) {
          const microBatch = texts.slice(j, Math.min(j + EMBEDDING_MICRO_BATCH_SIZE, texts.length));
          const microResults = await embeddings.embedBatch(microBatch);
          embeddingVectors.push(...microResults);
          
          // Yield to event loop so spinner can update
          await new Promise(resolve => setImmediate(resolve));
        }
        
        processedChunks += batch.length;
        
        // Update progress before DB insertion
        progressTracker.setMessage(`Inserting ${batch.length} chunks into vector space...`);
        
        await vectorDB.insertBatch(
          embeddingVectors,
          batch.map(item => item.chunk.metadata),
          texts
        );
        
        // Yield after DB insertion too
        await new Promise(resolve => setImmediate(resolve));
      }
      
      progressTracker.setMessage(getIndexingMessage());
    } finally {
      // Always release lock, even if an error occurs
      // This prevents deadlock where processingLock is never cleared
      releaseLock!();
      processingLock = null;
    }
  };
  
  // Process files with concurrency limit
  const filePromises = files.map((file) =>
    limit(async () => {
      try {
        // Get file stats to capture actual modification time
        const stats = await fs.stat(file);
        const content = await fs.readFile(file, 'utf-8');
        const chunkSize = isModernConfig(config)
          ? config.core.chunkSize
          : 75;
        const chunkOverlap = isModernConfig(config)
          ? config.core.chunkOverlap
          : 10;
        const useAST = isModernConfig(config)
          ? config.chunking.useAST
          : true;
        const astFallback = isModernConfig(config)
          ? config.chunking.astFallback
          : 'line-based';
        
        const chunks = chunkFile(file, content, {
          chunkSize,
          chunkOverlap,
          useAST,
          astFallback,
        });
        
        if (chunks.length === 0) {
          progressTracker.incrementFiles();
          return;
        }
        
        // Critical section: add chunks to shared state and check threshold
        // Must be protected with mutex to prevent race conditions
        {
          // Wait for any in-progress add operation
          if (addChunksLock) {
            await addChunksLock;
          }
          
          // Acquire lock
          let releaseAddLock: () => void;
          addChunksLock = new Promise<void>(resolve => {
            releaseAddLock = resolve;
          });
          
          try {
            // Add chunks to accumulator
            for (const chunk of chunks) {
              chunkAccumulator.push({
                chunk,
                content: chunk.content,
              });
            }
            
            // Track this file for manifest with actual file mtime
            indexedFileEntries.push({
              filepath: file,
              chunkCount: chunks.length,
              mtime: stats.mtimeMs,
            });
            
            progressTracker.incrementFiles();
            
            // Process when batch is large enough (use smaller batch for responsiveness)
            // Check is done inside the mutex to prevent multiple tasks from triggering processing
            if (chunkAccumulator.length >= vectorDBBatchSize) {
              await processAccumulatedChunks();
            }
          } finally {
            // Release lock
            releaseAddLock!();
            addChunksLock = null;
          }
        }
      } catch (error) {
        if (options.verbose) {
          console.error(chalk.yellow(`\n⚠️  Skipping ${file}: ${error}`));
        }
        progressTracker.incrementFiles();
      }
    })
  );
  
    // Wait for all files to be processed
    await Promise.all(filePromises);
    
    // Process remaining chunks
    progressTracker.setMessage('Processing final chunks...');
    await processAccumulatedChunks();
  } finally {
    // Always stop the progress tracker to clean up the interval
    progressTracker.stop();
  }
  
  // Save manifest with all indexed files
  spinner.start('Saving index manifest...');
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.updateFiles(
    indexedFileEntries.map(entry => ({
      filepath: entry.filepath,
      // Use actual file mtime for accurate change detection
      lastModified: entry.mtime,
      chunkCount: entry.chunkCount,
    }))
  );
  
  // Save git state if in a git repo
  await updateGitState(rootDir, vectorDB, manifest);
  
  spinner.succeed('Manifest saved');
  
  // Write version file to mark successful completion
  await writeVersionFile(vectorDB.dbPath);
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  spinner.succeed(
    `Indexed ${progressTracker.getProcessedCount()} files (${processedChunks} chunks) in ${totalTime}s using ${concurrency}x concurrency`
  );
  
  console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
}

/**
 * Index a codebase, creating vector embeddings for semantic search.
 * 
 * Refactored to be more maintainable:
 * - Tries incremental indexing first (if not forced)
 * - Falls back to full indexing if needed
 * - Delegates to helper functions for specific tasks
 * 
 * @param options - Indexing options
 */
export async function indexCodebase(options: IndexingOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const spinner = ora('Starting indexing process...').start();
  
  try {
    // Load configuration
    spinner.text = 'Loading configuration...';
    const config = await configService.load(rootDir);
    
    // Initialize vector database
    spinner.text = 'Initializing vector database...';
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    
    // Try incremental indexing first (unless forced)
    if (!options.force) {
      const completed = await tryIncrementalIndex(rootDir, vectorDB, config, options, spinner);
      if (completed) {
        return; // Incremental index completed
      }
    } else {
      spinner.text = 'Force flag enabled, performing full reindex...';
    }
    
    // Fall back to full index
    await performFullIndex(rootDir, vectorDB, config, options, spinner);
    
  } catch (error) {
    spinner.fail(`Indexing failed: ${error}`);
    throw error;
  }
}

