import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { complexityCommand } from './complexity.js';
import * as lancedbModule from '../vectordb/lancedb.js';
import { configService } from '../config/service.js';
import { ChunkMetadata } from '../indexer/types.js';

// Mock dependencies
vi.mock('../vectordb/lancedb.js');
vi.mock('../config/service.js');

describe('complexityCommand', () => {
  let mockVectorDB: any;
  let mockConfig: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Mock VectorDB instance methods
    mockVectorDB = {
      initialize: vi.fn().mockResolvedValue(undefined),
      scanWithFilter: vi.fn(),
    };
    
    // Mock the VectorDB constructor to return our mock instance
    vi.mocked(lancedbModule.VectorDB).mockImplementation(function(this: any) {
      return mockVectorDB;
    } as any);

    // Mock config
    mockConfig = {
      version: '1.0',
      complexity: {
        enabled: true,
        thresholds: {
          method: 10,
          file: 50,
          average: 6,
        },
        severity: {
          warning: 1.0,
          error: 2.0,
        },
      },
    };
    vi.mocked(configService.load).mockResolvedValue(mockConfig);

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

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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
          complexity: 25, // Will be error (2.5x threshold)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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
          complexity: 15, // Warning only (1.5x threshold)
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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
          complexity: 12, // Warning
        } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
      },
    ];

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

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

    // Mock both the check and the actual scan
    mockVectorDB.scanWithFilter
      .mockResolvedValueOnce([]) // First call to check if index exists
      .mockResolvedValueOnce(chunks); // Second call for analysis

    // With default threshold of 10, this would be a violation
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

  it('should handle missing index gracefully', async () => {
    mockVectorDB.scanWithFilter.mockRejectedValue(new Error('Index not found'));

    await complexityCommand({
      format: 'text',
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

