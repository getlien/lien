import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ChunkMetadata } from '@liendev/parser';
import { DatabaseError } from '../errors/index.js';
import { readVersionFile } from './version.js';

/**
 * Shared context passed from QdrantDB to maintenance functions.
 */
export interface QdrantMaintenanceContext {
  client: QdrantClient;
  collectionName: string;
  orgId: string;
  repoId: string;
  branch: string;
  commitSha: string;
  initialized: boolean;
  dbPath: string;
}

export async function clear(ctx: QdrantMaintenanceContext): Promise<void> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  try {
    // Check if collection exists before trying to clear it (returns { exists: boolean })
    const collectionCheck = await ctx.client.collectionExists(ctx.collectionName);
    if (!collectionCheck.exists) {
      // Collection doesn't exist yet, nothing to clear
      return;
    }

    // Delete all points for this repository and branch/commit only
    // This ensures we only clear the current branch's data, not all branches
    await ctx.client.delete(ctx.collectionName, {
      filter: {
        must: [
          { key: 'orgId', match: { value: ctx.orgId } },
          { key: 'repoId', match: { value: ctx.repoId } },
          { key: 'branch', match: { value: ctx.branch } },
          { key: 'commitSha', match: { value: ctx.commitSha } },
        ],
      },
    });
  } catch (error) {
    throw new DatabaseError(
      `Failed to clear Qdrant collection: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName },
    );
  }
}

/**
 * Clear all data for a specific branch (all commits).
 *
 * Qdrant-only helper: this is not part of the generic VectorDBInterface and
 * is intended for cloud/PR workflows where multiple commits exist per branch.
 * LanceDB and other backends do not implement this method.
 *
 * @param ctx - Maintenance context
 * @param branch - Branch name to clear (defaults to current branch)
 */
export async function clearBranch(ctx: QdrantMaintenanceContext, branch?: string): Promise<void> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  const targetBranch = branch ?? ctx.branch;

  try {
    const collectionCheck = await ctx.client.collectionExists(ctx.collectionName);
    if (!collectionCheck.exists) {
      // Collection doesn't exist yet, nothing to clear
      return;
    }

    // Delete all points for this repository and branch (all commits)
    await ctx.client.delete(ctx.collectionName, {
      filter: {
        must: [
          { key: 'orgId', match: { value: ctx.orgId } },
          { key: 'repoId', match: { value: ctx.repoId } },
          { key: 'branch', match: { value: targetBranch } },
        ],
      },
    });
  } catch (error) {
    throw new DatabaseError(
      `Failed to clear branch from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName, branch: targetBranch },
    );
  }
}

export async function deleteByFile(ctx: QdrantMaintenanceContext, filepath: string): Promise<void> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  try {
    await ctx.client.delete(ctx.collectionName, {
      filter: {
        must: [
          { key: 'orgId', match: { value: ctx.orgId } },
          { key: 'repoId', match: { value: ctx.repoId } },
          { key: 'branch', match: { value: ctx.branch } },
          { key: 'commitSha', match: { value: ctx.commitSha } },
          { key: 'file', match: { value: filepath } },
        ],
      },
    });
  } catch (error) {
    throw new DatabaseError(
      `Failed to delete file from Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName, filepath },
    );
  }
}

export async function updateFile(
  ctx: QdrantMaintenanceContext,
  filepath: string,
  deleteByFileFn: (filepath: string) => Promise<void>,
  insertBatchFn: (
    vectors: Float32Array[],
    metadatas: ChunkMetadata[],
    contents: string[],
  ) => Promise<void>,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): Promise<void> {
  if (!ctx.initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
    throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length');
  }

  try {
    // Delete existing chunks for this file
    await deleteByFileFn(filepath);

    // Insert new chunks
    if (vectors.length > 0) {
      await insertBatchFn(vectors, metadatas, contents);
    }
  } catch (error) {
    throw new DatabaseError(
      `Failed to update file in Qdrant: ${error instanceof Error ? error.message : String(error)}`,
      { collectionName: ctx.collectionName, filepath },
    );
  }
}

export async function hasData(ctx: QdrantMaintenanceContext): Promise<boolean> {
  if (!ctx.initialized) {
    return false;
  }

  try {
    const info = await ctx.client.getCollection(ctx.collectionName);
    return (info.points_count || 0) > 0;
  } catch {
    return false;
  }
}

export async function checkVersion(
  dbPath: string,
  lastVersionCheck: number,
  currentVersion: number,
): Promise<{ changed: boolean; newLastCheck: number; newVersion: number }> {
  const now = Date.now();

  // Cache version checks for 1 second to minimize I/O
  if (now - lastVersionCheck < 1000) {
    return { changed: false, newLastCheck: lastVersionCheck, newVersion: currentVersion };
  }

  try {
    const version = await readVersionFile(dbPath);

    if (version > currentVersion) {
      return { changed: true, newLastCheck: now, newVersion: version };
    }

    return { changed: false, newLastCheck: now, newVersion: currentVersion };
  } catch {
    // If we can't read version file, don't reconnect
    return { changed: false, newLastCheck: now, newVersion: currentVersion };
  }
}
