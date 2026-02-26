/**
 * Hardened shallow clone for review runner.
 *
 * Key differences from packages/app/src/clone.ts:
 * - GIT_TERMINAL_PROMPT=0 to prevent token leakage
 * - transfer.fsckObjects=true for git bomb protection
 * - Post-clone symlink check via fs.realpath()
 * - Clone by SHA (git init + fetch + checkout FETCH_HEAD)
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Logger } from '@liendev/review';
import { assertValidRepoName } from './validate.js';

const execFileAsync = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
};

const GIT_TIMEOUT = 120_000;

export interface CloneResult {
  dir: string;
  cleanup: () => Promise<void>;
}

function makeCleanup(dir: string, logger: Logger): () => Promise<void> {
  return async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      logger.warning(
        `Failed to clean up ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}

/**
 * Clone a repo at an exact SHA (not a branch ref).
 * Uses git init + fetch --depth=1 + checkout FETCH_HEAD.
 */
export async function cloneBySha(
  repoFullName: string,
  sha: string,
  token: string,
  logger: Logger,
): Promise<CloneResult> {
  assertValidRepoName(repoFullName);
  const dir = await mkdtemp(join(tmpdir(), 'lien-runner-'));
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  logger.info(`Cloning ${repoFullName}@${sha.slice(0, 7)} (by SHA) into ${dir}`);

  await execFileAsync('git', ['init', dir], { timeout: GIT_TIMEOUT, env: GIT_ENV });

  await execFileAsync('git', ['-C', dir, 'remote', 'add', 'origin', cloneUrl], {
    timeout: GIT_TIMEOUT,
    env: GIT_ENV,
  });

  await execFileAsync(
    'git',
    ['-C', dir, '-c', 'transfer.fsckObjects=true', 'fetch', '--depth=1', 'origin', sha],
    { timeout: GIT_TIMEOUT, env: GIT_ENV },
  );

  await execFileAsync('git', ['-C', dir, 'checkout', 'FETCH_HEAD'], {
    timeout: GIT_TIMEOUT,
    env: GIT_ENV,
  });

  // Symlink check: ensure the dir resolves to where we expect
  const resolvedDir = await realpath(dir);
  if (resolvedDir !== dir && !resolvedDir.startsWith(tmpdir())) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Symlink attack detected: ${dir} resolved to ${resolvedDir}`);
  }

  logger.info(`Clone complete: ${dir}`);

  return { dir, cleanup: makeCleanup(dir, logger) };
}

/**
 * Clone a repo by branch name (for baseline clones).
 * Uses standard --branch shallow clone with hardening.
 */
export async function cloneByBranch(
  repoFullName: string,
  branch: string,
  token: string,
  logger: Logger,
): Promise<CloneResult> {
  assertValidRepoName(repoFullName);
  const dir = await mkdtemp(join(tmpdir(), 'lien-runner-'));
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  logger.info(`Cloning ${repoFullName}@${branch} (by branch) into ${dir}`);

  await execFileAsync(
    'git',
    [
      '-c',
      'transfer.fsckObjects=true',
      'clone',
      '--depth=1',
      '--branch',
      branch,
      '--single-branch',
      cloneUrl,
      dir,
    ],
    { timeout: GIT_TIMEOUT, env: GIT_ENV },
  );

  const resolvedDir = await realpath(dir);
  if (resolvedDir !== dir && !resolvedDir.startsWith(tmpdir())) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Symlink attack detected: ${dir} resolved to ${resolvedDir}`);
  }

  logger.info(`Clone complete: ${dir}`);

  return { dir, cleanup: makeCleanup(dir, logger) };
}
