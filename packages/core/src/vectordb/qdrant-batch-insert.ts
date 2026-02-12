import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ChunkMetadata } from '../indexer/types.js';
import type { QdrantPayloadMapper } from './qdrant-payload-mapper.js';
import { DatabaseError } from '../errors/index.js';
import { VECTOR_DB_MAX_BATCH_SIZE } from '../constants.js';

/**
 * Validate batch input arrays have matching lengths.
 */
export function validateBatchInputs(
  initialized: boolean,
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
): void {
  if (!initialized) {
    throw new DatabaseError('Qdrant database not initialized');
  }

  if (vectors.length !== metadatas.length || vectors.length !== contents.length) {
    throw new DatabaseError('Vectors, metadatas, and contents arrays must have the same length', {
      vectorsLength: vectors.length,
      metadatasLength: metadatas.length,
      contentsLength: contents.length,
    });
  }
}

/**
 * Prepare Qdrant points from vectors, metadatas, and contents.
 */
export function preparePoints(
  vectors: Float32Array[],
  metadatas: ChunkMetadata[],
  contents: string[],
  payloadMapper: QdrantPayloadMapper,
  generatePointId: (metadata: ChunkMetadata) => string,
): Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> {
  return vectors.map((vector, i) => {
    const metadata = metadatas[i];
    const payload = payloadMapper.toPayload(metadata, contents[i]) as unknown as Record<
      string,
      unknown
    >;

    return {
      id: generatePointId(metadata),
      vector: Array.from(vector),
      payload,
    };
  });
}

/**
 * Insert a batch of points into Qdrant.
 */
export async function insertBatch(
  client: QdrantClient,
  collectionName: string,
  points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>,
): Promise<void> {
  const batchSize = VECTOR_DB_MAX_BATCH_SIZE;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, Math.min(i + batchSize, points.length));
    await client.upsert(collectionName, {
      wait: true,
      points: batch,
    });
  }
}
