import fs from 'fs/promises';
import path from 'path';
import { chunkFile } from './chunker.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';

export interface IncrementalIndexOptions {
  verbose?: boolean;
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
  vectorDB: VectorDB,
  embeddings: LocalEmbeddings,
  config: LienConfig,
  options: IncrementalIndexOptions = {}
): Promise<void> {
  const { verbose } = options;
  
  try {
    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      // File doesn't exist - delete from index
      if (verbose) {
        console.error(`[Lien] File deleted: ${filepath}`);
      }
      await vectorDB.deleteByFile(filepath);
      return;
    }
    
    // Read file content
    const content = await fs.readFile(filepath, 'utf-8');
    
    // Chunk the file
    const chunks = chunkFile(filepath, content, {
      chunkSize: config.indexing.chunkSize,
      chunkOverlap: config.indexing.chunkOverlap,
    });
    
    if (chunks.length === 0) {
      // Empty file - remove from index
      if (verbose) {
        console.error(`[Lien] Empty file: ${filepath}`);
      }
      await vectorDB.deleteByFile(filepath);
      return;
    }
    
    // Generate embeddings for all chunks
    const texts = chunks.map(c => c.content);
    const vectors = await embeddings.embedBatch(texts);
    
    // Update file in database (atomic: delete old + insert new)
    await vectorDB.updateFile(
      filepath,
      vectors,
      chunks.map(c => c.metadata),
      texts
    );
    
    if (verbose) {
      console.error(`[Lien] ✓ Updated ${filepath} (${chunks.length} chunks)`);
    }
  } catch (error) {
    // Log error but don't throw - we want to continue with other files
    console.error(`[Lien] ⚠️  Failed to index ${filepath}: ${error}`);
  }
}

/**
 * Indexes multiple files incrementally.
 * Processes files sequentially to avoid overwhelming the embedding model.
 * 
 * @param filepaths - Array of absolute file paths to index
 * @param vectorDB - Initialized VectorDB instance
 * @param embeddings - Initialized embeddings service
 * @param config - Lien configuration
 * @param options - Optional settings
 * @returns Number of successfully indexed files
 */
export async function indexMultipleFiles(
  filepaths: string[],
  vectorDB: VectorDB,
  embeddings: LocalEmbeddings,
  config: LienConfig,
  options: IncrementalIndexOptions = {}
): Promise<number> {
  const { verbose } = options;
  let successCount = 0;
  
  for (const filepath of filepaths) {
    try {
      await indexSingleFile(filepath, vectorDB, embeddings, config, options);
      successCount++;
    } catch (error) {
      // Error already logged in indexSingleFile
      if (verbose) {
        console.error(`[Lien] Failed to process ${filepath}`);
      }
    }
  }
  
  return successCount;
}

