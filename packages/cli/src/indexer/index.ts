import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import { scanCodebase } from './scanner.js';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { loadConfig } from '../config/loader.js';
import { CodeChunk } from './types.js';

export interface IndexingOptions {
  rootDir?: string;
  verbose?: boolean;
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
    
    // 5. Process files
    spinner.start('Processing files...');
    let processedChunks = 0;
    let processedFiles = 0;
    const batchSize = 10;
    const startTime = Date.now();
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const chunks = chunkFile(file, content, {
          chunkSize: config.indexing.chunkSize,
          chunkOverlap: config.indexing.chunkOverlap,
        });
        
        if (chunks.length === 0) {
          continue;
        }
        
        // Process chunks in batches
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
          const texts = batch.map(c => c.content);
          
          // Generate embeddings
          const embeddingVectors = await embeddings.embedBatch(texts);
          
          // Store in vector DB
          await vectorDB.insertBatch(
            embeddingVectors,
            batch.map(c => c.metadata),
            texts
          );
          
          processedChunks += batch.length;
          
          // Update progress
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processedFiles / elapsed;
          const eta = Math.round((files.length - processedFiles) / rate);
          
          spinner.text = `Indexed ${processedFiles}/${files.length} files (${processedChunks} chunks) | ETA: ${eta}s`;
        }
        
        processedFiles++;
      } catch (error) {
        if (options.verbose) {
          console.error(chalk.yellow(`\n⚠️  Skipping ${file}: ${error}`));
        }
        // Continue with next file
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(
      `Indexed ${processedFiles} files (${processedChunks} chunks) in ${totalTime}s`
    );
    
    console.log(chalk.dim('\nNext step: Run'), chalk.bold('lien serve'), chalk.dim('to start the MCP server'));
  } catch (error) {
    spinner.fail(`Indexing failed: ${error}`);
    throw error;
  }
}

