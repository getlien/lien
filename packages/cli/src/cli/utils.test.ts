import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @liendev/core before importing utils
vi.mock('@liendev/core', () => ({
  isLienError: vi.fn((error: unknown) => {
    return error instanceof Error && error.name === 'LienError';
  }),
  getErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  }),
  getErrorStack: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.stack;
    return undefined;
  }),
}));

// Mock ora
vi.mock('ora', () => {
  const mockOra = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    render: vi.fn().mockReturnThis(),
    text: '',
  };
  return {
    default: vi.fn(() => mockOra),
    __mockOra: mockOra,
  };
});

import {
  formatDuration,
  formatFileCount,
  formatChunkCount,
  handleCommandError,
  TaskSpinner,
} from './utils.js';
import { isLienError } from '@liendev/core';

describe('formatDuration', () => {
  it('should format milliseconds below 1000', () => {
    expect(formatDuration(123)).toBe('123ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds for 1000ms and above', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(10000)).toBe('10.0s');
  });

  it('should handle zero', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('should round millisecond values', () => {
    expect(formatDuration(123.7)).toBe('124ms');
    expect(formatDuration(0.4)).toBe('0ms');
  });
});

describe('formatFileCount', () => {
  it('should use singular form for 1', () => {
    expect(formatFileCount(1)).toBe('1 file');
  });

  it('should use plural form for 0', () => {
    expect(formatFileCount(0)).toBe('0 files');
  });

  it('should use plural form for values > 1', () => {
    expect(formatFileCount(5)).toBe('5 files');
    expect(formatFileCount(100)).toBe('100 files');
  });
});

describe('formatChunkCount', () => {
  it('should use singular form for 1', () => {
    expect(formatChunkCount(1)).toBe('1 chunk');
  });

  it('should use plural form for 0', () => {
    expect(formatChunkCount(0)).toBe('0 chunks');
  });

  it('should use plural form for values > 1', () => {
    expect(formatChunkCount(5)).toBe('5 chunks');
    expect(formatChunkCount(100)).toBe('100 chunks');
  });
});

describe('handleCommandError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show clean message for LienError', () => {
    const error = new Error('Something went wrong');
    error.name = 'LienError';
    vi.mocked(isLienError).mockReturnValueOnce(true);

    handleCommandError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
  });

  it('should show "Unexpected error" for non-LienError', () => {
    const error = new Error('Kaboom');
    vi.mocked(isLienError).mockReturnValueOnce(false);

    handleCommandError(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected error: Kaboom'),
    );
  });

  it('should show verbose hint when not verbose', () => {
    const error = new Error('test');
    vi.mocked(isLienError).mockReturnValueOnce(false);

    handleCommandError(error, false);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Run with --verbose for more details'),
    );
  });

  it('should not show verbose hint when verbose is true', () => {
    const error = new Error('test');
    vi.mocked(isLienError).mockReturnValueOnce(false);

    handleCommandError(error, true);

    const allCalls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(allCalls).not.toContain('Run with --verbose for more details');
  });

  it('should show context for LienError in verbose mode', () => {
    const error = Object.assign(new Error('bad config'), {
      name: 'LienError',
      context: { path: '/foo/bar' },
    });
    vi.mocked(isLienError).mockReturnValueOnce(true);

    handleCommandError(error, true);

    const allCalls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(allCalls).toContain('Context:');
    expect(allCalls).toContain('/foo/bar');
  });

  it('should show stack trace for unexpected errors in verbose mode', () => {
    const error = new Error('something');
    vi.mocked(isLienError).mockReturnValueOnce(false);

    handleCommandError(error, true);

    const allCalls = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(allCalls).toContain('Stack trace:');
  });
});

describe('TaskSpinner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should delegate succeed to ora', () => {
    const spinner = new TaskSpinner('Loading...');
    spinner.succeed('Done!');
    expect(spinner.raw.succeed).toHaveBeenCalledWith('Done!');
  });

  it('should delegate stop to ora', () => {
    const spinner = new TaskSpinner('Loading...');
    spinner.stop();
    expect(spinner.raw.stop).toHaveBeenCalled();
  });

  it('should delegate warn to ora', () => {
    const spinner = new TaskSpinner('Loading...');
    spinner.warn('Warning!');
    expect(spinner.raw.warn).toHaveBeenCalledWith('Warning!');
  });

  it('should delegate info to ora', () => {
    const spinner = new TaskSpinner('Loading...');
    spinner.info('Info!');
    expect(spinner.raw.info).toHaveBeenCalledWith('Info!');
  });

  it('should update text via update method', () => {
    const spinner = new TaskSpinner('Loading...');
    spinner.update('Still loading...');
    expect(spinner.raw.text).toBe('Still loading...');
  });
});
