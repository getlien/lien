import chalk from 'chalk';
import type { Stats } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  readVersionFile,
  extractRepoId,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_GIT_POLL_INTERVAL_MS,
} from '@liendev/core';
import { showCompactBanner } from '../utils/banner.js';

const VALID_FORMATS = ['text', 'json'];

/** Safely stat a file, returning null if it doesn't exist. */
async function getFileStats(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/** Safely count files in a directory. */
async function getFileCount(dirPath: string): Promise<number | null> {
  try {
    const files = await fs.readdir(dirPath, { recursive: true });
    return files.length;
  } catch {
    return null;
  }
}

/** Safely read the last reindex timestamp. */
async function getLastReindex(indexPath: string): Promise<number | null> {
  try {
    const version = await readVersionFile(indexPath);
    return version > 0 ? version : null;
  } catch {
    return null;
  }
}

/** Get the package version from package.json. */
function getPackageVersion(): string | undefined {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const require = createRequire(import.meta.url);
  try {
    return require(join(__dirname, '../package.json')).version;
  } catch {
    return require(join(__dirname, '../../package.json')).version;
  }
}

/** Get current git state for a directory. */
async function getGitState(rootDir: string): Promise<{ branch: string; commit: string } | null> {
  try {
    const branch = await getCurrentBranch(rootDir);
    const commit = await getCurrentCommit(rootDir);
    return { branch, commit };
  } catch {
    return null;
  }
}

/** Read stored git state from index. */
async function getStoredGitState(
  indexPath: string,
): Promise<{ branch: string; commit: string } | null> {
  try {
    const content = await fs.readFile(path.join(indexPath, '.git-state.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function statusCommand(options: { verbose?: boolean; format?: string } = {}) {
  const format = options.format || 'text';
  if (!VALID_FORMATS.includes(format)) {
    console.error(
      chalk.red(`Error: Invalid --format value "${format}". Must be one of: text, json`),
    );
    process.exit(1);
  }

  const rootDir = process.cwd();
  const repoId = extractRepoId(rootDir);
  const indexPath = path.join(os.homedir(), '.lien', 'indices', repoId);

  if (format === 'json') {
    await outputJson(rootDir, indexPath);
    return;
  }

  showCompactBanner();
  console.log(chalk.bold('Status\n'));

  console.log(
    chalk.dim('Configuration:'),
    chalk.green('✓ Using defaults (no per-project config needed)'),
  );

  // Index info
  const stats = await getFileStats(indexPath);
  if (stats) {
    console.log(chalk.dim('Index location:'), indexPath);
    console.log(chalk.dim('Index status:'), chalk.green('✓ Exists'));

    const fileCount = await getFileCount(indexPath);
    if (fileCount !== null) {
      console.log(chalk.dim('Index files:'), fileCount);
    }

    console.log(chalk.dim('Last modified:'), stats.mtime.toLocaleString());

    const reindexTs = await getLastReindex(indexPath);
    if (reindexTs !== null) {
      console.log(chalk.dim('Last reindex:'), new Date(reindexTs).toLocaleString());
    }
  } else {
    console.log(chalk.dim('Index status:'), chalk.yellow('✗ Not indexed'));
    console.log(
      chalk.yellow('\nRun'),
      chalk.bold('lien index'),
      chalk.yellow('to index your codebase'),
    );
  }

  // Features
  console.log(chalk.bold('\nFeatures:'));

  const isRepo = await isGitRepo(rootDir);
  if (isRepo) {
    console.log(chalk.dim('Git detection:'), chalk.green('✓ Enabled'));
    console.log(chalk.dim('  Poll interval:'), `${DEFAULT_GIT_POLL_INTERVAL_MS / 1000}s`);

    const gitState = await getGitState(rootDir);
    if (gitState) {
      console.log(chalk.dim('  Current branch:'), gitState.branch);
      console.log(chalk.dim('  Current commit:'), gitState.commit.substring(0, 8));

      const storedGit = await getStoredGitState(indexPath);
      if (
        storedGit &&
        (storedGit.branch !== gitState.branch || storedGit.commit !== gitState.commit)
      ) {
        console.log(chalk.yellow('  ⚠️  Git state changed - will reindex on next serve'));
      }
    }
  } else {
    console.log(chalk.dim('Git detection:'), chalk.yellow('Not a git repo'));
  }

  console.log(chalk.dim('File watching:'), chalk.green('✓ Enabled (default)'));
  console.log(chalk.dim('  Batch window:'), '500ms (collects rapid changes, force-flush after 5s)');
  console.log(chalk.dim('  Disable with:'), chalk.bold('lien serve --no-watch'));

  if (options.verbose) {
    console.log(chalk.bold('\nIndexing Settings (defaults):'));
    console.log(chalk.dim('Concurrency:'), DEFAULT_CONCURRENCY);
    console.log(chalk.dim('Batch size:'), DEFAULT_EMBEDDING_BATCH_SIZE);
    console.log(chalk.dim('Chunk size:'), DEFAULT_CHUNK_SIZE);
    console.log(chalk.dim('Chunk overlap:'), DEFAULT_CHUNK_OVERLAP);
  }
}

async function outputJson(rootDir: string, indexPath: string) {
  const data: Record<string, unknown> = {
    version: getPackageVersion(),
    indexPath,
    indexStatus: 'not_indexed',
    indexFiles: 0,
    lastModified: null as string | null,
    lastReindex: null as string | null,
    git: { enabled: false, branch: null, commit: null },
    features: { fileWatching: true, gitDetection: true },
    settings: {
      concurrency: DEFAULT_CONCURRENCY,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    },
  };

  // Index info
  const stats = await getFileStats(indexPath);
  if (stats) {
    data.indexStatus = 'exists';
    data.lastModified = stats.mtime.toISOString();

    const fileCount = await getFileCount(indexPath);
    if (fileCount !== null) {
      data.indexFiles = fileCount;
    }

    const reindexTs = await getLastReindex(indexPath);
    if (reindexTs !== null) {
      data.lastReindex = new Date(reindexTs).toISOString();
    }
  }

  // Git info
  const isRepo = await isGitRepo(rootDir);
  if (isRepo) {
    const gitState = await getGitState(rootDir);
    data.git = {
      enabled: true,
      branch: gitState?.branch ?? null,
      commit: gitState ? gitState.commit.substring(0, 8) : null,
    };
  }

  console.log(JSON.stringify(data, null, 2));
}
