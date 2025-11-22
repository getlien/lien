import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { CodeChunk, ChunkMetadata } from './types.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isLegacyConfig, isModernConfig } from '../config/schema.js';
import { ManifestManager } from './manifest.js';
import { detectChanges } from './change-detector.js';
import { indexMultipleFiles } from './incremental.js';
import { GitStateTracker } from '../git/tracker.js';
import { isGitAvailable, isGitRepo } from '../git/utils.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
  force?: boolean;  // Force full reindex, skip incremental
}

interface ChunkWithContent {
  chunk: CodeChunk;
  content: string;
}

export async function indexCodebase(options: IndexingOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const spinner = ora('Starting indexing process...').start();
  
  try {
    // 1. Load configuration
    spinner.text = 'Loading configuration...';
    const config = await configService.load(rootDir);
    
    // 1.5. Initialize vector database early (needed for manifest)
    spinner.text = 'Initializing vector database...';
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    
    // 1.6. Try incremental indexing if manifest exists and not forced
    if (!options.force) {
      spinner.text = 'Checking for changes...';
      const manifest = new ManifestManager(vectorDB.dbPath);
      const savedManifest = await manifest.load();
      
      if (savedManifest) {
        // Initialize git tracker if available
        let gitTracker: GitStateTracker | null = null;
        const gitAvailable = await isGitAvailable();
        const isRepo = await isGitRepo(rootDir);
        
        if (gitAvailable && isRepo) {
          gitTracker = new GitStateTracker(rootDir, vectorDB.dbPath);
          await gitTracker.initialize();
        }
        
        // Detect changes
        const changes = await detectChanges(rootDir, vectorDB, gitTracker, config);
        
        if (changes.reason !== 'full') {
          const totalChanges = changes.added.length + changes.modified.length;
          const totalDeleted = changes.deleted.length;
          
          if (totalChanges === 0 && totalDeleted === 0) {
            spinner.succeed('No changes detected - index is up to date!');
            return;
          }
          
          spinner.succeed(
            `Detected changes: ${totalChanges} files to index, ${totalDeleted} to remove (${changes.reason} detection)`
          );
          
          // Initialize embeddings for incremental update
          spinner.start('Loading embedding model...');
          const embeddings = new LocalEmbeddings();
          await embeddings.initialize();
          spinner.succeed('Embedding model loaded');
          
          // Handle deletions
          if (totalDeleted > 0) {
            spinner.start(`Removing ${totalDeleted} deleted files...`);
            for (const filepath of changes.deleted) {
              await vectorDB.deleteByFile(filepath);
              await manifest.removeFile(filepath);
            }
            spinner.succeed(`Removed ${totalDeleted} deleted files`);
          }
          
          // Handle additions and modifications
          if (totalChanges > 0) {
            spinner.start(`Reindexing ${totalChanges} changed files...`);
            const filesToIndex = [...changes.added, ...changes.modified];
            const count = await indexMultipleFiles(
              filesToIndex,
              vectorDB,
              embeddings,
              config,
              { verbose: options.verbose }
            );
            
            // Update version file to trigger MCP reconnection
            await writeVersionFile(vectorDB.dbPath);
            
            spinner.succeed(
              `Incremental reindex complete: ${count}/${totalChanges} files indexed successfully`
            );
          }
          
          console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
          return; // Exit early - incremental index complete!
        }
        
        // If we get here, changes.reason === 'full', so continue with full index below
        spinner.text = 'Full reindex required...';
      }
    } else {
      spinner.text = 'Force flag enabled, performing full reindex...';
    }
    
    // 2. Scan for files (framework-aware if frameworks configured)
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
    
    // 3. Initialize embeddings model
    spinner.text = 'Loading embedding model (this may take a minute on first run)...';
    const embeddings = new LocalEmbeddings();
    await embeddings.initialize();
    spinner.succeed('Embedding model loaded');
    
    // 5. Process files concurrently
    const concurrency = isModernConfig(config) 
      ? config.core.concurrency 
      : 4;
    const embeddingBatchSize = isModernConfig(config)
      ? config.core.embeddingBatchSize
      : 50;
    // Use larger batch size for Vector DB inserts (but not too large to avoid UI freezes)
    const vectorDBBatchSize = 250;
    
    spinner.start(`Processing files with ${concurrency}x concurrency...`);
    
    const startTime = Date.now();
    let processedFiles = 0;
    let processedChunks = 0;
    
    // Accumulator for chunks across multiple files
    const chunkAccumulator: ChunkWithContent[] = [];
    const limit = pLimit(concurrency);
    
    // Track successfully indexed files for manifest
    const indexedFileEntries: Array<{ filepath: string; chunkCount: number }> = [];
    
    // Function to process accumulated chunks
    const processAccumulatedChunks = async () => {
      if (chunkAccumulator.length === 0) return;
      
      const toProcess = chunkAccumulator.splice(0, chunkAccumulator.length);
      
      // Process embeddings in smaller batches (memory constraint)
      // But accumulate for larger Vector DB inserts
      const vectorsToInsert: Float32Array[] = [];
      const metadataToInsert: ChunkMetadata[] = [];
      const contentsToInsert: string[] = [];
      
      for (let i = 0; i < toProcess.length; i += embeddingBatchSize) {
        const batch = toProcess.slice(i, Math.min(i + embeddingBatchSize, toProcess.length));
        
        const texts = batch.map(item => item.content);
        const embeddingVectors = await embeddings.embedBatch(texts);
        
        // Accumulate for larger DB insert
        vectorsToInsert.push(...embeddingVectors);
        metadataToInsert.push(...batch.map(item => item.chunk.metadata));
        contentsToInsert.push(...texts);
        
        processedChunks += batch.length;
        
        // Update progress after each embedding batch
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processedFiles / elapsed;
        const eta = rate > 0 ? Math.round((files.length - processedFiles) / rate) : 0;
        spinner.text = `Processing ${processedFiles}/${files.length} files (${processedChunks} chunks) | Embedding batch ${i}/${toProcess.length} | ETA: ${eta}s`;
      }
      
      // Insert all at once (VectorDB.insertBatch handles large batches internally)
      if (vectorsToInsert.length > 0) {
        spinner.text = `Inserting ${vectorsToInsert.length} chunks into Vector DB...`;
        await vectorDB.insertBatch(vectorsToInsert, metadataToInsert, contentsToInsert);
      }
    };
    
    // Process files with concurrency limit
    const filePromises = files.map((file) =>
      limit(async () => {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const chunkSize = isModernConfig(config)
            ? config.core.chunkSize
            : 75;
          const chunkOverlap = isModernConfig(config)
            ? config.core.chunkOverlap
            : 10;
          
          const chunks = chunkFile(file, content, {
            chunkSize,
            chunkOverlap,
          });
          
          if (chunks.length === 0) {
            processedFiles++;
            return;
          }
          
          // Add chunks to accumulator
          for (const chunk of chunks) {
            chunkAccumulator.push({
              chunk,
              content: chunk.content,
            });
          }
          
          // Track this file for manifest
          indexedFileEntries.push({
            filepath: file,
            chunkCount: chunks.length,
          });
          
          // Process when batch is large enough (use larger batch for efficiency)
          if (chunkAccumulator.length >= vectorDBBatchSize) {
            await processAccumulatedChunks();
          }
          
          processedFiles++;
          
          // Update progress
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processedFiles / elapsed;
          const eta = rate > 0 ? Math.round((files.length - processedFiles) / rate) : 0;
          
          spinner.text = `Indexed ${processedFiles}/${files.length} files (${processedChunks} chunks) | ${concurrency}x concurrency | ETA: ${eta}s`;
        } catch (error) {
          if (options.verbose) {
            console.error(chalk.yellow(`\n⚠️  Skipping ${file}: ${error}`));
          }
          processedFiles++;
        }
      })
    );
    
    // Wait for all files to be processed
    await Promise.all(filePromises);
    
    // Process remaining chunks
    await processAccumulatedChunks();
    
    // Save manifest with all indexed files
    spinner.start('Saving index manifest...');
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.updateFiles(
      indexedFileEntries.map(entry => ({
        filepath: entry.filepath,
        lastModified: Date.now(),
        chunkCount: entry.chunkCount,
      }))
    );
    spinner.succeed('Manifest saved');
    
    // Write version file to mark successful completion
    // This allows the MCP server to detect when reindexing is complete
    await writeVersionFile(vectorDB.dbPath);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(
      `Indexed ${processedFiles} files (${processedChunks} chunks) in ${totalTime}s using ${concurrency}x concurrency`
    );
    
    console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  } catch (error) {
    spinner.fail(`Indexing failed: ${error}`);
    throw error;
  }
}

