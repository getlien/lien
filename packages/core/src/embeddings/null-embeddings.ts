import type { EmbeddingService } from './types.js';
import { EMBEDDING_DIMENSION } from './types.js';

/**
 * No-op embedding service used for structural-only mode.
 *
 * When embeddings are disabled (config `embeddings.enabled: false`, or
 * `lien index --no-embeddings`), this service is substituted for
 * `WorkerEmbeddings`/`LocalEmbeddings` wherever an `EmbeddingService` is
 * expected. `embed`/`embedBatch` return zero-filled vectors of the correct
 * dimension instead of computing real ones, so the existing
 * chunk -> vector -> VectorDB pipeline (and its fixed-width LanceDB vector
 * column) runs completely unchanged: structural columns (imports, exports,
 * callSites, complexity, etc.) are populated normally, and the structural
 * tools — `get_files_context`, `get_dependents`, `list_functions`,
 * `get_complexity` — which read via column scans rather than vector search,
 * keep working against a normally-persisted index.
 *
 * Semantic search over all-zero vectors is meaningless by design. Callers
 * must gate `search_code`/`find_similar` on whether embeddings are
 * enabled rather than relying on the vectors themselves (see
 * `mcp/handlers/semantic-search.ts` and `mcp/handlers/find-similar.ts`).
 *
 * `initialize()` and `dispose()` are no-ops: no model download, no worker
 * thread, no CPU cost.
 */
export class NullEmbeddings implements EmbeddingService {
  async initialize(): Promise<void> {
    // No model to load.
  }

  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array(EMBEDDING_DIMENSION);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(EMBEDDING_DIMENSION));
  }

  async dispose(): Promise<void> {
    // Nothing to clean up.
  }
}
