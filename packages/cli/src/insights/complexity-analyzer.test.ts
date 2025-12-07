import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComplexityAnalyzer } from './complexity-analyzer.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { LienConfig } from '../config/schema.js';
import { ChunkMetadata } from '../indexer/types.js';
import { SearchResult } from '../vectordb/types.js';

describe('ComplexityAnalyzer', () => {
  let mockVectorDB: VectorDB;
  let config: LienConfig;

  beforeEach(() => {
    // Create mock VectorDB
    mockVectorDB = {
      scanAll: vi.fn(),
    } as any;

    // Default config
    config = {
      version: '1.0',
      complexity: {
        enabled: true,
        thresholds: {
          testPaths: 15,
          mentalLoad: 15,
        },
      },
    } as any;
  });

  describe('analyze', () => {
    it('should find violations above threshold', async () => {
      const chunks = [
        {
          content: 'function complex() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'complex',
            symbolType: 'function',
            complexity: 20, // Above threshold of 15
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        {
          content: 'function simple() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 12,
            endLine: 15,
            type: 'function',
            language: 'typescript',
            symbolName: 'simple',
            symbolType: 'function',
            complexity: 5, // Below threshold
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(1);
      expect(report.summary.filesAnalyzed).toBe(1);
      expect(report.files['src/test.ts'].violations).toHaveLength(1);
      expect(report.files['src/test.ts'].violations[0].symbolName).toBe('complex');
      expect(report.files['src/test.ts'].violations[0].complexity).toBe(20);
    });

    it('should calculate correct severity based on multiplier', async () => {
      const chunks = [
        {
          content: 'function warning() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'warning',
            symbolType: 'function',
            complexity: 20, // Above threshold (15), warning level
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function error() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 12,
            endLine: 20,
            type: 'function',
            language: 'typescript',
            symbolName: 'error',
            symbolType: 'function',
            complexity: 32, // >= 2x threshold (30) = error
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.bySeverity.warning).toBe(1);
      expect(report.summary.bySeverity.error).toBe(1);
    });

    it('should filter by specific files when provided', async () => {
      const chunks = [
        {
          content: 'function test1() { }',
          metadata: {
            file: 'src/file1.ts',
            startLine: 1,
            endLine: 10,
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
            endLine: 10,
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

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze(['src/file1.ts']);

      expect(report.summary.filesAnalyzed).toBe(1);
      expect(report.files['src/file1.ts']).toBeDefined();
      expect(report.files['src/file2.ts']).toBeUndefined();
    });

    it('should handle empty results', async () => {
      vi.mocked(mockVectorDB.scanAll).mockResolvedValue([]);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
      expect(report.summary.filesAnalyzed).toBe(0);
      expect(report.summary.avgComplexity).toBe(0);
      expect(report.summary.maxComplexity).toBe(0);
    });

    it('should calculate correct summary statistics', async () => {
      const chunks = [
        {
          content: 'function a() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'a',
            symbolType: 'function',
            complexity: 5,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function b() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 6,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'b',
            symbolType: 'function',
            complexity: 15,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        {
          content: 'function c() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 11,
            endLine: 15,
            type: 'function',
            language: 'typescript',
            symbolName: 'c',
            symbolType: 'function',
            complexity: 10,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.avgComplexity).toBe(10); // (5 + 15 + 10) / 3 = 10
      expect(report.summary.maxComplexity).toBe(15);
    });

    it('should skip chunks without complexity data', async () => {
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
            // No complexity field
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
    });

    it('should calculate risk levels correctly', async () => {
      const chunks = [
        // File with no violations
        {
          content: 'function low() { }',
          metadata: {
            file: 'src/low.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'low',
            symbolType: 'function',
            complexity: 5,
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        // File with 1 warning (>= 15, < 30)
        {
          content: 'function medium() { }',
          metadata: {
            file: 'src/medium.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'medium',
            symbolType: 'function',
            complexity: 20, // Warning level (>= 15, < 30)
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
        // File with 1 error (>= 30)
        {
          content: 'function high() { }',
          metadata: {
            file: 'src/high.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'high',
            symbolType: 'function',
            complexity: 35, // Error level (>= 30)
          } as ChunkMetadata,
        score: 1.0,
        relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.files['src/low.ts'].riskLevel).toBe('low');
      expect(report.files['src/medium.ts'].riskLevel).toBe('low'); // Only 1 warning
      expect(report.files['src/high.ts'].riskLevel).toBe('high'); // Has error
    });
  });

  describe('cognitive complexity', () => {
    it('should detect cognitive complexity violations', async () => {
      const chunks = [
        {
          content: 'function complex() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'complex',
            symbolType: 'function',
            complexity: 5, // Below cyclomatic threshold
            cognitiveComplexity: 20, // Above cognitive threshold of 15
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(1);
      const violation = report.files['src/test.ts'].violations[0];
      expect(violation.metricType).toBe('cognitive');
      expect(violation.complexity).toBe(20);
      expect(violation.message).toContain('Mental load');
    });

    it('should detect both cyclomatic and cognitive violations for same function', async () => {
      const chunks = [
        {
          content: 'function veryComplex() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'veryComplex',
            symbolType: 'function',
            complexity: 20, // Above cyclomatic threshold of 15
            cognitiveComplexity: 18, // Above cognitive threshold of 15
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      // Should have 2 violations: one cyclomatic, one cognitive
      expect(report.summary.totalViolations).toBe(2);
      
      const violations = report.files['src/test.ts'].violations;
      expect(violations).toHaveLength(2);
      
      const cyclomaticViolation = violations.find(v => v.metricType === 'cyclomatic');
      const cognitiveViolation = violations.find(v => v.metricType === 'cognitive');
      
      expect(cyclomaticViolation).toBeDefined();
      expect(cyclomaticViolation!.complexity).toBe(20);
      expect(cyclomaticViolation!.message).toContain('test cases');
      
      expect(cognitiveViolation).toBeDefined();
      expect(cognitiveViolation!.complexity).toBe(18);
      expect(cognitiveViolation!.message).toContain('Mental load');
    });

    it('should not report cognitive violation when below threshold', async () => {
      const chunks = [
        {
          content: 'function moderate() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'moderate',
            symbolType: 'function',
            complexity: 5, // Below cyclomatic
            cognitiveComplexity: 10, // Below cognitive threshold of 15
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
    });

    it('should use custom cognitive threshold from config', async () => {
      const customConfig = {
        ...config,
        complexity: {
          ...config.complexity!,
          thresholds: { testPaths: 15, mentalLoad: 25 }, // Higher mental load threshold
        },
      };

      const chunks = [
        {
          content: 'function test() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'test',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 20, // Above default 15, but below custom 25
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, customConfig);
      const report = await analyzer.analyze();

      // No violation because 20 < 25
      expect(report.summary.totalViolations).toBe(0);
    });
  });

  describe('Halstead metrics violations', () => {
    it('should create halstead_effort violation when time to understand exceeds threshold', async () => {
      const chunks = [
        {
          content: 'function complexFunction() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 50,
            type: 'function',
            language: 'typescript',
            symbolName: 'complexFunction',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 5,
            halsteadEffort: 200000, // ~3h to understand (exceeds 60min default)
            halsteadVolume: 5000,
            halsteadDifficulty: 40,
            halsteadBugs: 1.0,
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(1);
      const violation = report.files['src/test.ts'].violations[0];
      expect(violation.metricType).toBe('halstead_effort');
      expect(violation.message).toContain('Time to understand');
      expect(violation.halsteadDetails).toBeDefined();
      expect(violation.halsteadDetails?.effort).toBe(200000);
    });

    it('should create halstead_bugs violation when estimated bugs exceeds threshold', async () => {
      const chunks = [
        {
          content: 'function buggyFunction() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 100,
            type: 'function',
            language: 'typescript',
            symbolName: 'buggyFunction',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 5,
            halsteadEffort: 50000, // Below effort threshold
            halsteadVolume: 6000,
            halsteadDifficulty: 50,
            halsteadBugs: 2.5, // Exceeds 1.5 default
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(1);
      const violation = report.files['src/test.ts'].violations[0];
      expect(violation.metricType).toBe('halstead_bugs');
      expect(violation.message).toContain('Estimated bugs');
      expect(violation.message).toContain('2.50');
      expect(violation.halsteadDetails).toBeDefined();
      expect(violation.halsteadDetails?.bugs).toBe(2.5);
    });

    it('should create multiple Halstead violations for same function', async () => {
      const chunks = [
        {
          content: 'function veryComplexFunction() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 200,
            type: 'function',
            language: 'typescript',
            symbolName: 'veryComplexFunction',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 5,
            halsteadEffort: 300000, // Exceeds 60min threshold (~4.6h)
            halsteadVolume: 9000,
            halsteadDifficulty: 60,
            halsteadBugs: 3.0, // Exceeds 1.5 threshold
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      // Should have both halstead_effort and halstead_bugs violations
      expect(report.summary.totalViolations).toBe(2);
      const violations = report.files['src/test.ts'].violations;
      const effortViolation = violations.find(v => v.metricType === 'halstead_effort');
      const bugsViolation = violations.find(v => v.metricType === 'halstead_bugs');
      
      expect(effortViolation).toBeDefined();
      expect(bugsViolation).toBeDefined();
    });

    it('should convert timeToUnderstandMinutes config to effort correctly', async () => {
      // Custom config with 30 minute threshold (instead of default 60)
      const customConfig = {
        ...config,
        complexity: {
          ...config.complexity!,
          thresholds: { 
            testPaths: 15, 
            mentalLoad: 15,
            timeToUnderstandMinutes: 30, // 30 minutes = 32400 effort
          },
        },
      };

      const chunks = [
        {
          content: 'function moderateFunction() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 30,
            type: 'function',
            language: 'typescript',
            symbolName: 'moderateFunction',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 5,
            halsteadEffort: 40000, // ~37 minutes - above 30min threshold
            halsteadVolume: 2000,
            halsteadDifficulty: 20,
            halsteadBugs: 0.5,
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, customConfig);
      const report = await analyzer.analyze();

      // Should trigger violation because 37min > 30min threshold
      expect(report.summary.totalViolations).toBe(1);
      expect(report.files['src/test.ts'].violations[0].metricType).toBe('halstead_effort');
    });

    it('should not create Halstead violations when below thresholds', async () => {
      const chunks = [
        {
          content: 'function simpleFunction() { }',
          metadata: {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'simpleFunction',
            symbolType: 'function',
            complexity: 5,
            cognitiveComplexity: 5,
            halsteadEffort: 30000, // ~28 minutes - below 60min threshold
            halsteadVolume: 1500,
            halsteadDifficulty: 15,
            halsteadBugs: 0.5, // Below 1.5 threshold
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      expect(report.summary.totalViolations).toBe(0);
    });
  });

  describe('dependency enrichment', () => {
    it('should enrich violations with dependency data', async () => {
      const chunks: SearchResult[] = [
        // File with violation
        {
          content: 'function complex() { }',
          metadata: {
            file: 'src/utils.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'complex',
            symbolType: 'function',
            complexity: 20, // Above threshold
            imports: [],
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        // Dependent file 1
        {
          content: 'import { complex } from "./utils";',
          metadata: {
            file: 'src/app.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            imports: ['src/utils.ts'],
            complexity: 15,
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        // Dependent file 2
        {
          content: 'import { complex } from "./utils";',
          metadata: {
            file: 'src/config.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            imports: ['src/utils.ts'],
            complexity: 8,
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      const fileData = report.files['src/utils.ts'];
      expect(fileData.violations).toHaveLength(1);
      expect(fileData.dependentCount).toBe(2);
      expect(fileData.dependents).toHaveLength(2);
      expect(fileData.dependents).toEqual(expect.arrayContaining(['src/app.ts', 'src/config.ts']));
      expect(fileData.dependentComplexityMetrics).toBeDefined();
      expect(fileData.dependentComplexityMetrics!.maxComplexity).toBe(15);
      expect(fileData.dependentComplexityMetrics!.averageComplexity).toBeCloseTo(11.5, 1); // (15 + 8) / 2
    });

    it('should boost risk level based on many dependents', async () => {
      const chunks: SearchResult[] = [
        // File with minor violation
        {
          content: 'function complex() { }',
          metadata: {
            file: 'src/utils.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbolName: 'complex',
            symbolType: 'function',
            complexity: 18, // Just slightly above threshold (15)
            imports: [],
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        // Many dependents
        ...Array.from({ length: 35 }, (_, i) => ({
          content: `import { complex } from "./utils";`,
          metadata: {
            file: `src/dep${i}.ts`,
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            imports: ['src/utils.ts'],
            complexity: 5,
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        })),
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      const fileData = report.files['src/utils.ts'];
      
      // Should be boosted to critical due to high dependent count (35 > 30)
      expect(fileData.dependentCount).toBe(35);
      expect(fileData.riskLevel).toBe('critical');
    });

    it('should not enrich files without violations', async () => {
      const chunks: SearchResult[] = [
        // File without violation
        {
          content: 'function simple() { }',
          metadata: {
            file: 'src/simple.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            language: 'typescript',
            symbolName: 'simple',
            symbolType: 'function',
            complexity: 5, // Below threshold
            imports: [],
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
        // Dependent file
        {
          content: 'import { simple } from "./simple";',
          metadata: {
            file: 'src/app.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            imports: ['src/simple.ts'],
          } as ChunkMetadata,
          score: 1.0,
          relevance: 'highly_relevant' as const,
        },
      ];

      vi.mocked(mockVectorDB.scanAll).mockResolvedValue(chunks);

      const analyzer = new ComplexityAnalyzer(mockVectorDB, config);
      const report = await analyzer.analyze();

      const fileData = report.files['src/simple.ts'];
      expect(fileData.violations).toHaveLength(0);
      expect(fileData.dependentCount).toBeUndefined(); // Should not be enriched
      expect(fileData.dependents).toHaveLength(0); // Empty array by default
    });
  });
});

