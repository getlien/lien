/**
 * Logger interface for review operations.
 * Decouples review logic from @actions/core so it can be used
 * in both the GitHub Action and the GitHub App.
 */
export interface Logger {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * Simple console-based logger for use outside GitHub Actions
 */
export const consoleLogger: Logger = {
  info: (message: string) => console.log(`[info] ${message}`),
  warning: (message: string) => console.warn(`[warning] ${message}`),
  error: (message: string) => console.error(`[error] ${message}`),
  debug: (message: string) => console.debug(`[debug] ${message}`),
};
