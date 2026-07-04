import chalk from 'chalk';
import type { Stats } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  readVersionFile,
  loadGlobalConfig,
  detectLinkedWorktree,
  resolveIndexStrategy,
  DEFAULT_CONCURRENCY,
  DEFAULT_GIT_POLL_INTERVAL_MS,
} from '@liendev/core';
import {
  extractRepoId,
  getLienHome,
  getIndexDir,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
} from '@liendev/parser';
import { showCompactBanner } from '../utils/banner.js';

const VALID_FORMATS = ['text', 'json'];

// --- Data helpers ---

async function getFileStats(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function getFileCount(dirPath: string): Promise<number | null> {
  try {
    const files = await fs.readdir(dirPath, { recursive: true });
    return files.length;
  } catch {
    return null;
  }
}

async function getLastReindex(indexPath: string): Promise<number | null> {
  try {
    const version = await readVersionFile(indexPath);
    return version > 0 ? version : null;
  } catch {
    return null;
  }
}

function getPackageVersion(): string | undefined {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const require = createRequire(import.meta.url);
  try {
    return require(path.join(__dirname, '../package.json')).version;
  } catch {
    return require(path.join(__dirname, '../../package.json')).version;
  }
}

async function getGitState(rootDir: string): Promise<{ branch: string; commit: string } | null> {
  try {
    const branch = await getCurrentBranch(rootDir);
    const commit = await getCurrentCommit(rootDir);
    return { branch, commit };
  } catch {
    return null;
  }
}

/**
 * Resolve the configured backend.
 *
 * `loadGlobalConfig` already treats a missing config file as the default
 * (ENOENT is swallowed inside it). Any error it throws is a real problem — e.g.
 * a malformed `~/.lien/config.json` surfacing as a ConfigValidationError — and
 * must propagate rather than being silently reported as the default backend.
 */
async function resolveBackend(): Promise<string> {
  return (await loadGlobalConfig()).backend ?? 'sqlite';
}

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

// --- Display helpers (text format) ---

async function printIndexStatus(indexPath: string) {
  const stats = await getFileStats(indexPath);
  if (!stats) {
    console.log(chalk.dim('Index status:'), chalk.yellow('✗ Not indexed'));
    console.log(
      chalk.yellow('\nRun'),
      chalk.bold('lien index'),
      chalk.yellow('to index your codebase'),
    );
    return;
  }

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
}

async function printGitStatus(rootDir: string, indexPath: string) {
  const isRepo = await isGitRepo(rootDir);
  if (!isRepo) {
    console.log(chalk.dim('Git detection:'), chalk.yellow('Not a git repo'));
    return;
  }

  console.log(chalk.dim('Git detection:'), chalk.green('✓ Enabled'));
  console.log(chalk.dim('  Poll interval:'), `${DEFAULT_GIT_POLL_INTERVAL_MS / 1000}s`);

  const gitState = await getGitState(rootDir);
  if (!gitState) return;

  console.log(chalk.dim('  Current branch:'), gitState.branch);
  console.log(chalk.dim('  Current commit:'), gitState.commit.substring(0, 8));

  const storedGit = await getStoredGitState(indexPath);
  if (storedGit && (storedGit.branch !== gitState.branch || storedGit.commit !== gitState.commit)) {
    console.log(chalk.yellow('  ⚠️  Git state changed - will reindex on next serve'));
  }
}

/**
 * Report worktree-aware indexing status. A no-op (prints nothing) outside a
 * linked git worktree, so a normal checkout's output is unchanged.
 *
 * Reuses `resolveIndexStrategy` as the sole source of truth for the mode
 * (overlay vs standalone) — this only adds display-only facts (does the base
 * index dir exist, how big is the overlay) on top of that decision.
 */
async function printWorktreeStatus(rootDir: string) {
  const { isLinkedWorktree, mainRoot } = await detectLinkedWorktree(rootDir);
  if (!isLinkedWorktree) return;

  const strategy = await resolveIndexStrategy(rootDir);
  const escapeHatchOn = process.env.LIEN_WORKTREE_STANDALONE === '1';

  const effectiveMainRoot = strategy.mode === 'overlay' ? strategy.mainRoot : mainRoot;
  const baseIndexDir =
    strategy.mode === 'overlay'
      ? strategy.baseIndexDir
      : effectiveMainRoot
        ? getIndexDir(effectiveMainRoot)
        : null;
  const baseFound = baseIndexDir ? (await getFileStats(baseIndexDir)) !== null : false;

  console.log(chalk.bold('\nWorktree:'));

  if (strategy.mode === 'overlay') {
    console.log(
      chalk.dim('Mode:'),
      chalk.green('✓ Overlay'),
      chalk.dim('(sharing base index from main checkout)'),
    );
  } else {
    const reason = escapeHatchOn
      ? 'escape hatch forced standalone'
      : !effectiveMainRoot
        ? 'main checkout could not be located'
        : !baseFound
          ? 'main checkout has no index yet — run `lien index` there'
          : 'main checkout index is incompatible with this version';
    console.log(chalk.dim('Mode:'), chalk.yellow('✗ Standalone'), chalk.dim(`(${reason})`));
  }

  if (effectiveMainRoot) {
    console.log(chalk.dim('Main checkout:'), effectiveMainRoot);
  }

  if (baseIndexDir) {
    console.log(chalk.dim('Base index:'), baseIndexDir);
    console.log(
      chalk.dim('  Status:'),
      baseFound ? chalk.green('✓ Found') : chalk.yellow('✗ Not found'),
    );
  }

  if (strategy.mode === 'overlay') {
    console.log(chalk.dim('Overlay index:'), strategy.overlayIndexDir);
    const overlayFileCount = await getFileCount(strategy.overlayIndexDir);
    if (overlayFileCount !== null) {
      console.log(chalk.dim('  Files:'), overlayFileCount);
    }
  }

  if (escapeHatchOn) {
    console.log(
      chalk.dim('Escape hatch:'),
      chalk.yellow('ON'),
      chalk.dim('(LIEN_WORKTREE_STANDALONE=1)'),
    );
  }
}

function printWatchStatus() {
  console.log(chalk.dim('File watching:'), chalk.green('✓ Enabled (default)'));
  console.log(chalk.dim('  Batch window:'), '500ms (collects rapid changes, force-flush after 5s)');
  console.log(chalk.dim('  Disable with:'), chalk.bold('lien serve --no-watch'));
}

function printSearchStatus() {
  console.log(chalk.dim('Search:'), chalk.green('✓ Lexical (FTS5 full-text, BM25)'));
  console.log(chalk.dim('  No embeddings are computed — nothing is downloaded.'));
}

function printIndexingSettings() {
  console.log(chalk.bold('\nIndexing Settings (defaults):'));
  console.log(chalk.dim('Concurrency:'), DEFAULT_CONCURRENCY);
  console.log(chalk.dim('Chunk size:'), DEFAULT_CHUNK_SIZE);
  console.log(chalk.dim('Chunk overlap:'), DEFAULT_CHUNK_OVERLAP);
}

// --- Entry point ---

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
  const indexPath = path.join(getLienHome(), '.lien', 'indices', repoId);

  if (format === 'json') {
    await outputJson(rootDir, indexPath);
    return;
  }

  const backend = await resolveBackend();

  showCompactBanner();
  console.log(chalk.bold('Status\n'));
  console.log(chalk.dim('Backend:'), backend);

  await printIndexStatus(indexPath);
  await printWorktreeStatus(rootDir);

  console.log(chalk.bold('\nFeatures:'));
  await printGitStatus(rootDir, indexPath);
  printWatchStatus();
  printSearchStatus();

  if (options.verbose) {
    printIndexingSettings();
  }
}

// --- JSON output ---

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
    backend: await resolveBackend(),
    search: 'lexical',
    settings: {
      concurrency: DEFAULT_CONCURRENCY,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    },
  };

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
