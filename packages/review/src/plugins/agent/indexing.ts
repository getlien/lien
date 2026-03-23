/**
 * Full codebase indexing helper for the agent review plugin.
 *
 * Builds a LanceDB index with vector embeddings so the agent can use
 * semantic_search and other VectorDB-backed tools during investigation.
 */

import { indexCodebase, createVectorDB, WorkerEmbeddings } from '@liendev/core';
import type { VectorDBInterface, EmbeddingService } from '@liendev/core';
import type { Logger } from '../../logger.js';

/**
 * Build a full LanceDB index with embeddings for the given repo directory.
 *
 * Creates a WorkerEmbeddings instance, runs full indexing via `indexCodebase`,
 * then initializes a VectorDB connection for tool queries.
 *
 * @param rootDir - Root directory of the cloned repo
 * @param logger - Logger for progress output
 * @returns Initialized VectorDB and EmbeddingService instances
 */
export async function buildFullIndex(
  rootDir: string,
  logger: Logger,
): Promise<{ vectorDB: VectorDBInterface; embeddings: EmbeddingService }> {
  logger.info('[agent] Building full index with embeddings...');
  const start = Date.now();

  const embeddings = new WorkerEmbeddings();
  await embeddings.initialize();

  const result = await indexCodebase({ rootDir, force: true, embeddings });
  if (!result.success) {
    throw new Error(`Indexing failed: ${result.error ?? 'unknown error'}`);
  }

  logger.info(
    `[agent] Indexed ${result.filesIndexed} files, ${result.chunksCreated} chunks (${Date.now() - start}ms)`,
  );

  const vectorDB = await createVectorDB(rootDir);
  await vectorDB.initialize();

  return { vectorDB, embeddings };
}
