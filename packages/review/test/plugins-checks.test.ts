import { describe, it, expect, vi } from 'vitest';
import { ComplexityPlugin } from '../src/plugins/complexity.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';
import type {
  ReviewFinding,
  PresentContext,
  ComplexityFindingMetadata,
} from '../src/plugin-types.js';

function createPresentContext(overrides?: Partial<PresentContext>): PresentContext {
  const report = createTestReport();
  return {
    complexityReport: report,
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
    addAnnotations: vi.fn(),
    ...overrides,
  };
}

function createComplexityFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'complexity',
    filepath: 'src/utils.ts',
    line: 10,
    endLine: 25,
    symbolName: 'processData',
    severity: 'warning',
    category: 'cyclomatic',
    message: 'This function has cyclomatic complexity of 20 (threshold: 15).',
    evidence: 'cyclomatic: 20 (threshold: 15)',
    metadata: {
      pluginType: 'complexity',
      metricType: 'cyclomatic',
      complexity: 20,
      threshold: 15,
      delta: null,
      symbolType: 'function',
    } satisfies ComplexityFindingMetadata,
    ...overrides,
  };
}

describe('ComplexityPlugin.present()', () => {
  it('ignores other plugins findings', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    const findings: ReviewFinding[] = [
      {
        pluginId: 'logic',
        filepath: 'a.ts',
        line: 1,
        severity: 'warning',
        category: 'logic',
        message: 'Logic issue',
      },
    ];

    await plugin.present!(findings, ctx);
    expect(postReviewComment).not.toHaveBeenCalled();
  });

  it('posts review comment with inline comments', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    const findings = [createComplexityFinding()];
    await plugin.present!(findings, ctx);

    expect(postReviewComment).toHaveBeenCalledTimes(1);
    const [summary, lineComments] = postReviewComment.mock.calls[0];
    expect(summary).toContain('Complexity Review');
    expect(lineComments).toHaveLength(1);
    expect(lineComments[0]).toEqual(
      expect.objectContaining({
        path: 'src/utils.ts',
        line: 25, // endLine
        start_line: 10,
      }),
    );
  });

  it('excludes marginal findings from inline comments', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    // Marginal: within 5% of threshold (complexity=15.5, threshold=15 → 3.3% over)
    const marginalFinding = createComplexityFinding({
      metadata: {
        pluginType: 'complexity',
        metricType: 'cyclomatic',
        complexity: 15.5,
        threshold: 15,
        delta: null,
        symbolType: 'function',
      } satisfies ComplexityFindingMetadata,
    });

    // Non-marginal: well over threshold
    const normalFinding = createComplexityFinding({
      symbolName: 'heavyFn',
      metadata: {
        pluginType: 'complexity',
        metricType: 'cyclomatic',
        complexity: 30,
        threshold: 15,
        delta: null,
        symbolType: 'function',
      } satisfies ComplexityFindingMetadata,
    });

    await plugin.present!([marginalFinding, normalFinding], ctx);

    // Only non-marginal should be inline comment
    const [, lineComments] = postReviewComment.mock.calls[0];
    expect(lineComments).toHaveLength(1);
    expect(lineComments[0].body).toContain('heavyFn');
  });

  it('no-ops when no complexity findings', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    await plugin.present!([], ctx);

    expect(postReviewComment).not.toHaveBeenCalled();
  });

  it('does not call postReviewComment when not available (CLI mode)', async () => {
    const plugin = new ComplexityPlugin();
    const ctx = createPresentContext({ postReviewComment: undefined });

    const findings = [createComplexityFinding()];

    // Should not throw
    await plugin.present!(findings, ctx);
  });

  it('does not post review when all findings are marginal', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    const marginalFinding = createComplexityFinding({
      metadata: {
        pluginType: 'complexity',
        metricType: 'cyclomatic',
        complexity: 15.5,
        threshold: 15,
        delta: null,
        symbolType: 'function',
      } satisfies ComplexityFindingMetadata,
    });

    await plugin.present!([marginalFinding], ctx);

    // No inline comments for marginal-only findings
    expect(postReviewComment).not.toHaveBeenCalled();
  });

  it('does not add annotations (uses review comments instead)', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations, postReviewComment: vi.fn() });

    await plugin.present!([createComplexityFinding()], ctx);

    expect(addAnnotations).not.toHaveBeenCalled();
  });

  it('inline comment body contains marker, severity, and metric info', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    await plugin.present!([createComplexityFinding()], ctx);

    const [, lineComments] = postReviewComment.mock.calls[0];
    const body: string = lineComments[0].body;
    expect(body).toContain('<!-- lien-review:');
    expect(body).toContain('processData');
    expect(body).toContain('🟡'); // warning emoji
  });

  it('uses endLine for inline comment line position', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    const findings = [createComplexityFinding({ line: 5, endLine: 30 })];
    await plugin.present!(findings, ctx);

    const [, lineComments] = postReviewComment.mock.calls[0];
    expect(lineComments[0].line).toBe(30);
    expect(lineComments[0].start_line).toBe(5);
  });

  it('falls back to line when endLine is missing', async () => {
    const plugin = new ComplexityPlugin();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ postReviewComment });

    const findings = [createComplexityFinding({ line: 5, endLine: undefined })];
    await plugin.present!(findings, ctx);

    const [, lineComments] = postReviewComment.mock.calls[0];
    expect(lineComments[0].line).toBe(5);
    expect(lineComments[0].start_line).toBe(5);
  });
});
