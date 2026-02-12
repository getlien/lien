import fs from 'fs/promises';
import path from 'path';
import type { LanceDBConnection, LanceDBTable } from './lancedb-types.js';
import type { ChunkMetadata } from '../indexer/types.js';
import { DatabaseError, wrapError } from '../errors/index.js';
import { writeVersionFile } from './version.js';
import { insertBatch } from './batch-insert.js';
import { escapeSqlString } from './query.js';

/**
 * Try to remove the .lance directory directly.
 * Returns true if removal succeeds, false on any error so the caller can attempt fallback.
 */
async function removeLanceDirectory(lanceDir: string): Promise<boolean> {
  try {
    await fs.rm(lanceDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback: drop the table first, then retry directory removal.
 */
async function dropTableAndRetryCleanup(
  db: LanceDBConnection,
  tableName: string,
  lanceDir: string,
): Promise<void> {
  try {
    await db.dropTable(tableName);
    await fs.rm(lanceDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

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
    if (dbPath) {
      const lanceDir = path.join(dbPath, `${tableName}.lance`);
      const removed = await removeLanceDirectory(lanceDir);
      if (!removed) {
        await dropTableAndRetryCleanup(db, tableName, lanceDir);
      }
    } else if (table) {
      await db.dropTable(tableName);
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
    await table.delete(`file = "${escapeSqlString(filepath)}"`);
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
