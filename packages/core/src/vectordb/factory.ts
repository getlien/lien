import { VectorDBInterface } from './types.js';
import { VectorDB } from './lancedb.js';
import { QdrantDB } from './qdrant.js';
import { loadGlobalConfig, extractOrgIdFromGit } from '../config/global-config.js';

/**
 * Factory function to create a VectorDB instance based on global configuration.
 * 
 * Selects the backend (LanceDB or Qdrant) based on global config.
 * Defaults to LanceDB if no config is provided.
 * 
 * For Qdrant backend, automatically detects orgId from git remote URL.
 * 
 * @param projectRoot - Root directory of the project
 * @returns VectorDBInterface instance (LanceDB or QdrantDB)
 * @throws Error if Qdrant config is invalid or orgId cannot be detected
 */
export async function createVectorDB(
  projectRoot: string
): Promise<VectorDBInterface> {
  try {
    const globalConfig = await loadGlobalConfig();
    
    // Default to LanceDB if no backend specified or backend is lancedb
    if (!globalConfig.backend || globalConfig.backend === 'lancedb') {
      const db = new VectorDB(projectRoot);
      // Verify it has the required methods
      if (typeof db.initialize !== 'function') {
        throw new Error('VectorDB instance missing initialize method');
      }
      return db;
    }

    // Create QdrantDB instance
    if (globalConfig.backend === 'qdrant') {
      if (!globalConfig.qdrant) {
        throw new Error('Qdrant backend requires qdrant configuration in global config');
      }

      const { url, apiKey } = globalConfig.qdrant;

      if (!url) {
        throw new Error('Qdrant backend requires qdrant.url in global config');
      }

      // Auto-detect orgId from git remote
      const orgId = await extractOrgIdFromGit(projectRoot);
      
      if (!orgId) {
        throw new Error(
          'Qdrant backend requires a git repository with a remote URL. ' +
          'Could not extract organization ID from git remote. ' +
          'Make sure your project is a git repo with a remote configured (e.g., origin).'
        );
      }

      const db = new QdrantDB(url, apiKey, orgId, projectRoot);
      // Verify it has the required methods
      if (typeof db.initialize !== 'function') {
        throw new Error('QdrantDB instance missing initialize method');
      }
      return db;
    }

    // Unknown backend - fallback to LanceDB
    throw new Error(`Unknown storage backend: ${globalConfig.backend}. Supported backends: 'lancedb', 'qdrant'`);
  } catch (error) {
    // If anything goes wrong, fall back to LanceDB
    console.warn(`[Lien] Error creating vector DB, falling back to LanceDB: ${error}`);
    const db = new VectorDB(projectRoot);
    if (typeof db.initialize !== 'function') {
      throw new Error(`Failed to create VectorDB: ${error instanceof Error ? error.message : String(error)}`);
    }
    return db;
  }
}

