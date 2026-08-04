/**
 * Shared logging helpers -- the hub module every handler in this fixture
 * corpus imports.
 */

export function logInfo(message: string): void {
  console.log(`[info] ${message}`);
}

export function logError(context: string, err: Error): void {
  console.log(`[error] ${context}: ${err.message}`);
}
