import crypto from 'crypto';
import path from 'path';

/**
 * Extract repository identifier from project root.
 * Uses project name + path hash for stable, unique identification.
 */
export function extractRepoId(projectRoot: string): string {
  const projectName = path.basename(projectRoot);
  const pathHash = crypto.createHash('md5').update(projectRoot).digest('hex').substring(0, 8);
  return `${projectName}-${pathHash}`;
}
