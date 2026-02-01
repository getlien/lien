import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Logger } from '@liendev/review';

const execFileAsync = promisify(execFile);

export interface CloneResult {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Shallow-clone a repo at a specific ref using an installation token.
 * Returns the clone directory and a cleanup function.
 */
export async function cloneRepo(
  repoFullName: string,
  ref: string,
  token: string,
  logger: Logger,
): Promise<CloneResult> {
  const dir = await mkdtemp(join(tmpdir(), 'veille-'));

  // Token is in the URL but never logged — only passed to git directly
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  logger.info(`Cloning ${repoFullName}@${ref} into ${dir}`);

  await execFileAsync('git', ['clone', '--depth=1', '--branch', ref, '--single-branch', cloneUrl, dir], {
    timeout: 120_000,
  });

  logger.info(`Clone complete: ${dir}`);

  return {
    dir,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        logger.warning(`Failed to clean up ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/**
 * Shallow-clone the base branch for delta comparison.
 */
export async function cloneBase(
  repoFullName: string,
  baseBranch: string,
  token: string,
  logger: Logger,
): Promise<CloneResult> {
  return cloneRepo(repoFullName, baseBranch, token, logger);
}
