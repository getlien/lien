import { ChunkMetadata } from '../indexer/types.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { writeVersionFile } from './version.js';
import { insertBatch } from './batch-insert.js';

type LanceDBConnection = any;
type LanceDBTable = any;

/**
 * Clear all data from the vector database
 */
export async function clear(
  db: LanceDBConnection,
  table: LanceDBTable | null,
  tableName: string
): Promise<void> {
  if (!db) {
    throw new DatabaseError('Vector database not initialized');
  }
  
  try {
    // Drop table if it exists
    if (table) {
      await db.dropTable(tableName);
    }
  } catch (error) {
    throw wrapError(error, 'Failed to clear vector database');
  }
}

/**
 * Delete all chunks from a specific file
 */
export async function deleteByFile(
  table: LanceDBTable,
  filepath: string
): Promise<void> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }
  
  try {
    await table.delete(`file = "${filepath}"`);
  } catch (error) {
    throw wrapError(error, 'Failed to delete file from vector database');
  }
}

/**
 * Update a file in the index by atomically deleting old chunks and inserting new ones
 */
export async function updateFile(
  db: LanceDBConnection,
  table: LanceDBTable | null,
  tableName: string,
  dbPath: string,
  filepath: string,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[]
): Promise<LanceDBTable> {
  if (!table) {
    throw new DatabaseError('Vector database not initialized');
  }
  
  try {
    // 1. Delete old chunks from this file
    await deleteByFile(table, filepath);
    
    // 2. Insert new chunks (if any)
    let updatedTable = table;
    if (vectors.length > 0) {
      updatedTable = await insertBatch(db, table, tableName, vectors, metadatas, contents);
    }
    
    // 3. Update version file to trigger MCP reconnection
    await writeVersionFile(dbPath);
    
    return updatedTable;
  } catch (error) {
    throw wrapError(error, 'Failed to update file in vector database');
  }
}

