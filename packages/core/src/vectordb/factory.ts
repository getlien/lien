import type { VectorDBInterface } from './types.js';
import { VectorDB } from './lancedb.js';
import { loadGlobalConfig, ConfigValidationError } from '../config/global-config.js';

/**
 * Validate that a VectorDB instance has the required methods.
 */
function validateVectorDBInterface(db: VectorDBInterface): void {
  if (typeof db.initialize !== 'function') {
    throw new Error('VectorDB instance missing initialize method');
  }
}

/**
 * Factory function to create a VectorDB instance.
 *
 * LanceDB is the only supported backend. The factory (and the
 * VectorDBInterface seam) is deliberately kept so an alternative backend
 * can be reintroduced later without touching call sites.
 *
 * Loading the global config here surfaces validation errors early and
 * emits the one-time warning for retired Qdrant settings.
 *
 * @param projectRoot - Root directory of the project
 * @returns VectorDBInterface instance (LanceDB)
 */
export async function createVectorDB(projectRoot: string): Promise<VectorDBInterface> {
  try {
    await loadGlobalConfig();
  } catch (error) {
    // ConfigValidationError: Config file exists but has syntax/validation errors
    // This should fail hard with a clear error message
    if (error instanceof ConfigValidationError) {
      throw error; // Error message already has helpful details
    }

    // "File not found" is expected: no config file means default LanceDB
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Any other error: fail hard with details
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        'Failed to load global config file. Please check your config file for errors.\n' +
          `Error: ${errorMessage}`,
      );
    }
  }

  const db = new VectorDB(projectRoot);
  validateVectorDBInterface(db);
  return db;
}
