import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { configExists, loadConfig } from '../config/loader.js';
import { isGitRepo, getCurrentBranch, getCurrentCommit } from '../git/utils.js';
import { readVersionFile } from '../vectordb/version.js';
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
  
  // Check if config exists
  const hasConfig = await configExists(rootDir);
  console.log(chalk.dim('Configuration:'), hasConfig ? chalk.green('✓ Found') : chalk.red('✗ Not initialized'));
  
  if (!hasConfig) {
    console.log(chalk.yellow('\nRun'), chalk.bold('lien init'), chalk.yellow('to initialize'));
    return;
  }
  
  // Check if index exists
  let indexExists = false;
  try {
    const stats = await fs.stat(indexPath);
    indexExists = true;
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
  
  // Load and show configuration settings
  try {
    const config = await loadConfig(rootDir);
    
    console.log(chalk.bold('\nFeatures:'));
    
    // Git detection status
    const isRepo = await isGitRepo(rootDir);
    if (config.gitDetection.enabled && isRepo) {
      console.log(chalk.dim('Git detection:'), chalk.green('✓ Enabled'));
      console.log(chalk.dim('  Poll interval:'), `${config.gitDetection.pollIntervalMs / 1000}s`);
      
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
    } else if (config.gitDetection.enabled && !isRepo) {
      console.log(chalk.dim('Git detection:'), chalk.yellow('Enabled (not a git repo)'));
    } else {
      console.log(chalk.dim('Git detection:'), chalk.gray('Disabled'));
    }
    
    // File watching status
    if (config.fileWatching.enabled) {
      console.log(chalk.dim('File watching:'), chalk.green('✓ Enabled'));
      console.log(chalk.dim('  Debounce:'), `${config.fileWatching.debounceMs}ms`);
    } else {
      console.log(chalk.dim('File watching:'), chalk.gray('Disabled'));
      console.log(chalk.dim('  Enable with:'), chalk.bold('lien serve --watch'));
    }
    
    // Indexing settings
    console.log(chalk.bold('\nIndexing Settings:'));
    console.log(chalk.dim('Concurrency:'), config.indexing.concurrency);
    console.log(chalk.dim('Batch size:'), config.indexing.embeddingBatchSize);
    console.log(chalk.dim('Chunk size:'), config.indexing.chunkSize);
    console.log(chalk.dim('Chunk overlap:'), config.indexing.chunkOverlap);
    
  } catch (error) {
    console.log(chalk.yellow('\nWarning: Could not load configuration'));
  }
}

