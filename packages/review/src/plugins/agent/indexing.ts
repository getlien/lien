/**
 * Full codebase indexing helper for the agent review plugin.
 *
 * Builds a LanceDB index with vector embeddings so the agent can use
 * semantic_search and other VectorDB-backed tools during investigation.
 *
 * Uses a shared promise so multiple agent plugin instances (e.g., Sonnet + MiniMax)
 * running in parallel only build the index once.
 */

import { indexCodebase, createVectorDB, WorkerEmbeddings } from '@liendev/core';
import type { VectorDBInterface, EmbeddingService } from '@liendev/core';
import type { Logger } from '../../logger.js';

interface IndexResult {
  vectorDB: VectorDBInterface;
  embeddings: EmbeddingService;
}

/** Shared promise keyed by rootDir so concurrent callers reuse the same build. */
let pendingBuild: { rootDir: string; promise: Promise<IndexResult> } | null = null;

/**
 * Build a full LanceDB index with embeddings for the given repo directory.
 *
 * Safe to call concurrently — the first caller builds the index,
 * subsequent callers for the same rootDir await the same promise.
 */
export function buildFullIndex(rootDir: string, logger: Logger): Promise<IndexResult> {
  if (pendingBuild && pendingBuild.rootDir === rootDir) {
    logger.info('[agent] Reusing in-progress index build...');
    return pendingBuild.promise;
  }

  const promise = doBuildFullIndex(rootDir, logger).finally(() => {
    pendingBuild = null;
  });

  pendingBuild = { rootDir, promise };
  return promise;
}

async function doBuildFullIndex(rootDir: string, logger: Logger): Promise<IndexResult> {
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
