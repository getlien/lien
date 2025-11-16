/**
 * Base error class for all Lien-specific errors
 */
export class LienError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LienError';
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Configuration-related errors (loading, parsing, migration)
 */
export class ConfigError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}

/**
 * Indexing-related errors (file processing, chunking)
 */
export class IndexingError extends LienError {
  constructor(
    message: string,
    public readonly file?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'INDEXING_ERROR', { ...context, file });
    this.name = 'IndexingError';
  }
}

/**
 * Embedding generation errors
 */
export class EmbeddingError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', context);
    this.name = 'EmbeddingError';
  }
}

/**
 * Vector database errors (connection, query, storage)
 */
export class DatabaseError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', context);
    this.name = 'DatabaseError';
  }
}

/**
 * Helper function to wrap unknown errors with context
 * @param error - Unknown error object to wrap
 * @param context - Context message describing what operation failed
 * @param additionalContext - Optional additional context data
 * @returns LienError with proper message and context
 */
export function wrapError(
  error: unknown,
  context: string,
  additionalContext?: Record<string, unknown>
): LienError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  const wrappedError = new LienError(
    `${context}: ${message}`,
    'WRAPPED_ERROR',
    additionalContext
  );
  
  // Preserve original stack trace if available
  if (stack) {
    wrappedError.stack = `${wrappedError.stack}\n\nCaused by:\n${stack}`;
  }
  
  return wrappedError;
}

/**
 * Type guard to check if an error is a LienError
 */
export function isLienError(error: unknown): error is LienError {
  return error instanceof LienError;
}

/**
 * Extract error message from unknown error type
 * @param error - Unknown error object
 * @returns Error message string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Extract stack trace from unknown error type
 * @param error - Unknown error object
 * @returns Stack trace string or undefined
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

