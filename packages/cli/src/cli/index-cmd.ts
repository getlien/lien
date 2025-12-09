import chalk from 'chalk';
import ora from 'ora';
import { indexCodebase } from '@liendev/core';
import type { IndexingProgress } from '@liendev/core';
import { showCompactBanner } from '../utils/banner.js';

export async function indexCommand(options: { watch?: boolean; verbose?: boolean; force?: boolean }) {
  showCompactBanner();
  
  try {
    // If force flag is set, clear the index and manifest first (clean slate)
    if (options.force) {
      const { VectorDB } = await import('@liendev/core');
      const { ManifestManager } = await import('@liendev/core');
      
      console.log(chalk.yellow('Clearing existing index and manifest...'));
      const vectorDB = new VectorDB(process.cwd());
      await vectorDB.initialize();
      await vectorDB.clear();
      
      // Also clear manifest
      const manifest = new ManifestManager(vectorDB.dbPath);
      await manifest.clear();
      
      console.log(chalk.green('✓ Index and manifest cleared\n'));
    }
    
    // Create spinner for progress
    const spinner = ora('Starting indexing...').start();
    let completedViaProgress = false;
    
    const result = await indexCodebase({
      rootDir: process.cwd(),
      verbose: options.verbose || false,
      force: options.force || false,
      onProgress: (progress: IndexingProgress) => {
        // Update spinner with progress
        let message = progress.message;
        
        if (progress.filesTotal && progress.filesProcessed !== undefined) {
          message += ` (${progress.filesProcessed}/${progress.filesTotal})`;
        } else if (progress.chunksProcessed) {
          message += ` (${progress.chunksProcessed} chunks)`;
        }
        
        if (progress.phase === 'complete') {
          completedViaProgress = true;
          spinner.succeed(chalk.green(message));
        } else {
          spinner.text = message;
        }
      },
    });
    
    // Ensure spinner is stopped if onProgress didn't mark it complete
    if (!completedViaProgress) {
      if (result.filesIndexed === 0) {
        spinner.succeed(chalk.green('Index is up to date - no changes detected'));
      } else {
        spinner.succeed(chalk.green(`Indexed ${result.filesIndexed} files, ${result.chunksCreated} chunks`));
      }
    }
    
    if (options.watch) {
      console.log(chalk.yellow('\n⚠️  Watch mode not yet implemented'));
      // TODO: Implement file watching with chokidar
    }
  } catch (error) {
    console.error(chalk.red('Error during indexing:'), error);
    process.exit(1);
  }
}

