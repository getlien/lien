import { VectorDBInterface } from './types.js';
import { VectorDB } from './lancedb.js';
import { QdrantDB } from './qdrant.js';
import { loadGlobalConfig, extractOrgIdFromGit, GlobalConfig } from '../config/global-config.js';
import { getCurrentBranch, getCurrentCommit } from '../git/utils.js';

/**
 * Validate that a VectorDB instance has the required methods.
 */
function validateVectorDBInterface(db: VectorDBInterface): void {
  if (typeof db.initialize !== 'function') {
    throw new Error('VectorDB instance missing initialize method');
  }
}

/**
 * Create a LanceDB instance.
 */
async function createLanceDB(projectRoot: string): Promise<VectorDBInterface> {
  const db = new VectorDB(projectRoot);
  validateVectorDBInterface(db);
  return db;
}

/**
 * Create a QdrantDB instance.
 * Extracts orgId, branch, and commit from git repository.
 */
async function createQdrantDB(
  projectRoot: string,
  config: NonNullable<GlobalConfig['qdrant']>
): Promise<VectorDBInterface> {
  if (!config.url) {
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

  // Extract branch and commit from git (both are required for Qdrant isolation)
  // Log warnings if fallbacks are used, as this can lead to unintended data merging
  let branch: string;
  let commitSha: string;

  try {
    [branch, commitSha] = await Promise.all([
      getCurrentBranch(projectRoot),
      getCurrentCommit(projectRoot),
    ]);
  } catch (error) {
    // Use fallbacks but log warning - this can cause data merging issues
    console.warn(
      `[Lien] Warning: Failed to detect git branch/commit for Qdrant backend. ` +
      `Using fallback values ('main', 'unknown'). This may cause unintended data merging ` +
      `if multiple branches use the same fallback values. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    branch = 'main';
    commitSha = 'unknown';
  }

  const db = new QdrantDB(config.url, config.apiKey, orgId, projectRoot, branch, commitSha);
  validateVectorDBInterface(db);
  return db;
}

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
    
    switch (globalConfig.backend) {
      case 'qdrant':
        if (!globalConfig.qdrant) {
          throw new Error('Qdrant backend requires qdrant configuration in global config');
        }
        return await createQdrantDB(projectRoot, globalConfig.qdrant);
      
      case 'lancedb':
      case undefined:
        return await createLanceDB(projectRoot);
      
      default:
        throw new Error(`Unknown storage backend: ${globalConfig.backend}. Supported backends: 'lancedb', 'qdrant'`);
    }
  } catch (error) {
    // If anything goes wrong, fall back to LanceDB
    console.warn(`[Lien] Error creating vector DB, falling back to LanceDB: ${error}`);
    return await createLanceDB(projectRoot);
  }
}

