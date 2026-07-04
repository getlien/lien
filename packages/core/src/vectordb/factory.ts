import type { VectorDBInterface } from './types.js';
import { SqliteBackend } from './sqlite/sqlite-backend.js';
import { OverlayBackend } from './overlay-backend.js';
import { resolveIndexStrategy } from './overlay-resolution.js';
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
 * SqliteBackend (better-sqlite3 + FTS5 lexical search) is the sole backend.
 * `loadGlobalConfig` maps any retired backend selection to 'sqlite',
 * so the factory always constructs a SqliteBackend. The VectorDBInterface seam
 * is kept so an alternative backend could be reintroduced without touching
 * call sites.
 *
 * Loading the global config here surfaces validation errors early and emits
 * the one-time warning for retired backend settings.
 *
 * @param projectRoot - Root directory of the project
 * @param options.warn - Optional sink for worktree-fallback hints (e.g. "main
 *   checkout has no index"). Silent when omitted; `serve`/`index` pass a logger.
 * @returns VectorDBInterface instance for the configured backend
 */
export async function createVectorDB(
  projectRoot: string,
  options: { warn?: (message: string) => void } = {},
): Promise<VectorDBInterface> {
  // Load the global config for its side effects only: surface validation
  // errors early and emit the one-time retired-backend warning. The backend
  // choice itself is fixed — sqlite is the only reachable backend.
  try {
    await loadGlobalConfig();
  } catch (error) {
    // ConfigValidationError: Config file exists but has syntax/validation errors
    // This should fail hard with a clear error message
    if (error instanceof ConfigValidationError) {
      throw error; // Error message already has helpful details
    }

    // "File not found" is expected: no config file means the default backend (sqlite)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Any other error: fail hard with details
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        'Failed to load global config file. Please check your config file for errors.\n' +
          `Error: ${errorMessage}`,
      );
    }
  }

  // Worktree-aware: when projectRoot is a linked git worktree with a usable
  // main-checkout index, back it with an OverlayBackend (shared read-only base
  // + small writable overlay) instead of a full independent index. Every
  // uncertain condition resolves to standalone.
  const strategy = await resolveIndexStrategy(projectRoot, { warn: options.warn });
  const db: VectorDBInterface =
    strategy.mode === 'overlay'
      ? new OverlayBackend(projectRoot, strategy.baseIndexDir)
      : new SqliteBackend(projectRoot);
  validateVectorDBInterface(db);
  return db;
}
