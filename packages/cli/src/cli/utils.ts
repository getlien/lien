import ora, { type Ora } from 'ora';
import chalk from 'chalk';
import { isLienError, getErrorMessage, getErrorStack } from '@liendev/core';

/**
 * Options for setting up a CLI command
 */
export interface SetupCommandOptions {
  /** Whether to show the banner (default: true) */
  showBanner?: boolean;
  /** Whether to enable verbose output (default: false) */
  verbose?: boolean;
}

/**
 * Sets up common CLI command initialization
 * Handles banner display and logging setup
 * 
 * @param options - Setup options
 */
export async function setupCommand(options: SetupCommandOptions = {}): Promise<void> {
  const { showBanner = true } = options;

  if (showBanner) {
    const { showCompactBanner } = await import('../utils/banner.js');
    showCompactBanner();
  }
}

/**
 * Standardized spinner wrapper for consistent UX across CLI commands
 * Provides success, fail, and update methods with proper formatting
 */
export class TaskSpinner {
  private spinner: Ora;

  constructor(initialText: string) {
    this.spinner = ora(initialText).start();
  }

  /**
   * Updates the spinner text while it's still spinning
   */
  update(text: string): void {
    this.spinner.text = text;
  }

  /**
   * Starts the spinner (useful after stopping)
   */
  start(text?: string): void {
    if (text) {
      this.spinner.text = text;
    }
    this.spinner.start();
  }

  /**
   * Stops the spinner without showing success/fail
   */
  stop(): void {
    this.spinner.stop();
  }

  /**
   * Shows success message and stops spinner
   */
  succeed(text: string): void {
    this.spinner.succeed(text);
  }

  /**
   * Shows failure message and stops spinner
   */
  fail(text: string, error?: Error | unknown): void {
    this.spinner.fail(text);
    
    if (error) {
      const errorMsg = getErrorMessage(error);
      console.error(chalk.red(`Error: ${errorMsg}`));
      
      // Show stack trace for non-Lien errors in verbose mode
      if (!isLienError(error)) {
        const stack = getErrorStack(error);
        if (stack) {
          console.error(chalk.dim(stack));
        }
      }
    }
  }

  /**
   * Shows warning message and stops spinner
   */
  warn(text: string): void {
    this.spinner.warn(text);
  }

  /**
   * Shows info message and stops spinner
   */
  info(text: string): void {
    this.spinner.info(text);
  }

  /**
   * Gets the underlying Ora instance for advanced usage
   */
  get raw(): Ora {
    return this.spinner;
  }
}

/**
 * Handles command errors with consistent formatting
 * Distinguishes between Lien errors and unexpected errors
 * 
 * @param error - The error that occurred
 * @param verbose - Whether to show verbose error output
 */
export function handleCommandError(error: unknown, verbose: boolean = false): void {
  const errorMessage = getErrorMessage(error);

  if (isLienError(error)) {
    // Lien-specific error - show clean message
    console.error(chalk.red(`\n❌ ${errorMessage}\n`));
    
    if (error.context && verbose) {
      console.error(chalk.dim('Context:'));
      console.error(chalk.dim(JSON.stringify(error.context, null, 2)));
    }
  } else {
    // Unexpected error - show full details
    console.error(chalk.red(`\n❌ Unexpected error: ${errorMessage}\n`));
    
    const stack = getErrorStack(error);
    if (stack && verbose) {
      console.error(chalk.dim('Stack trace:'));
      console.error(chalk.dim(stack));
    }
  }

  if (!verbose) {
    console.error(chalk.dim('Run with --verbose for more details\n'));
  }
}

/**
 * Formats a duration in milliseconds to a human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string (e.g., "1.5s", "123ms")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Formats a file count with proper pluralization
 * @param count - Number of files
 * @returns Formatted string (e.g., "1 file", "5 files")
 */
export function formatFileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

/**
 * Formats a chunk count with proper pluralization
 * @param count - Number of chunks
 * @returns Formatted string (e.g., "1 chunk", "100 chunks")
 */
export function formatChunkCount(count: number): string {
  return `${count} chunk${count === 1 ? '' : 's'}`;
}

