import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { complexityCommand } from './complexity.js';
import * as coreModule from '@liendev/core';
import type { ChunkMetadata } from '@liendev/core';

// Mock dependencies
vi.mock('@liendev/core', async () => {
  const actual = await vi.importActual<typeof import('@liendev/core')>('@liendev/core');
  return {
    ...actual,
    VectorDB: class MockVectorDB {
      constructor() {}
      async initialize() {}
      async scanWithFilter() {}
      async scanAll() {}
    },
  };
});

describe('complexityCommand', () => {
  let mockVectorDB: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Mock VectorDB instance methods
    mockVectorDB = {
      initialize: vi.fn().mockResolvedValue(undefined),
      scanWithFilter: vi.fn(), // Used for index existence check
      scanAll: vi.fn(), // Used for actual analysis
    };

    // Mock VectorDB constructor to return our mock instance
    (coreModule.VectorDB as any) = class {
      constructor() {
        return mockVectorDB;
      }
    };

    // Spy on console
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Spy on process.exit - don't make it throw, just track calls
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      // Don't throw, just prevent actual exit
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output text format by default', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'text',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain('Complexity Analysis');
  });

  it('should output JSON format when requested', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'json',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];

    // Should be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.summary).toBeDefined();
    expect(parsed.files).toBeDefined();
  });

  it('should output SARIF format when requested', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'sarif',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];

    // Should be valid JSON with SARIF structure
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.$schema).toContain('sarif');
    expect(parsed.runs).toBeDefined();
  });

  it('should filter by specific files when provided', async () => {
    const chunks = [
      {
        content: 'function test1() { }',
        metadata: {
          file: 'src/file1.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test1',
          symbolType: 'function',
          complexity: 15,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
      {
        content: 'function test2() { }',
        metadata: {
          file: 'src/file2.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test2',
          symbolType: 'function',
          complexity: 20,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      files: ['src/file1.ts'],
      format: 'json',
    });

    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    // Should only include file1
    expect(parsed.files['src/file1.ts']).toBeDefined();
    expect(parsed.files['src/file2.ts']).toBeUndefined();
  });

  it('should exit with code 1 when --fail-on error and errors exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 35, // Will be error (>= 30, which is 2.0x threshold of 15)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'text',
      failOn: 'error',
    });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should not exit when --fail-on error and only warnings exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 20, // Warning only (>= 15, < 30)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'text',
      failOn: 'error',
    });

    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should exit with code 1 when --fail-on warning and warnings exist', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 20, // Warning (>= 15)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    await complexityCommand({
      format: 'text',
      failOn: 'warning',
    });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should override threshold when provided via CLI', async () => {
    const chunks = [
      {
        content: 'function test() { }',
        metadata: {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function',
          language: 'typescript',
          symbolName: 'test',
          symbolType: 'function',
          complexity: 12,
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]); // Check if index exists
    mockVectorDB.scanAll.mockResolvedValue(chunks); // Actual analysis

    // With default threshold of 15, this would be a violation
    // But with threshold of 15, it should not be
    await complexityCommand({
      format: 'json',
      threshold: '15',
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.summary.totalViolations).toBe(0);
  });

  it('should handle invalid threshold gracefully', async () => {
    await complexityCommand({
      format: 'text',
      threshold: 'invalid',
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle invalid --fail-on value', async () => {
    await complexityCommand({
      format: 'text',
      failOn: 'critical' as any, // Invalid value
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --fail-on value "critical"'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle invalid --format value', async () => {
    await complexityCommand({
      format: 'xml' as any, // Invalid format
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid --format value "xml"'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should warn about threshold flags (not supported)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Mock index check and actual scan
    mockVectorDB.scanWithFilter.mockResolvedValue([{ id: 'test' }]);
    mockVectorDB.scanAll.mockResolvedValue([]);

    await complexityCommand({
      format: 'text',
      threshold: '-5',
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Threshold overrides via CLI flags are not supported'),
    );

    consoleWarnSpy.mockRestore();
  });

  it('should handle missing index gracefully', async () => {
    mockVectorDB.scanWithFilter.mockRejectedValue(new Error('Index not found'));

    await complexityCommand({
      format: 'text',
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
