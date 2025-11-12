import { describe, it, expect } from 'vitest';
import { deepMergeConfig, detectNewFields } from './merge.js';
import { LienConfig, defaultConfig } from './schema.js';

describe('deepMergeConfig', () => {
  it('should merge nested objects', () => {
    const target = {
      a: 1,
      b: { c: 2, d: 3 },
    };
    const source = {
      b: { d: 4, e: 5 },
      f: 6,
    };
    const result = deepMergeConfig(target, source as any);

    expect(result).toEqual({
      a: 1,
      b: { c: 2, d: 4, e: 5 },
      f: 6,
    });
  });

  it('should replace arrays entirely, not merge them', () => {
    const target = {
      arr: [1, 2, 3],
    };
    const source = {
      arr: [4, 5],
    };
    const result = deepMergeConfig(target, source);

    expect(result.arr).toEqual([4, 5]);
  });

  it('should handle null and undefined values', () => {
    const target = {
      a: 1,
      b: null as any,
      c: undefined as any,
    };
    const source = {
      b: 2,
      c: 3,
    };
    const result = deepMergeConfig(target, source);

    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
    expect(result.c).toBe(3);
  });

  it('should override primitive values', () => {
    const target = {
      a: 1,
      b: 'hello',
      c: true,
    };
    const source = {
      a: 2,
      b: 'world',
      c: false,
    };
    const result = deepMergeConfig(target, source);

    expect(result).toEqual({
      a: 2,
      b: 'world',
      c: false,
    });
  });

  it('should handle deeply nested objects', () => {
    const target = {
      a: {
        b: {
          c: {
            d: 1,
          },
        },
      },
    };
    const source = {
      a: {
        b: {
          c: {
            e: 2,
          },
        },
      },
    };
    const result = deepMergeConfig(target, source as any);

    expect(result).toEqual({
      a: {
        b: {
          c: {
            d: 1,
            e: 2,
          },
        },
      },
    });
  });

  it('should not mutate source or target', () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { b: { d: 3 } };
    const result = deepMergeConfig(target, source as any);

    expect(target).toEqual({ a: 1, b: { c: 2 } });
    expect(source).toEqual({ b: { d: 3 } });
    expect(result).toEqual({ a: 1, b: { c: 2, d: 3 } });
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
    const existing = {
      a: 1,
      b: 2,
    };
    const defaults = {
      a: 1,
      b: 2,
      c: 3,
    };
    const newFields = detectNewFields(existing as any, defaults as any);

    expect(newFields).toEqual(['c']);
  });

  it('should detect nested new fields', () => {
    const existing = {
      a: {
        b: 1,
      },
    };
    const defaults = {
      a: {
        b: 1,
        c: 2,
      },
    };
    const newFields = detectNewFields(existing as any, defaults as any);

    expect(newFields).toEqual(['a.c']);
  });

  it('should detect deeply nested new fields', () => {
    const existing = {
      a: {
        b: {
          c: 1,
        },
      },
    };
    const defaults = {
      a: {
        b: {
          c: 1,
          d: 2,
        },
        e: 3,
      },
      f: 4,
    };
    const newFields = detectNewFields(existing as any, defaults as any);

    expect(newFields).toContain('a.b.d');
    expect(newFields).toContain('a.e');
    expect(newFields).toContain('f');
  });

  it('should return empty array when no new fields', () => {
    const existing = {
      a: 1,
      b: { c: 2 },
    };
    const defaults = {
      a: 1,
      b: { c: 2 },
    };
    const newFields = detectNewFields(existing as any, defaults as any);

    expect(newFields).toEqual([]);
  });

  it('should not report fields that exist with different values', () => {
    const existing = {
      a: 1,
      b: { c: 100 }, // Different value
    };
    const defaults = {
      a: 1,
      b: { c: 2 },
    };
    const newFields = detectNewFields(existing as any, defaults as any);

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

