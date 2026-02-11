import { describe, it, expect } from 'vitest';
import { LienError, LienErrorCode, type ErrorSeverity } from './index.js';

describe('LienError', () => {
  it('should create error with all properties', () => {
    const error = new LienError(
      'Test error',
      LienErrorCode.INVALID_INPUT,
      { field: 'test' },
      'high',
      false,
      true,
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(LienErrorCode.INVALID_INPUT);
    expect(error.context).toEqual({ field: 'test' });
    expect(error.severity).toBe('high');
    expect(error.recoverable).toBe(false);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('LienError');
  });

  it('should create error with defaults', () => {
    const error = new LienError('Test error', LienErrorCode.FILE_NOT_FOUND);

    expect(error.message).toBe('Test error');
    expect(error.code).toBe(LienErrorCode.FILE_NOT_FOUND);
    expect(error.context).toBeUndefined();
    expect(error.severity).toBe('medium');
    expect(error.recoverable).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('should serialize to JSON correctly', () => {
    const error = new LienError(
      'Test error',
      LienErrorCode.FILE_NOT_FOUND,
      { path: '/test/path' },
      'high',
      false,
      true,
    );

    const json = error.toJSON();
    expect(json).toEqual({
      error: 'Test error',
      code: 'FILE_NOT_FOUND',
      severity: 'high',
      recoverable: false,
      context: { path: '/test/path' },
    });
  });

  it('should serialize to JSON with undefined context', () => {
    const error = new LienError('Simple error', LienErrorCode.INTERNAL_ERROR);

    const json = error.toJSON();
    expect(json).toEqual({
      error: 'Simple error',
      code: 'INTERNAL_ERROR',
      severity: 'medium',
      recoverable: true,
      context: undefined,
    });
  });

  it('should correctly report retryable status', () => {
    const retryable = new LienError(
      'Retryable error',
      LienErrorCode.EMBEDDING_GENERATION_FAILED,
      undefined,
      'medium',
      true,
      true,
    );
    expect(retryable.isRetryable()).toBe(true);

    const notRetryable = new LienError(
      'Not retryable',
      LienErrorCode.INVALID_INPUT,
      undefined,
      'medium',
      true,
      false,
    );
    expect(notRetryable.isRetryable()).toBe(false);
  });

  it('should correctly report recoverable status', () => {
    const recoverable = new LienError(
      'Recoverable error',
      LienErrorCode.FILE_NOT_FOUND,
      undefined,
      'medium',
      true,
      false,
    );
    expect(recoverable.isRecoverable()).toBe(true);

    const notRecoverable = new LienError(
      'Not recoverable',
      LienErrorCode.INDEX_CORRUPTED,
      undefined,
      'critical',
      false,
      false,
    );
    expect(notRecoverable.isRecoverable()).toBe(false);
  });

  it('should have proper stack trace', () => {
    const error = new LienError('Test error', LienErrorCode.INTERNAL_ERROR);

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('LienError');
  });

  it('should work with all severity levels', () => {
    const severities: ErrorSeverity[] = ['low', 'medium', 'high', 'critical'];

    severities.forEach(severity => {
      const error = new LienError('Test', LienErrorCode.INTERNAL_ERROR, undefined, severity);
      expect(error.severity).toBe(severity);
    });
  });

  it('should work with all error codes', () => {
    const codes = [
      LienErrorCode.CONFIG_NOT_FOUND,
      LienErrorCode.CONFIG_INVALID,
      LienErrorCode.INDEX_NOT_FOUND,
      LienErrorCode.INDEX_CORRUPTED,
      LienErrorCode.EMBEDDING_MODEL_FAILED,
      LienErrorCode.EMBEDDING_GENERATION_FAILED,
      LienErrorCode.FILE_NOT_FOUND,
      LienErrorCode.FILE_NOT_READABLE,
      LienErrorCode.INVALID_PATH,
      LienErrorCode.INVALID_INPUT,
      LienErrorCode.INTERNAL_ERROR,
    ];

    codes.forEach(code => {
      const error = new LienError('Test', code);
      expect(error.code).toBe(code);
    });
  });

  it('should allow complex context objects', () => {
    const context = {
      file: 'test.ts',
      line: 42,
      column: 15,
      details: {
        expected: 'string',
        received: 'number',
      },
    };

    const error = new LienError('Type error', LienErrorCode.INVALID_INPUT, context);

    expect(error.context).toEqual(context);
    const json = error.toJSON();
    expect(json.context).toEqual(context);
  });

  it('should be instanceof Error', () => {
    const error = new LienError('Test', LienErrorCode.INTERNAL_ERROR);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LienError);
  });

  it('should have correct name property', () => {
    const error = new LienError('Test', LienErrorCode.INTERNAL_ERROR);

    expect(error.name).toBe('LienError');
  });
});
