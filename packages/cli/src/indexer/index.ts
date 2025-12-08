import fs from 'fs/promises';
import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isLegacyConfig, isModernConfig, type LienConfig, type LegacyLienConfig } from '../config/schema.js';
import { ManifestManager } from './manifest.js';
import { detectChanges } from './change-detector.js';
import { indexMultipleFiles } from './incremental.js';
import { getModelLoadingMessage } from '../utils/loading-messages.js';
import { IndexingProgressTracker } from './progress-tracker.js';
import type { EmbeddingService } from '../embeddings/types.js';
import { ChunkBatchProcessor, type FileIndexEntry } from './chunk-batch-processor.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
  force?: boolean;  // Force full reindex, skip incremental
}

/** Extracted config values with defaults for indexing */
interface IndexingConfig {
  concurrency: number;
  embeddingBatchSize: number;
  chunkSize: number;
  chunkOverlap: number;
  useAST: boolean;
  astFallback: 'line-based' | 'error';
}

/** Extract indexing config values with defaults */
function getIndexingConfig(config: LienConfig | LegacyLienConfig): IndexingConfig {
  if (isModernConfig(config)) {
    return {
      concurrency: config.core.concurrency,
      embeddingBatchSize: config.core.embeddingBatchSize,
      chunkSize: config.core.chunkSize,
      chunkOverlap: config.core.chunkOverlap,
      useAST: config.chunking.useAST,
      astFallback: config.chunking.astFallback,
    };
  }
  // Legacy defaults
  return {
    concurrency: 4,
    embeddingBatchSize: 50,
    chunkSize: 75,
    chunkOverlap: 10,
    useAST: true,
    astFallback: 'line-based',
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
 * Process a single file for indexing.
 * Extracts chunks and adds them to the batch processor.
 *
 * @returns true if file was processed successfully, false if skipped
 */
async function processFileForIndexing(
  file: string,
  batchProcessor: ChunkBatchProcessor,
  indexConfig: IndexingConfig,
  progressTracker: IndexingProgressTracker,
  verbose: boolean
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
    });

    if (chunks.length === 0) {
      progressTracker.incrementFiles();
      return false;
    }

    // Add chunks to batch processor (handles mutex internally)
    await batchProcessor.addChunks(chunks, file, stats.mtimeMs);
    progressTracker.incrementFiles();

    return true;
  } catch (error) {
    if (verbose) {
      console.error(chalk.yellow(`\n⚠️  Skipping ${file}: ${error}`));
    }
    progressTracker.incrementFiles();
    return false;
  }
}

/**
 * Save index results: manifest, git state, version file.
 */
async function saveIndexResults(
  indexedFiles: FileIndexEntry[],
  vectorDB: VectorDB,
  rootDir: string,
  spinner: Ora
): Promise<void> {
  spinner.start('Saving index manifest...');

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

  spinner.succeed('Manifest saved');

  // Write version file to mark successful completion
  await writeVersionFile(vectorDB.dbPath);
}

/**
 * Perform a full index of the codebase.
 *
 * Refactored for maintainability:
 * - ChunkBatchProcessor handles concurrent chunk accumulation and mutex management
 * - processFileForIndexing handles individual file processing
 * - saveIndexResults handles finalization
 *
 * Complexity reduced from ~210 lines to ~50 lines in main function.
 */
async function performFullIndex(
  rootDir: string,
  vectorDB: VectorDB,
  config: LienConfig | LegacyLienConfig,
  options: IndexingOptions,
  spinner: Ora
): Promise<void> {
  const startTime = Date.now();

  // 1. Clear existing index (required for schema changes)
  spinner.text = 'Clearing existing index...';
  await vectorDB.clear();

  // 2. Scan for files
  spinner.text = 'Scanning codebase...';
  const files = await scanFilesToIndex(rootDir, config);

  if (files.length === 0) {
    spinner.fail('No files found to index');
    return;
  }

  spinner.text = `Found ${files.length} files`;

  // 3. Initialize embeddings model
  spinner.text = getModelLoadingMessage();
  const embeddings = new LocalEmbeddings();
  await embeddings.initialize();
  spinner.succeed('Embedding model loaded');

  // 4. Setup processing infrastructure
  const indexConfig = getIndexingConfig(config);
  const progressTracker = new IndexingProgressTracker(files.length, spinner);
  const batchProcessor = new ChunkBatchProcessor(vectorDB, embeddings, {
    batchThreshold: 100, // Smaller batch for UI responsiveness
    embeddingBatchSize: indexConfig.embeddingBatchSize,
  }, progressTracker);

  spinner.start(`Processing files with ${indexConfig.concurrency}x concurrency...`);
  progressTracker.start();

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
  } finally {
    progressTracker.stop();
  }

  // 7. Save results
  const { processedChunks, indexedFiles } = batchProcessor.getResults();
  await saveIndexResults(indexedFiles, vectorDB, rootDir, spinner);

  // 8. Report completion
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  spinner.succeed(
    `Indexed ${progressTracker.getProcessedCount()} files (${processedChunks} chunks) in ${totalTime}s using ${indexConfig.concurrency}x concurrency`
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

