/**
 * Hardened shallow clone for review runner.
 *
 * Key differences from packages/app/src/clone.ts:
 * - GIT_TERMINAL_PROMPT=0 to prevent token leakage
 * - transfer.fsckObjects=true for git bomb protection
 * - Post-clone symlink check via fs.realpath()
 * - Clone by SHA (git init + fetch + checkout FETCH_HEAD)
 * - Cleanup on failure to prevent tmpdir leaks
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

async function assertNoSymlinkEscape(dir: string): Promise<void> {
  const [resolved, canonicalTmp] = await Promise.all([realpath(dir), realpath(tmpdir())]);
  if (!resolved.startsWith(canonicalTmp)) {
    throw new Error(`Symlink escape detected: ${dir} resolved to ${resolved}`);
  }
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

  try {
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

    await assertNoSymlinkEscape(dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
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

  try {
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

    await assertNoSymlinkEscape(dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  logger.info(`Clone complete: ${dir}`);

  return { dir, cleanup: makeCleanup(dir, logger) };
}

/**
 * Resolve the HEAD commit SHA of a cloned directory.
 */
export async function resolveHeadSha(dir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    timeout: 10_000,
    env: GIT_ENV,
  });
  return stdout.trim();
}

/**
 * Resolve the HEAD commit timestamp (ISO 8601) of a cloned directory.
 */
export async function resolveCommitTimestamp(dir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, 'log', '-1', '--format=%aI'], {
    timeout: 10_000,
    env: GIT_ENV,
  });
  return stdout.trim();
}
