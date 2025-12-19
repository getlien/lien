import { VectorDBInterface } from './types.js';
import { VectorDB } from './lancedb.js';
import { QdrantDB } from './qdrant.js';
import { LienConfig, LegacyLienConfig, isModernConfig } from '../config/schema.js';

/**
 * Factory function to create a VectorDB instance based on configuration.
 * 
 * Selects the backend (LanceDB or Qdrant) based on config.storage.backend.
 * Defaults to LanceDB for backward compatibility.
 * 
 * @param projectRoot - Root directory of the project
 * @param config - Lien configuration
 * @returns VectorDBInterface instance (LanceDB or QdrantDB)
 * @throws Error if Qdrant config is invalid or missing required fields
 */
export function createVectorDB(
  projectRoot: string,
  config: LienConfig | LegacyLienConfig
): VectorDBInterface {
  // Legacy configs always use LanceDB
  if (!isModernConfig(config)) {
    return new VectorDB(projectRoot);
  }

  // Check storage config
  const storageConfig = config.storage;
  
  // Default to LanceDB if no storage config or backend not specified
  if (!storageConfig || !storageConfig.backend || storageConfig.backend === 'lancedb') {
    return new VectorDB(projectRoot);
  }

  // Create QdrantDB instance
  if (storageConfig.backend === 'qdrant') {
    if (!storageConfig.qdrant) {
      throw new Error('Qdrant backend requires storage.qdrant configuration');
    }

    const { url, apiKey, orgId } = storageConfig.qdrant;

    if (!url) {
      throw new Error('Qdrant backend requires storage.qdrant.url');
    }

    if (!orgId) {
      throw new Error('Qdrant backend requires storage.qdrant.orgId');
    }

    return new QdrantDB(url, apiKey, orgId, projectRoot);
  }

  // Unknown backend - fallback to LanceDB
  throw new Error(`Unknown storage backend: ${storageConfig.backend}. Supported backends: 'lancedb', 'qdrant'`);
}

