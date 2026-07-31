import path from 'path';
import { getLienHome } from './lien-home.js';
import { extractRepoId } from './repo-id.js';

/**
 * Resolve the per-project index directory: `<LIEN_HOME>/.lien/indices/<repoId>`.
 *
 * This is the single source of truth for where a project's structural store,
 * manifest, and version file live. `SqliteBackend` and the worktree overlay
 * resolution both derive their paths from here so a project root and its index
 * dir never drift apart.
 */
export function getIndexDir(projectRoot: string): string {
  return path.join(getLienHome(), '.lien', 'indices', extractRepoId(projectRoot));
}
