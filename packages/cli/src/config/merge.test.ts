import { describe, it, expect } from 'vitest';
import { deepMergeConfig, detectNewFields } from './merge.js';
import { LienConfig, defaultConfig } from './schema.js';

describe('deepMergeConfig', () => {
  it('should merge indexing config while preserving defaults', () => {
    const userConfig: Partial<LienConfig> = {
      indexing: {
        chunkSize: 100,
        chunkOverlap: 20,
        concurrency: 8,
        embeddingBatchSize: 100,
        include: ['**/*.ts'],
        exclude: [],
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.indexing.chunkSize).toBe(100);
    expect(result.indexing.concurrency).toBe(8);
    expect(result.indexing.chunkOverlap).toBe(20);
  });

  it('should merge mcp config while preserving defaults', () => {
    const userConfig: Partial<LienConfig> = {
      mcp: {
        port: 4000,
        transport: 'stdio' as const,
        autoIndexOnFirstRun: false,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.mcp.port).toBe(4000);
    expect(result.mcp.transport).toBe('stdio');
    expect(result.mcp.autoIndexOnFirstRun).toBe(false);
  });

  it('should preserve default values for unspecified fields', () => {
    const userConfig: Partial<LienConfig> = {
      indexing: {
        ...defaultConfig.indexing,
        chunkSize: 100,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.indexing.chunkSize).toBe(100);
    expect(result.indexing.chunkOverlap).toBe(defaultConfig.indexing.chunkOverlap);
    expect(result.mcp).toEqual(defaultConfig.mcp);
    expect(result.gitDetection).toEqual(defaultConfig.gitDetection);
  });

  it('should handle empty user config', () => {
    const userConfig: Partial<LienConfig> = {};

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result).toEqual(defaultConfig);
  });

  it('should merge gitDetection config', () => {
    const userConfig: Partial<LienConfig> = {
      gitDetection: {
        enabled: false,
        pollInterval: 10000,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.gitDetection.enabled).toBe(false);
    expect(result.gitDetection.pollInterval).toBe(10000);
  });

  it('should merge fileWatching config', () => {
    const userConfig: Partial<LienConfig> = {
      fileWatching: {
        enabled: true,
        debounceMs: 500,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.fileWatching.enabled).toBe(true);
    expect(result.fileWatching.debounceMs).toBe(500);
  });

  it('should work with actual Lien config', () => {
    const userConfig: Partial<LienConfig> = {
      indexing: {
        chunkSize: 100,
        chunkOverlap: 20,
        concurrency: 8,
        embeddingBatchSize: 100,
        include: ['**/*.ts'],
        exclude: [],
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.indexing.chunkSize).toBe(100);
    expect(result.indexing.concurrency).toBe(8);
    expect(result.mcp.port).toBe(defaultConfig.mcp.port); // Default preserved
  });
});

describe('detectNewFields', () => {
  it('should detect top-level new fields', () => {
    const existing: Partial<LienConfig> = {
      indexing: defaultConfig.indexing,
      mcp: defaultConfig.mcp,
    };
    
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toContain('gitDetection');
    expect(newFields).toContain('fileWatching');
  });

  it('should detect nested new fields', () => {
    const existing: Partial<LienConfig> = {
      mcp: {
        port: 3000,
        transport: 'stdio' as const,
        // Missing autoIndexOnFirstRun
      },
      indexing: defaultConfig.indexing,
      gitDetection: defaultConfig.gitDetection,
      fileWatching: defaultConfig.fileWatching,
    };
    
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toContain('mcp.autoIndexOnFirstRun');
  });

  it('should return empty array when no new fields', () => {
    const existing = { ...defaultConfig };
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toEqual([]);
  });

  it('should not report fields that exist with different values', () => {
    const existing: Partial<LienConfig> = {
      ...defaultConfig,
      indexing: {
        ...defaultConfig.indexing,
        chunkSize: 100, // Different value
      },
    };
    
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toEqual([]);
  });

  it('should work with actual Lien config upgrades', () => {
    const oldConfig: Partial<LienConfig> = {
      indexing: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
        include: [],
        exclude: [],
      },
      mcp: {
        port: 3000,
        transport: 'stdio' as const,
        autoIndexOnFirstRun: true,
      },
      // Missing gitDetection and fileWatching (new fields)
    };

    const newFields = detectNewFields(oldConfig, defaultConfig);

    expect(newFields).toContain('gitDetection');
    expect(newFields).toContain('fileWatching');
  });

  it('should detect new nested config options', () => {
    const oldConfig: Partial<LienConfig> = {
      mcp: {
        port: 3000,
        transport: 'stdio' as const,
        // Missing autoIndexOnFirstRun
      },
    };

    const newFields = detectNewFields(oldConfig, defaultConfig);

    expect(newFields).toContain('mcp.autoIndexOnFirstRun');
  });
});

