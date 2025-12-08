import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  groupByConfidence,
  selectByPriority,
  resolveFrameworkConflicts,
  runAllDetectors,
  type DetectionWithPriority,
} from './detector-service.js';
import { frameworkDetectors } from './registry.js';

// Helper to create mock detections
function createDetection(
  name: string,
  confidence: 'high' | 'medium' | 'low',
  priority: number = 0
): DetectionWithPriority {
  return {
    detected: true,
    name,
    path: '.',
    confidence,
    evidence: [`${name} detected`],
    priority,
  };
}

describe('groupByConfidence', () => {
  it('should group detections by confidence level', () => {
    const detections = [
      createDetection('nodejs', 'high', 10),
      createDetection('laravel', 'high', 5),
      createDetection('generic', 'medium', 3),
      createDetection('fallback', 'low', 1),
    ];

    const grouped = groupByConfidence(detections);

    expect(grouped.high).toHaveLength(2);
    expect(grouped.medium).toHaveLength(1);
    expect(grouped.low).toHaveLength(1);
    expect(grouped.high.map(d => d.name)).toEqual(['nodejs', 'laravel']);
  });

  it('should handle empty arrays for missing confidence levels', () => {
    const detections = [createDetection('nodejs', 'high', 10)];

    const grouped = groupByConfidence(detections);

    expect(grouped.high).toHaveLength(1);
    expect(grouped.medium).toHaveLength(0);
    expect(grouped.low).toHaveLength(0);
  });

  it('should handle empty input', () => {
    const grouped = groupByConfidence([]);

    expect(grouped.high).toHaveLength(0);
    expect(grouped.medium).toHaveLength(0);
    expect(grouped.low).toHaveLength(0);
  });
});

describe('selectByPriority', () => {
  it('should select highest priority as winner', () => {
    const detections = [
      createDetection('low-priority', 'medium', 1),
      createDetection('high-priority', 'medium', 10),
      createDetection('mid-priority', 'medium', 5),
    ];

    const { winner, skipped } = selectByPriority(detections);

    expect(winner.name).toBe('high-priority');
    expect(skipped).toHaveLength(2);
    expect(skipped.map(d => d.name)).toEqual(['mid-priority', 'low-priority']);
  });

  it('should handle single detection', () => {
    const detections = [createDetection('only-one', 'medium', 5)];

    const { winner, skipped } = selectByPriority(detections);

    expect(winner.name).toBe('only-one');
    expect(skipped).toHaveLength(0);
  });

  it('should handle equal priorities (stable sort)', () => {
    const detections = [
      createDetection('first', 'medium', 5),
      createDetection('second', 'medium', 5),
    ];

    const { winner, skipped } = selectByPriority(detections);

    // Both have same priority, first in sorted order wins
    expect(winner).toBeDefined();
    expect(skipped).toHaveLength(1);
  });

  it('should throw error for empty array', () => {
    expect(() => selectByPriority([])).toThrow('selectByPriority requires at least one detection');
  });
});

describe('resolveFrameworkConflicts', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('no conflicts', () => {
    it('should return empty array for no detections', () => {
      const result = resolveFrameworkConflicts([], '.');
      expect(result).toEqual([]);
    });

    it('should return single detection without priority field', () => {
      const detections = [createDetection('nodejs', 'high', 10)];

      const result = resolveFrameworkConflicts(detections, '.');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('nodejs');
      expect((result[0] as any).priority).toBeUndefined();
    });
  });

  describe('hybrid projects (multiple HIGH confidence)', () => {
    it('should keep all HIGH confidence frameworks', () => {
      const detections = [
        createDetection('nodejs', 'high', 10),
        createDetection('shopify', 'high', 5),
      ];

      const result = resolveFrameworkConflicts(detections, '.');

      expect(result).toHaveLength(2);
      expect(result.map(r => r.name)).toContain('nodejs');
      expect(result.map(r => r.name)).toContain('shopify');
    });

    it('should log hybrid project detection', () => {
      const detections = [
        createDetection('nodejs', 'high', 10),
        createDetection('laravel', 'high', 5),
      ];

      resolveFrameworkConflicts(detections, '.');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detected hybrid project')
      );
    });

    it('should skip lower confidence detections in hybrid scenario', () => {
      const detections = [
        createDetection('nodejs', 'high', 10),
        createDetection('shopify', 'high', 5),
        createDetection('generic', 'medium', 3),
      ];

      const result = resolveFrameworkConflicts(detections, '.');

      expect(result).toHaveLength(2);
      expect(result.map(r => r.name)).not.toContain('generic');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping lower confidence')
      );
    });
  });

  describe('single HIGH confidence', () => {
    it('should keep single HIGH and skip lower confidence', () => {
      const detections = [
        createDetection('nodejs', 'high', 10),
        createDetection('generic', 'medium', 5),
        createDetection('fallback', 'low', 1),
      ];

      const result = resolveFrameworkConflicts(detections, '.');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('nodejs');
    });
  });

  describe('MEDIUM confidence priority resolution', () => {
    it('should select highest priority MEDIUM when no HIGH exists', () => {
      const detections = [
        createDetection('low-priority', 'medium', 1),
        createDetection('high-priority', 'medium', 10),
      ];

      const result = resolveFrameworkConflicts(detections, 'subdir');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('high-priority');
    });

    it('should log skipped frameworks with path context', () => {
      const detections = [
        createDetection('winner', 'medium', 10),
        createDetection('loser', 'medium', 1),
      ];

      resolveFrameworkConflicts(detections, 'packages/api');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('packages/api')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('winner takes precedence')
      );
    });
  });

  describe('LOW confidence priority resolution', () => {
    it('should select highest priority LOW when no HIGH or MEDIUM exists', () => {
      const detections = [
        createDetection('low-priority', 'low', 1),
        createDetection('high-priority', 'low', 10),
      ];

      const result = resolveFrameworkConflicts(detections, '.');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('high-priority');
    });

    it('should not log if only one LOW confidence detection', () => {
      const detections = [createDetection('only-low', 'low', 5)];

      resolveFrameworkConflicts(detections, '.');

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('priority field stripping', () => {
    it('should strip priority from all returned results', () => {
      const detections = [
        createDetection('nodejs', 'high', 10),
        createDetection('laravel', 'high', 5),
      ];

      const result = resolveFrameworkConflicts(detections, '.');

      result.forEach(r => {
        expect((r as any).priority).toBeUndefined();
      });
    });
  });
});

describe('runAllDetectors', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should run all registered detectors', async () => {
    // This tests against the real registry - verifies integration
    const results = await runAllDetectors(__dirname, '.');

    // Should return an array (may be empty if no frameworks detected in test dir)
    expect(Array.isArray(results)).toBe(true);
  });

  it('should include priority from detector in results', async () => {
    // Create a temp directory structure that will trigger detection
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-'));

    try {
      // Create package.json to trigger Node.js detection
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '1.0.0' })
      );

      const results = await runAllDetectors(tempDir, '.');

      // Should detect Node.js
      expect(results.length).toBeGreaterThan(0);

      // Each result should have a priority field
      results.forEach(result => {
        expect(typeof result.priority).toBe('number');
      });

      // Should find nodejs detector result
      const nodejsResult = results.find(r => r.name === 'nodejs');
      expect(nodejsResult).toBeDefined();
      expect(nodejsResult?.detected).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });

  it('should filter out non-detected frameworks', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-'));

    try {
      // Create empty directory - no frameworks should be detected
      const results = await runAllDetectors(tempDir, '.');

      // All results should have detected: true (non-detected are filtered)
      results.forEach(result => {
        expect(result.detected).toBe(true);
      });
    } finally {
      await fs.rm(tempDir, { recursive: true });
    }
  });

  it('should continue execution if a detector throws', async () => {
    // Mock a detector that throws
    const originalDetectors = [...frameworkDetectors];

    // Add a throwing detector to the registry temporarily
    const throwingDetector = {
      name: 'throwing-detector',
      priority: 0,
      detect: async () => {
        throw new Error('Detector error');
      },
      generateConfig: async () => ({} as any),
    };

    frameworkDetectors.unshift(throwingDetector);

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-'));

      try {
        // Create package.json to trigger Node.js detection
        await fs.writeFile(
          path.join(tempDir, 'package.json'),
          JSON.stringify({ name: 'test-project', version: '1.0.0' })
        );

        // Should not throw, should log error and continue
        const results = await runAllDetectors(tempDir, '.');

        // Should have logged the error
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error running detector 'throwing-detector'"),
          expect.any(Error)
        );

        // Should still get results from other detectors
        expect(results.some(r => r.name === 'nodejs')).toBe(true);
      } finally {
        await fs.rm(tempDir, { recursive: true });
      }
    } finally {
      // Restore original detectors
      frameworkDetectors.length = 0;
      frameworkDetectors.push(...originalDetectors);
    }
  });
});
