import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import pLimit from 'p-limit';
import { scanCodebase } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { loadConfig } from '../config/loader.js';
import { CodeChunk } from './types.js';
import { writeVersionFile } from '../vectordb/version.js';

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
    const config = await loadConfig(rootDir);
    
    // 2. Scan for files
    spinner.text = 'Scanning codebase...';
    const files = await scanCodebase({
      rootDir,
      includePatterns: config.indexing.include,
      excludePatterns: config.indexing.exclude,
    });
    
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
    const concurrency = config.indexing.concurrency;
    const batchSize = config.indexing.embeddingBatchSize;
    
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
          const chunks = chunkFile(file, content, {
            chunkSize: config.indexing.chunkSize,
            chunkOverlap: config.indexing.chunkOverlap,
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

