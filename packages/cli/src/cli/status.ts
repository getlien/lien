import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  readVersionFile,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  DEFAULT_DEBOUNCE_MS,
} from '@liendev/core';
import { showCompactBanner } from '../utils/banner.js';

export async function statusCommand() {
  const rootDir = process.cwd();
  const projectName = path.basename(rootDir);
  
  // Use same hashing logic as VectorDB to show correct path
  const pathHash = crypto
    .createHash('md5')
    .update(rootDir)
    .digest('hex')
    .substring(0, 8);
  
  const indexPath = path.join(os.homedir(), '.lien', 'indices', `${projectName}-${pathHash}`);
  
  showCompactBanner();
  console.log(chalk.bold('Status\n'));
  
  // Config is no longer required - everything uses defaults or global config
  console.log(chalk.dim('Configuration:'), chalk.green('✓ Using defaults (no per-project config needed)'));
  
  // Check if index exists
  try {
    const stats = await fs.stat(indexPath);
    console.log(chalk.dim('Index location:'), indexPath);
    console.log(chalk.dim('Index status:'), chalk.green('✓ Exists'));
    
    // Try to get directory size
    try {
      const files = await fs.readdir(indexPath, { recursive: true });
      console.log(chalk.dim('Index files:'), files.length);
    } catch (e) {
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
  } catch (error) {
    console.log(chalk.dim('Index status:'), chalk.yellow('✗ Not indexed'));
    console.log(chalk.yellow('\nRun'), chalk.bold('lien index'), chalk.yellow('to index your codebase'));
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
  console.log(chalk.dim('  Debounce:'), `${DEFAULT_DEBOUNCE_MS}ms`);
  console.log(chalk.dim('  Disable with:'), chalk.bold('lien serve --no-watch'));
  
  // Indexing settings (defaults)
  console.log(chalk.bold('\nIndexing Settings (defaults):'));
  console.log(chalk.dim('Concurrency:'), DEFAULT_CONCURRENCY);
  console.log(chalk.dim('Batch size:'), DEFAULT_EMBEDDING_BATCH_SIZE);
  console.log(chalk.dim('Chunk size:'), DEFAULT_CHUNK_SIZE);
  console.log(chalk.dim('Chunk overlap:'), DEFAULT_CHUNK_OVERLAP);
}

