import { describe, it, expect } from 'vitest';
import { deepMergeConfig } from './merge.js';
import type { LienConfig } from './schema.js';
import { defaultConfig } from './schema.js';

describe('deepMergeConfig', () => {
  it('should merge complexity.thresholds while preserving unspecified defaults', () => {
    const userConfig: Partial<LienConfig> = {
      complexity: {
        thresholds: {
          testPaths: 20,
          mentalLoad: 25,
        },
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.complexity?.thresholds.testPaths).toBe(20);
    expect(result.complexity?.thresholds.mentalLoad).toBe(25);
    // Untouched keys keep their defaults
    expect(result.complexity?.thresholds.timeToUnderstandMinutes).toBe(
      defaultConfig.complexity?.thresholds.timeToUnderstandMinutes,
    );
    expect(result.complexity?.thresholds.estimatedBugs).toBe(
      defaultConfig.complexity?.thresholds.estimatedBugs,
    );
  });

  it('should handle empty user config by returning the defaults', () => {
    const result = deepMergeConfig(defaultConfig, {});

    expect(result).toEqual(defaultConfig);
  });

  it('should ignore an empty complexity object and fall back to default thresholds', () => {
    const userConfig: Partial<LienConfig> = { complexity: { thresholds: {} } as never };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.complexity?.thresholds).toEqual(defaultConfig.complexity?.thresholds);
  });

  it('should let a fully custom thresholds object override every default value', () => {
    const userConfig: Partial<LienConfig> = {
      complexity: {
        thresholds: {
          testPaths: 5,
          mentalLoad: 5,
          timeToUnderstandMinutes: 10,
          estimatedBugs: 0.5,
        },
      },
    };

    const result = deepMergeConfig(defaultConfig, userConfig);

    expect(result.complexity?.thresholds).toEqual(userConfig.complexity?.thresholds);
  });
});
