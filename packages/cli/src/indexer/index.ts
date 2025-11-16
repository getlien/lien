import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase, scanCodebaseWithFrameworks } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { CodeChunk } from './types.js';
import { writeVersionFile } from '../vectordb/version.js';
import { isLegacyConfig, isModernConfig } from '../config/schema.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
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
    
    // 4. Initialize vector database
    spinner.start('Initializing vector database...');
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    spinner.succeed('Vector database initialized');
    
    // 5. Process files concurrently
    const concurrency = isModernConfig(config) 
      ? config.core.concurrency 
      : 4;
    const batchSize = isModernConfig(config)
      ? config.core.embeddingBatchSize
      : 50;
    
    spinner.start(`Processing files with ${concurrency}x concurrency...`);
    
    const startTime = Date.now();
    let processedFiles = 0;
    let processedChunks = 0;
    
    // Accumulator for chunks across multiple files
    const chunkAccumulator: ChunkWithContent[] = [];
    const limit = pLimit(concurrency);
    
    // Function to process accumulated chunks
    const processAccumulatedChunks = async () => {
      if (chunkAccumulator.length === 0) return;
      
      const toProcess = chunkAccumulator.splice(0, chunkAccumulator.length);
      
      // Process in batches
      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, Math.min(i + batchSize, toProcess.length));
        
        const texts = batch.map(item => item.content);
        const embeddingVectors = await embeddings.embedBatch(texts);
        
        await vectorDB.insertBatch(
          embeddingVectors,
          batch.map(item => item.chunk.metadata),
          texts
        );
        
        processedChunks += batch.length;
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
          
          // Process when batch is large enough
          if (chunkAccumulator.length >= batchSize) {
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

