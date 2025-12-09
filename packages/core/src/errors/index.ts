import { LienErrorCode } from './codes.js';

// Re-export for consumers
export { LienErrorCode } from './codes.js';

/**
 * Severity levels for errors
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Base error class for all Lien-specific errors
 */
export class LienError extends Error {
  constructor(
    message: string,
    public readonly code: LienErrorCode,
    public readonly context?: Record<string, unknown>,
    public readonly severity: ErrorSeverity = 'medium',
    public readonly recoverable: boolean = true,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LienError';
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  /**
   * Serialize error to JSON for MCP responses
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context,
    };
  }
  
  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return this.retryable;
  }
  
  /**
   * Check if this error is recoverable
   */
  isRecoverable(): boolean {
    return this.recoverable;
  }
}

/**
 * Configuration-related errors (loading, parsing, migration)
 */
export class ConfigError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, LienErrorCode.CONFIG_INVALID, context, 'medium', true, false);
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
    super(message, LienErrorCode.INTERNAL_ERROR, { ...context, file }, 'medium', true, false);
    this.name = 'IndexingError';
  }
}

/**
 * Embedding generation errors
 */
export class EmbeddingError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, LienErrorCode.EMBEDDING_GENERATION_FAILED, context, 'high', true, true);
    this.name = 'EmbeddingError';
  }
}

/**
 * Vector database errors (connection, query, storage)
 */
export class DatabaseError extends LienError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, LienErrorCode.INTERNAL_ERROR, context, 'high', true, true);
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
    LienErrorCode.INTERNAL_ERROR,
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

