import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';
import { indexCodebase } from '@liendev/core';
import type { IndexingProgress } from '@liendev/core';
import { showCompactBanner } from '../utils/banner.js';
import { getIndexingMessage, getEmbeddingMessage, getModelLoadingMessage } from '../utils/loading-messages.js';

/**
 * Clears the existing index and manifest (for --force flag).
 */
async function clearExistingIndex(): Promise<void> {
  const { VectorDB } = await import('@liendev/core');
  const { ManifestManager } = await import('@liendev/core');
  
  console.log(chalk.yellow('Clearing existing index and manifest...'));
  const vectorDB = new VectorDB(process.cwd());
  await vectorDB.initialize();
  await vectorDB.clear();
  
  const manifest = new ManifestManager(vectorDB.dbPath);
  await manifest.clear();
  
  console.log(chalk.green('✓ Index and manifest cleared\n'));
}

/**
 * Progress tracker state for managing spinner updates.
 */
interface ProgressTracker {
  current: IndexingProgress;
  wittyMessage: string;
  lastUpdateTime: number;
  updateCount: number;
  completedViaProgress: boolean;
  messageRotationInterval?: NodeJS.Timeout;
}

/**
 * Creates a progress tracker with initial state.
 */
function createProgressTracker(): ProgressTracker {
  return {
    current: {
      phase: 'initializing',
      message: 'Starting...',
      filesTotal: 0,
      filesProcessed: 0,
    },
    wittyMessage: getIndexingMessage(),
    lastUpdateTime: 0,
    updateCount: 0,
    completedViaProgress: false,
  };
}

/**
 * Updates spinner text based on current progress with adaptive throttling.
 */
function updateSpinner(spinner: Ora, tracker: ProgressTracker, forceUpdate = false): void {
  const now = Date.now();
  tracker.updateCount++;
  
  // First 20 updates: always show (no throttle) for initial feedback
  // After that: throttle to 20 updates/sec (50ms) to prevent flickering
  const shouldThrottle = tracker.updateCount > 20;
  const throttleMs = 50;
  
  if (!forceUpdate && shouldThrottle && now - tracker.lastUpdateTime < throttleMs) {
    return;
  }
  tracker.lastUpdateTime = now;
  
  const { current, wittyMessage } = tracker;
  const text = current.filesTotal && current.filesProcessed !== undefined
    ? `${current.filesProcessed}/${current.filesTotal} files | ${wittyMessage}`
    : wittyMessage;
  
  spinner.text = text;
  
  // Force immediate update on next tick to avoid event loop blocking
  setImmediate(() => spinner.render());
}

/**
 * Updates witty message based on current phase.
 */
function updateWittyMessage(tracker: ProgressTracker): void {
  const { current } = tracker;
  if (current.phase === 'embedding' || current.phase === 'indexing') {
    tracker.wittyMessage = getIndexingMessage();
  } else if (current.phase === 'initializing') {
    tracker.wittyMessage = getModelLoadingMessage();
  }
}

/**
 * Starts rotating witty messages every 8 seconds.
 */
function startMessageRotation(spinner: Ora, tracker: ProgressTracker): void {
  tracker.messageRotationInterval = setInterval(() => {
    updateWittyMessage(tracker);
    updateSpinner(spinner, tracker, true);
  }, 8000);
}

/**
 * Stops message rotation interval if running.
 */
function stopMessageRotation(tracker: ProgressTracker): void {
  if (tracker.messageRotationInterval) {
    clearInterval(tracker.messageRotationInterval);
    tracker.messageRotationInterval = undefined;
  }
}

/**
 * Creates progress callback for indexing operation.
 */
function createProgressCallback(
  spinner: Ora,
  tracker: ProgressTracker
): (progress: IndexingProgress) => void {
  return (progress: IndexingProgress) => {
    tracker.current = progress;
    
    // Update witty message based on phase changes
    if (progress.phase === 'initializing' && !tracker.messageRotationInterval) {
      tracker.wittyMessage = getModelLoadingMessage();
    } else if (progress.phase === 'embedding') {
      tracker.wittyMessage = getEmbeddingMessage();
    } else if (progress.phase === 'indexing') {
      tracker.wittyMessage = getIndexingMessage();
    }
    
    if (progress.phase === 'complete') {
      tracker.completedViaProgress = true;
      stopMessageRotation(tracker);
      
      let message = progress.message;
      if (progress.filesTotal && progress.filesProcessed !== undefined) {
        message = `${message} (${progress.filesProcessed}/${progress.filesTotal})`;
      }
      spinner.succeed(chalk.green(message));
    } else {
      updateSpinner(spinner, tracker);
    }
  };
}

/**
 * Displays final result if not already shown via progress callback.
 */
function displayFinalResult(
  spinner: Ora,
  tracker: ProgressTracker,
  result: { filesIndexed: number; chunksCreated: number }
): void {
  if (!tracker.completedViaProgress) {
    if (result.filesIndexed === 0) {
      spinner.succeed(chalk.green('Index is up to date - no changes detected'));
    } else {
      spinner.succeed(chalk.green(`Indexed ${result.filesIndexed} files, ${result.chunksCreated} chunks`));
    }
  }
}

export async function indexCommand(options: { watch?: boolean; verbose?: boolean; force?: boolean }) {
  showCompactBanner();
  
  try {
    // Clear index if --force flag is set
    if (options.force) {
      await clearExistingIndex();
    }
    
    // Create spinner and progress tracker
    const spinner = ora({
      text: 'Starting indexing...',
      interval: 30, // Faster refresh rate for smoother progress
    }).start();
    
    const tracker = createProgressTracker();
    startMessageRotation(spinner, tracker);
    
    // Run indexing with progress callback
    const result = await indexCodebase({
      rootDir: process.cwd(),
      verbose: options.verbose || false,
      force: options.force || false,
      onProgress: createProgressCallback(spinner, tracker),
    });
    
    stopMessageRotation(tracker);
    
    // Handle errors
    if (!result.success && result.error) {
      spinner.fail(chalk.red('Indexing failed'));
      console.error(chalk.red('\n' + result.error));
      process.exit(1);
    }
    
    // Display final result
    displayFinalResult(spinner, tracker, result);
    
    if (options.watch) {
      console.log(chalk.yellow('\n⚠️  Watch mode not yet implemented'));
    }
  } catch (error) {
    console.error(chalk.red('Error during indexing:'), error);
    process.exit(1);
  }
}

