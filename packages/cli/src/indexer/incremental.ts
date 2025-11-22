import fs from 'fs/promises';
import { chunkFile } from './chunker.js';
import { EmbeddingService } from '../embeddings/types.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig, LegacyLienConfig, isModernConfig, isLegacyConfig } from '../config/schema.js';
import { ManifestManager } from './manifest.js';
import { ParallelFileReader } from './file-reader.js';

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
  embeddings: EmbeddingService,
  config: LienConfig | LegacyLienConfig,
  options: IncrementalIndexOptions = {}
): Promise<void> {
  const { verbose } = options;
  
  try {
    // Check if file exists
    try {
      await fs.access(filepath);
    } catch {
      // File doesn't exist - delete from index and manifest
      if (verbose) {
        console.error(`[Lien] File deleted: ${filepath}`);
      }
      await vectorDB.deleteByFile(filepath);
      
      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.removeFile(filepath);
      return;
    }
    
    // Read file content
    const content = await fs.readFile(filepath, 'utf-8');
    
    // Get chunk settings (support both v0.3.0 and legacy v0.2.0 configs)
    const chunkSize = isModernConfig(config)
      ? config.core.chunkSize
      : (isLegacyConfig(config) ? config.indexing.chunkSize : 75);
    const chunkOverlap = isModernConfig(config)
      ? config.core.chunkOverlap
      : (isLegacyConfig(config) ? config.indexing.chunkOverlap : 10);
    
    // Chunk the file
    const chunks = chunkFile(filepath, content, {
      chunkSize,
      chunkOverlap,
    });
    
    if (chunks.length === 0) {
      // Empty file - remove from index and manifest
      if (verbose) {
        console.error(`[Lien] Empty file: ${filepath}`);
      }
      await vectorDB.deleteByFile(filepath);
      
      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.removeFile(filepath);
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
    
    // Update manifest after successful indexing
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.updateFile(filepath, {
      filepath,
      lastModified: Date.now(),
      chunkCount: chunks.length,
    });
    
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
  embeddings: EmbeddingService,
  config: LienConfig | LegacyLienConfig,
  options: IncrementalIndexOptions = {}
): Promise<number> {
  const { verbose } = options;
  let successCount = 0;
  
  // Use parallel file reading for better performance
  const concurrency = isModernConfig(config)
    ? config.core.concurrency
    : 4;
  
  const fileReader = new ParallelFileReader(concurrency);
  const fileContents = await fileReader.readFiles(filepaths);
  
  // Batch manifest updates for performance
  const manifestEntries: Array<{ filepath: string; chunkCount: number }> = [];
  
  // Process each file with its content
  for (const filepath of filepaths) {
    const content = fileContents.get(filepath);
    
    if (!content) {
      // File doesn't exist or couldn't be read - delete from index
      if (verbose) {
        console.error(`[Lien] File not readable: ${filepath}`);
      }
      try {
        await vectorDB.deleteByFile(filepath);
        const manifest = new ManifestManager(vectorDB.dbPath);
        await manifest.removeFile(filepath);
      } catch (error) {
        // Ignore errors if file wasn't in index
        if (verbose) {
          console.error(`[Lien] Note: ${filepath} not in index`);
        }
      }
      // Count as successful processing (handled deletion)
      successCount++;
      continue;
    }
    
    try {
      // Get chunk settings
      const chunkSize = isModernConfig(config)
        ? config.core.chunkSize
        : (isLegacyConfig(config) ? config.indexing.chunkSize : 75);
      const chunkOverlap = isModernConfig(config)
        ? config.core.chunkOverlap
        : (isLegacyConfig(config) ? config.indexing.chunkOverlap : 10);
      
      // Chunk the file
      const chunks = chunkFile(filepath, content, {
        chunkSize,
        chunkOverlap,
      });
      
      if (chunks.length === 0) {
        // Empty file - remove from index and manifest
        if (verbose) {
          console.error(`[Lien] Empty file: ${filepath}`);
        }
        try {
          await vectorDB.deleteByFile(filepath);
          const manifest = new ManifestManager(vectorDB.dbPath);
          await manifest.removeFile(filepath);
        } catch (error) {
          // Ignore errors if file wasn't in index
          if (verbose) {
            console.error(`[Lien] Note: ${filepath} not in index`);
          }
        }
        // Count as successful processing (handled empty file)
        successCount++;
        continue;
      }
      
      // Generate embeddings for all chunks
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      
      // Delete old chunks if they exist (ignore errors if file not in index yet)
      try {
        await vectorDB.deleteByFile(filepath);
      } catch (error) {
        // Ignore - file might not be in index yet
      }
      
      // Insert new chunks
      await vectorDB.insertBatch(
        vectors,
        chunks.map(c => c.metadata),
        texts
      );
      
      // Queue manifest update (batch at end)
      manifestEntries.push({
        filepath,
        chunkCount: chunks.length,
      });
      
      if (verbose) {
        console.error(`[Lien] ✓ Updated ${filepath} (${chunks.length} chunks)`);
      }
      
      successCount++;
    } catch (error) {
      // Log error but don't throw - we want to continue with other files
      console.error(`[Lien] ⚠️  Failed to index ${filepath}: ${error}`);
    }
  }
  
  // Batch update manifest at the end (much faster than updating after each file)
  if (manifestEntries.length > 0) {
    const manifest = new ManifestManager(vectorDB.dbPath);
    await manifest.updateFiles(
      manifestEntries.map(entry => ({
        filepath: entry.filepath,
        lastModified: Date.now(),
        chunkCount: entry.chunkCount,
      }))
    );
  }
  
  return successCount;
}

