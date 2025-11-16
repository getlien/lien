import { describe, it, expect } from 'vitest';
import { deepMergeConfig, detectNewFields } from './merge.js';
import { LienConfig, defaultConfig } from './schema.js';

describe('deepMergeConfig', () => {
  it('should merge core config while preserving defaults', () => {
    const userConfig: Partial<LienConfig> = {
      core: {
        chunkSize: 100,
        chunkOverlap: 20,
        concurrency: 8,
        embeddingBatchSize: 100,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.core.chunkSize).toBe(100);
    expect(result.core.concurrency).toBe(8);
    expect(result.core.chunkOverlap).toBe(20);
  });

  it('should merge mcp config while preserving defaults', () => {
    const userConfig: Partial<LienConfig> = {
      mcp: {
        port: 8080,
        transport: 'stdio' as const,
        autoIndexOnFirstRun: false,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.mcp.port).toBe(8080);
    expect(result.mcp.transport).toBe('stdio');
    expect(result.mcp.autoIndexOnFirstRun).toBe(false);
  });

  it('should preserve default values for unspecified fields', () => {
    const userConfig: Partial<LienConfig> = {
      core: {
        ...defaultConfig.core,
        chunkSize: 100,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.core.chunkSize).toBe(100);
    expect(result.core.chunkOverlap).toBe(defaultConfig.core.chunkOverlap);
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
        pollIntervalMs: 10000,
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.gitDetection.enabled).toBe(false);
    expect(result.gitDetection.pollIntervalMs).toBe(10000);
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
      core: {
        chunkSize: 100,
        chunkOverlap: 20,
        concurrency: 8,
        embeddingBatchSize: 100,
      },
      frameworks: [
        {
          name: 'nodejs',
          path: '.',
          enabled: true,
          config: {
            include: ['**/*.ts'],
            exclude: [],
          },
        },
      ],
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.core.chunkSize).toBe(100);
    expect(result.core.concurrency).toBe(8);
    expect(result.mcp.port).toBe(defaultConfig.mcp.port); // Default preserved
    expect(result.frameworks).toHaveLength(1);
  });
});

describe('detectNewFields', () => {
  it('should detect top-level new fields', () => {
    const existing: Partial<LienConfig> = {
      core: defaultConfig.core,
      mcp: defaultConfig.mcp,
    };
    
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toContain('gitDetection');
    expect(newFields).toContain('fileWatching');
  });

  it('should detect nested new fields', () => {
    const existing: Partial<LienConfig> = {
      mcp: {
        port: 7133,
        transport: 'stdio' as const,
      } as any, // Type assertion to allow missing optional fields for testing
      core: defaultConfig.core,
      gitDetection: defaultConfig.gitDetection,
      fileWatching: defaultConfig.fileWatching,
      frameworks: defaultConfig.frameworks,
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
      core: {
        ...defaultConfig.core,
        chunkSize: 100, // Different value
      },
    };
    
    const newFields = detectNewFields(existing, defaultConfig);

    expect(newFields).toEqual([]);
  });

  it('should work with actual Lien config upgrades', () => {
    const oldConfig: Partial<LienConfig> = {
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      mcp: {
        port: 7133,
        transport: 'stdio' as const,
        autoIndexOnFirstRun: true,
      },
      frameworks: [],
      // Missing gitDetection and fileWatching (new fields)
    };

    const newFields = detectNewFields(oldConfig, defaultConfig);

    expect(newFields).toContain('gitDetection');
    expect(newFields).toContain('fileWatching');
  });

  it('should detect new nested config options', () => {
    const oldConfig: Partial<LienConfig> = {
      mcp: {
        port: 7133,
        transport: 'stdio' as const,
      } as any, // Type assertion to allow missing optional fields for testing
    };

    const newFields = detectNewFields(oldConfig, defaultConfig);

    expect(newFields).toContain('mcp.autoIndexOnFirstRun');
  });
});

