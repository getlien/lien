/**
 * Test harness for the review plugin architecture.
 *
 * Provides factory functions for creating valid test contexts and mock LLM clients
 * without network calls.
 */

import type { CodeChunk, ComplexityReport } from '@liendev/parser';
import type { ReviewContext, LLMClient, LLMResponse, LLMOptions } from './plugin-types.js';
import type { Logger } from './logger.js';

/**
 * A no-op logger for tests. Swallows all output.
 */
export const silentLogger: Logger = {
  info: () => {},
  warning: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Create a valid ReviewContext with sensible defaults.
 * Override any field via the overrides parameter.
 */
export function createTestContext(overrides?: Partial<ReviewContext>): ReviewContext {
  const defaultReport: ComplexityReport = {
    files: {},
    summary: {
      filesAnalyzed: 0,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 0,
      maxComplexity: 0,
    },
  };

  return {
    chunks: [],
    changedFiles: [],
    complexityReport: defaultReport,
    baselineReport: null,
    deltas: null,
    config: {},
    logger: silentLogger,
    ...overrides,
  };
}

/**
 * Create a mock LLM client that returns predefined responses.
 *
 * @param responses - Queue of responses to return. If exhausted, returns a default response.
 */
export function createMockLLMClient(
  responses: (string | LLMResponse)[] = [],
): LLMClient & { calls: Array<{ prompt: string; opts?: LLMOptions }> } {
  const queue = [...responses];
  const calls: Array<{ prompt: string; opts?: LLMOptions }> = [];

  const usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };

  return {
    calls,
    async complete(prompt: string, opts?: LLMOptions): Promise<LLMResponse> {
      calls.push({ prompt, opts });

      const next = queue.shift();
      if (!next) {
        return {
          content: '{}',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
        };
      }

      if (typeof next === 'string') {
        return {
          content: next,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.001 },
        };
      }

      if (next.usage) {
        usage.promptTokens += next.usage.promptTokens;
        usage.completionTokens += next.usage.completionTokens;
        usage.totalTokens += next.usage.totalTokens;
        usage.cost += next.usage.cost;
      }

      return next;
    },
    getUsage() {
      return { ...usage };
    },
  };
}

/**
 * Create a minimal CodeChunk for testing.
 */
export function createTestChunk(overrides?: Partial<CodeChunk>): CodeChunk {
  return {
    content: 'function test() { return true; }',
    metadata: {
      file: 'test.ts',
      startLine: 1,
      endLine: 1,
      type: 'function',
      symbolName: 'test',
      language: 'typescript',
      ...overrides?.metadata,
    },
    ...overrides,
  } as CodeChunk;
}

/**
 * Create a ComplexityReport with violations for testing.
 */
export function createTestReport(
  violations: Array<{
    filepath?: string;
    symbolName?: string;
    complexity?: number;
    threshold?: number;
    metricType?: string;
    severity?: 'error' | 'warning';
  }> = [],
): ComplexityReport {
  const files: ComplexityReport['files'] = {};

  for (const v of violations) {
    const filepath = v.filepath ?? 'test.ts';
    if (!files[filepath]) {
      files[filepath] = {
        violations: [],
        riskLevel: 'low',
        dependentCount: 0,
        dependents: [],
        testAssociations: [],
      } as ComplexityReport['files'][string];
    }
    files[filepath].violations.push({
      filepath,
      symbolName: v.symbolName ?? 'testFn',
      symbolType: 'function',
      startLine: 1,
      endLine: 10,
      complexity: v.complexity ?? 20,
      threshold: v.threshold ?? 15,
      metricType: v.metricType ?? 'cyclomatic',
      severity: v.severity ?? 'warning',
      language: 'typescript',
    } as ComplexityReport['files'][string]['violations'][number]);
  }

  const allViolations = Object.values(files).flatMap(f => f.violations);

  return {
    files,
    summary: {
      filesAnalyzed: Object.keys(files).length,
      totalViolations: allViolations.length,
      bySeverity: {
        error: allViolations.filter(v => v.severity === 'error').length,
        warning: allViolations.filter(v => v.severity === 'warning').length,
      },
      avgComplexity:
        allViolations.length > 0
          ? allViolations.reduce((sum, v) => sum + v.complexity, 0) / allViolations.length
          : 0,
      maxComplexity:
        allViolations.length > 0 ? Math.max(...allViolations.map(v => v.complexity)) : 0,
    },
  };
}
