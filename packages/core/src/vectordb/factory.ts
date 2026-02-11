import type { VectorDBInterface } from './types.js';
import { VectorDB } from './lancedb.js';
import { QdrantDB } from './qdrant.js';
import type { GlobalConfig } from '../config/global-config.js';
import {
  loadGlobalConfig,
  extractOrgIdFromGit,
  ConfigValidationError,
} from '../config/global-config.js';
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
  config: NonNullable<GlobalConfig['qdrant']>,
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
        'Make sure your project is a git repo with a remote configured (e.g., origin).',
    );
  }

  // Extract branch and commit from git (both are required for Qdrant isolation)
  // Fail fast if git commands fail - branch/commit tracking is essential for data isolation
  let branch: string;
  let commitSha: string;

  try {
    [branch, commitSha] = await Promise.all([
      getCurrentBranch(projectRoot),
      getCurrentCommit(projectRoot),
    ]);
  } catch (error) {
    throw new Error(
      'Qdrant backend requires a valid git branch and commit SHA for proper data isolation. ' +
        'Failed to detect current branch and/or commit from git. ' +
        'Ensure the repository is initialized, has at least one commit, and HEAD is not detached. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate that branch and commitSha are non-empty (fail-fast for invalid git state)
  if (!branch || branch.trim().length === 0) {
    throw new Error(
      'Qdrant backend requires a valid git branch for proper data isolation. ' +
        'Current branch is empty or whitespace. ' +
        'Ensure the repository is on a valid branch (not in detached HEAD state).',
    );
  }

  if (!commitSha || commitSha.trim().length === 0) {
    throw new Error(
      'Qdrant backend requires a valid git commit SHA for proper data isolation. ' +
        'Current commit SHA is empty or whitespace. ' +
        'Ensure the repository has at least one commit.',
    );
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
export async function createVectorDB(projectRoot: string): Promise<VectorDBInterface> {
  let globalConfig: GlobalConfig | null = null;

  try {
    globalConfig = await loadGlobalConfig();
  } catch (error) {
    // ConfigValidationError: Config file exists but has syntax/validation errors
    // This should fail hard with a clear error message
    if (error instanceof ConfigValidationError) {
      throw error; // Error message already has helpful details
    }

    // Check if this is a "file not found" error (expected)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Expected: No config file exists, use default LanceDB (normal for CLI usage)
      return await createLanceDB(projectRoot);
    }

    // Any other error: fail hard with details
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to load global config file. Please check your config file for errors.\n' +
        `Error: ${errorMessage}`,
    );
  }

  // Config loaded successfully - respect the backend choice
  switch (globalConfig.backend) {
    case 'qdrant':
      if (!globalConfig.qdrant) {
        throw new Error('Qdrant backend requires qdrant configuration in global config');
      }
      // Don't catch errors here - let Qdrant-specific errors propagate
      // User explicitly configured Qdrant, so they should see configuration errors
      return await createQdrantDB(projectRoot, globalConfig.qdrant);

    case 'lancedb':
    case undefined:
      return await createLanceDB(projectRoot);

    default:
      throw new Error(
        `Unknown storage backend: ${globalConfig.backend}. Supported backends: 'lancedb', 'qdrant'`,
      );
  }
}
