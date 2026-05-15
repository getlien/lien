import path from 'path';
import os from 'os';
import { extractRepoId } from '@liendev/parser';
import { resolveProjectRoot } from './project-root.js';

/**
 * Return the per-repo store root that backs the index and the edit-gate.
 * Resolved against the project root (walks up for .git) so the value stays
 * stable from any subdirectory. Output uses forward slashes so the bash
 * hook scripts can splice it without escape-character mishaps on Windows.
 */
export function getStoreRoot(cwd: string = process.cwd()): string {
  const repoId = extractRepoId(resolveProjectRoot(cwd));
  return path.join(os.homedir(), '.lien', 'indices', repoId).replace(/\\/g, '/');
}
