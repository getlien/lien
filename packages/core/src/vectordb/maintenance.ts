import fs from 'fs/promises';
import path from 'path';
import type { LanceDBConnection, LanceDBTable } from './lancedb-types.js';
import type { ChunkMetadata } from '../indexer/types.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { writeVersionFile } from './version.js';
import { insertBatch } from './batch-insert.js';

/**
 * Clear all data from the vector database.
 * Drops the table AND cleans up the .lance directory to prevent corrupted state.
 */
export async function clear(
  db: LanceDBConnection | null,
  table: LanceDBTable | null,
  tableName: string,
  dbPath?: string,
): Promise<void> {
  if (!db) {
    throw new DatabaseError('Vector database not initialized');
  }

  try {
    // Clean up the .lance directory directly
    // This is more reliable than dropTable which can have locking issues
    if (dbPath) {
      const lanceDir = path.join(dbPath, `${tableName}.lance`);
      try {
        await fs.rm(lanceDir, { recursive: true, force: true });
      } catch (err: any) {
        // If deletion fails, try dropping the table first
        if (err?.code === 'ENOTEMPTY' || err?.message?.includes('not empty')) {
          try {
            await db.dropTable(tableName);
            // Try deletion again after dropping
            await fs.rm(lanceDir, { recursive: true, force: true });
          } catch {
            // Ignore - best effort cleanup
          }
        }
      }
    } else {
      // No dbPath provided, just drop the table
      if (table) {
        await db.dropTable(tableName);
      }
    }
  } catch (error) {
    throw wrapError(error, 'Failed to clear vector database');
  }
}

/**
 * Delete all chunks from a specific file
 */
export async function deleteByFile(table: LanceDBTable | null, filepath: string): Promise<void> {
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
  contents: string[],
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
      const result = await insertBatch(db, table, tableName, vectors, metadatas, contents);
      if (!result) {
        throw new DatabaseError('insertBatch unexpectedly returned null');
      }
      updatedTable = result;
    }

    // 3. Update version file to trigger MCP reconnection
    await writeVersionFile(dbPath);

    return updatedTable;
  } catch (error) {
    throw wrapError(error, 'Failed to update file in vector database');
  }
}
