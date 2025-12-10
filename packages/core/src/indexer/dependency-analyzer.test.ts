import { describe, it, expect } from 'vitest';
import { analyzeDependencies, COMPLEXITY_THRESHOLDS } from './dependency-analyzer.js';
import { SearchResult } from '../vectordb/types.js';
import { ChunkMetadata } from './types.js';

describe('analyzeDependencies', () => {
  const workspaceRoot = '/test/workspace';

  function createChunk(file: string, imports: string[] = [], complexity?: number): SearchResult {
    return {
      content: 'test content',
      metadata: {
        file,
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        imports,
        complexity,
      } as ChunkMetadata,
      score: 1.0,
      relevance: 'highly_relevant' as const,
    };
  }

  it('should find direct dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']),
      createChunk('src/config.ts', ['src/utils.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.dependents.map(d => d.filepath)).toEqual(
      expect.arrayContaining(['src/app.ts', 'src/config.ts'])
    );
  });

  it('should calculate risk level based on dependent count', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Add dependents up to LOW threshold (5)
      ...Array.from({ length: 3 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('low');
  });

  it('should boost risk level to medium with more dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Add dependents between LOW and MEDIUM threshold (5-15)
      ...Array.from({ length: 10 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('medium');
  });

  it('should boost risk level to high with many dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Add dependents between MEDIUM and HIGH threshold (15-30)
      ...Array.from({ length: 20 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('high');
  });

  it('should boost risk level to critical with very many dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Add more than HIGH threshold (30+)
      ...Array.from({ length: 35 }, (_, i) => createChunk(`src/dep${i}.ts`, ['src/utils.ts'])),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);
    expect(result.riskLevel).toBe('critical');
  });

  it('should calculate complexity metrics for dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts'], 15),
      createChunk('src/config.ts', ['src/utils.ts'], 25),
      createChunk('src/helper.ts', ['src/utils.ts'], 5),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.complexityMetrics).toBeDefined();
    expect(result.complexityMetrics!.filesWithComplexityData).toBe(3);
    expect(result.complexityMetrics!.maxComplexity).toBe(25);
    expect(result.complexityMetrics!.averageComplexity).toBeCloseTo((15 + 25 + 5) / 3, 1);
  });

  it('should boost risk level based on complexity metrics', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Only 3 dependents (LOW risk by count), but high complexity
      createChunk('src/app.ts', ['src/utils.ts'], 30), // High complexity
      createChunk('src/config.ts', ['src/utils.ts'], 28),
      createChunk('src/helper.ts', ['src/utils.ts'], 26),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    // Should be boosted from 'low' (by count) to 'critical' (by complexity)
    expect(result.dependentCount).toBe(3); // Only 3 dependents
    expect(result.complexityMetrics!.maxComplexity).toBeGreaterThan(COMPLEXITY_THRESHOLDS.CRITICAL_MAX);
    expect(result.riskLevel).toBe('critical');
  });

  it('should identify high-complexity dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts'], 25),
      createChunk('src/config.ts', ['src/utils.ts'], 15),
      createChunk('src/helper.ts', ['src/utils.ts'], 5),
      createChunk('src/api.ts', ['src/utils.ts'], 18),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.complexityMetrics?.highComplexityDependents).toBeDefined();
    const highComplexFiles = result.complexityMetrics!.highComplexityDependents.map(d => d.filepath);
    
    // Should include files with complexity > HIGH_COMPLEXITY_DEPENDENT (10)
    expect(highComplexFiles).toContain('src/app.ts');
    expect(highComplexFiles).toContain('src/config.ts');
    expect(highComplexFiles).toContain('src/api.ts');
    expect(highComplexFiles).not.toContain('src/helper.ts'); // 5 is below threshold
  });

  it('should handle files with no dependents', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/other.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(0);
    expect(result.dependents).toHaveLength(0);
    expect(result.riskLevel).toBe('low');
  });

  it('should identify test files correctly', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']),
      createChunk('src/utils.test.ts', ['src/utils.ts']),
      createChunk('tests/utils.spec.ts', ['src/utils.ts']),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(3);
    
    const testFiles = result.dependents.filter(d => d.isTestFile);
    const sourceFiles = result.dependents.filter(d => !d.isTestFile);
    
    expect(testFiles).toHaveLength(2);
    expect(sourceFiles).toHaveLength(1);
  });

  it('should deduplicate chunks from the same file', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      // Multiple chunks from same dependent file
      { ...createChunk('src/app.ts', ['src/utils.ts'], 10), metadata: { ...createChunk('src/app.ts', ['src/utils.ts'], 10).metadata, startLine: 1, endLine: 50 } as ChunkMetadata },
      { ...createChunk('src/app.ts', ['src/utils.ts'], 15), metadata: { ...createChunk('src/app.ts', ['src/utils.ts'], 15).metadata, startLine: 51, endLine: 100 } as ChunkMetadata },
      { ...createChunk('src/app.ts', ['src/utils.ts'], 20), metadata: { ...createChunk('src/app.ts', ['src/utils.ts'], 20).metadata, startLine: 101, endLine: 150 } as ChunkMetadata },
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    // Should count as 1 dependent file, not 3
    expect(result.dependentCount).toBe(1);
    expect(result.dependents).toHaveLength(1);
    expect(result.dependents[0].filepath).toBe('src/app.ts');
    
    // But complexity metrics should aggregate all chunks
    expect(result.complexityMetrics?.maxComplexity).toBe(20);
  });

  it('should handle chunks without complexity data', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']), // No complexity
      createChunk('src/config.ts', ['src/utils.ts'], 15),
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.complexityMetrics?.filesWithComplexityData).toBe(1); // Only src/config.ts has complexity
    expect(result.complexityMetrics?.maxComplexity).toBe(15);
  });

  it('should return low risk when no complexity data available', () => {
    const chunks: SearchResult[] = [
      createChunk('src/utils.ts', []),
      createChunk('src/app.ts', ['src/utils.ts']), // No complexity
      createChunk('src/config.ts', ['src/utils.ts']), // No complexity
    ];

    const result = analyzeDependencies('src/utils.ts', chunks, workspaceRoot);

    expect(result.dependentCount).toBe(2);
    expect(result.riskLevel).toBe('low'); // 2 dependents = low risk by count
    expect(result.complexityMetrics).toBeUndefined(); // No complexity data
  });
});

