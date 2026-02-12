import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
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
    await outputJson(rootDir, repoId, indexPath);
    return;
  }

  showCompactBanner();
  console.log(chalk.bold('Status\n'));

  // Config is no longer required - everything uses defaults or global config
  console.log(
    chalk.dim('Configuration:'),
    chalk.green('✓ Using defaults (no per-project config needed)'),
  );

  // Check if index exists
  try {
    const stats = await fs.stat(indexPath);
    console.log(chalk.dim('Index location:'), indexPath);
    console.log(chalk.dim('Index status:'), chalk.green('✓ Exists'));

    // Try to get directory size
    try {
      const files = await fs.readdir(indexPath, { recursive: true });
      console.log(chalk.dim('Index files:'), files.length);
    } catch {
      // Ignore
    }

    console.log(chalk.dim('Last modified:'), stats.mtime.toLocaleString());

    // Show version file info
    try {
      const version = await readVersionFile(indexPath);
      if (version > 0) {
        const versionDate = new Date(version);
        console.log(chalk.dim('Last reindex:'), versionDate.toLocaleString());
      }
    } catch {
      // Ignore
    }
  } catch {
    console.log(chalk.dim('Index status:'), chalk.yellow('✗ Not indexed'));
    console.log(
      chalk.yellow('\nRun'),
      chalk.bold('lien index'),
      chalk.yellow('to index your codebase'),
    );
  }

  // Show features (all enabled by default)
  console.log(chalk.bold('\nFeatures:'));

  // Git detection status
  const isRepo = await isGitRepo(rootDir);
  if (isRepo) {
    console.log(chalk.dim('Git detection:'), chalk.green('✓ Enabled'));
    console.log(chalk.dim('  Poll interval:'), `${DEFAULT_GIT_POLL_INTERVAL_MS / 1000}s`);

    // Show current git state
    try {
      const branch = await getCurrentBranch(rootDir);
      const commit = await getCurrentCommit(rootDir);
      console.log(chalk.dim('  Current branch:'), branch);
      console.log(chalk.dim('  Current commit:'), commit.substring(0, 8));

      // Check if git state file exists
      const gitStateFile = path.join(indexPath, '.git-state.json');
      try {
        const gitStateContent = await fs.readFile(gitStateFile, 'utf-8');
        const gitState = JSON.parse(gitStateContent);
        if (gitState.branch !== branch || gitState.commit !== commit) {
          console.log(chalk.yellow('  ⚠️  Git state changed - will reindex on next serve'));
        }
      } catch {
        // Git state file doesn't exist yet
      }
    } catch {
      // Ignore git command errors
    }
  } else {
    console.log(chalk.dim('Git detection:'), chalk.yellow('Not a git repo'));
  }

  // File watching status (enabled by default)
  console.log(chalk.dim('File watching:'), chalk.green('✓ Enabled (default)'));
  console.log(chalk.dim('  Batch window:'), '500ms (collects rapid changes, force-flush after 5s)');
  console.log(chalk.dim('  Disable with:'), chalk.bold('lien serve --no-watch'));

  // Indexing settings (defaults) — only shown with --verbose
  if (options.verbose) {
    console.log(chalk.bold('\nIndexing Settings (defaults):'));
    console.log(chalk.dim('Concurrency:'), DEFAULT_CONCURRENCY);
    console.log(chalk.dim('Batch size:'), DEFAULT_EMBEDDING_BATCH_SIZE);
    console.log(chalk.dim('Chunk size:'), DEFAULT_CHUNK_SIZE);
    console.log(chalk.dim('Chunk overlap:'), DEFAULT_CHUNK_OVERLAP);
  }
}

async function outputJson(rootDir: string, _repoId: string, indexPath: string) {
  const data: Record<string, unknown> = {
    version: undefined as string | undefined,
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

  // Try to get package version
  try {
    const { createRequire } = await import('module');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const require = createRequire(import.meta.url);
    let packageJson;
    try {
      packageJson = require(join(__dirname, '../package.json'));
    } catch {
      packageJson = require(join(__dirname, '../../package.json'));
    }
    data.version = packageJson.version;
  } catch {
    // Ignore
  }

  // Check index
  try {
    const stats = await fs.stat(indexPath);
    data.indexStatus = 'exists';
    data.lastModified = stats.mtime.toISOString();

    try {
      const files = await fs.readdir(indexPath, { recursive: true });
      data.indexFiles = files.length;
    } catch {
      // Ignore
    }

    try {
      const version = await readVersionFile(indexPath);
      if (version > 0) {
        data.lastReindex = new Date(version).toISOString();
      }
    } catch {
      // Ignore
    }
  } catch {
    // Not indexed
  }

  // Git info
  const isRepo = await isGitRepo(rootDir);
  if (isRepo) {
    const git: Record<string, unknown> = { enabled: true, branch: null, commit: null };
    try {
      git.branch = await getCurrentBranch(rootDir);
      const commit = await getCurrentCommit(rootDir);
      git.commit = commit.substring(0, 8);
    } catch {
      // Ignore
    }
    data.git = git;
  }

  console.log(JSON.stringify(data, null, 2));
}
