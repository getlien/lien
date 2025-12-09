import chalk from 'chalk';
import ora from 'ora';
import { indexCodebase } from '@liendev/core';
import type { IndexingProgress } from '@liendev/core';
import { showCompactBanner } from '../utils/banner.js';
import { getIndexingMessage, getEmbeddingMessage, getModelLoadingMessage } from '../utils/loading-messages.js';

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
    
    // Create spinner for progress with witty messages
    const spinner = ora('Starting indexing...').start();
    let completedViaProgress = false;
    let wittyMessage = getIndexingMessage();
    let messageRotationInterval: NodeJS.Timeout | undefined;
    let spinnerUpdateInterval: NodeJS.Timeout | undefined;
    
    // Track progress state
    let currentProgress: IndexingProgress = {
      phase: 'initializing',
      message: 'Starting...',
      filesTotal: 0,
      filesProcessed: 0,
    };
    
    // Update spinner every 200ms with witty messages
    const updateSpinner = () => {
      let text = '';
      
      if (currentProgress.filesTotal && currentProgress.filesProcessed !== undefined) {
        text = `${currentProgress.filesProcessed}/${currentProgress.filesTotal} files | ${wittyMessage}`;
      } else {
        text = wittyMessage;
      }
      
      spinner.text = text;
    };
    
    // Rotate witty messages every 8 seconds
    messageRotationInterval = setInterval(() => {
      if (currentProgress.phase === 'embedding' || currentProgress.phase === 'indexing') {
        wittyMessage = getIndexingMessage();
      } else if (currentProgress.phase === 'initializing') {
        wittyMessage = getModelLoadingMessage();
      }
      updateSpinner();
    }, 8000);
    
    // Update spinner display every 200ms
    spinnerUpdateInterval = setInterval(updateSpinner, 200);
    
    const result = await indexCodebase({
      rootDir: process.cwd(),
      verbose: options.verbose || false,
      force: options.force || false,
      onProgress: (progress: IndexingProgress) => {
        currentProgress = progress;
        
        // Update witty message based on phase
        if (progress.phase === 'initializing' && !messageRotationInterval) {
          wittyMessage = getModelLoadingMessage();
        } else if (progress.phase === 'embedding') {
          wittyMessage = getEmbeddingMessage();
        } else if (progress.phase === 'indexing') {
          wittyMessage = getIndexingMessage();
        }
        
        if (progress.phase === 'complete') {
          completedViaProgress = true;
          // Stop intervals
          if (messageRotationInterval) clearInterval(messageRotationInterval);
          if (spinnerUpdateInterval) clearInterval(spinnerUpdateInterval);
          
          let message = progress.message;
          if (progress.filesTotal && progress.filesProcessed !== undefined) {
            message = `${message} (${progress.filesProcessed}/${progress.filesTotal})`;
          }
          spinner.succeed(chalk.green(message));
        } else {
          updateSpinner();
        }
      },
    });
    
    // Clean up intervals
    if (messageRotationInterval) clearInterval(messageRotationInterval);
    if (spinnerUpdateInterval) clearInterval(spinnerUpdateInterval);
    
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

