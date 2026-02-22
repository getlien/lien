import { describe, it, expect, vi } from 'vitest';
import { ComplexityPlugin } from '../src/plugins/complexity.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';
import type {
  ReviewFinding,
  PresentContext,
  CheckAnnotation,
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
  it('adds annotations for its findings', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    const findings = [createComplexityFinding()];
    await plugin.present!(findings, ctx);

    expect(addAnnotations).toHaveBeenCalledTimes(1);
    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual(
      expect.objectContaining({
        path: 'src/utils.ts',
        start_line: 10,
        end_line: 25,
        annotation_level: 'warning',
      }),
    );
  });

  it('maps error severity to failure annotation_level', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    const findings = [createComplexityFinding({ severity: 'error' })];
    await plugin.present!(findings, ctx);

    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations[0].annotation_level).toBe('failure');
  });

  it('maps info severity to notice annotation_level', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    const findings = [createComplexityFinding({ severity: 'info' })];
    await plugin.present!(findings, ctx);

    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations[0].annotation_level).toBe('notice');
  });

  it('ignores other plugins findings', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

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
    expect(addAnnotations).not.toHaveBeenCalled();
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
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ postReviewComment, addAnnotations });

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

    // Both should be annotations
    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations).toHaveLength(2);

    // Only non-marginal should be inline comment
    const [, lineComments] = postReviewComment.mock.calls[0];
    expect(lineComments).toHaveLength(1);
    expect(lineComments[0].body).toContain('heavyFn');
  });

  it('annotation title contains symbol name and metric info', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    await plugin.present!([createComplexityFinding()], ctx);

    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    const title = annotations[0].title!;
    expect(title).toContain('processData');
    expect(title).toContain('test paths'); // human-readable label for cyclomatic
  });

  it('no-ops when no complexity findings', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const postReviewComment = vi.fn();
    const ctx = createPresentContext({ addAnnotations, postReviewComment });

    await plugin.present!([], ctx);

    expect(addAnnotations).not.toHaveBeenCalled();
    expect(postReviewComment).not.toHaveBeenCalled();
  });

  it('does not call postReviewComment when not available', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    // postReviewComment is undefined (CLI mode)
    const ctx = createPresentContext({ addAnnotations, postReviewComment: undefined });

    const findings = [createComplexityFinding()];
    await plugin.present!(findings, ctx);

    // Annotations should still be added
    expect(addAnnotations).toHaveBeenCalledTimes(1);
  });

  it('uses endLine for annotation end_line', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    const findings = [createComplexityFinding({ line: 5, endLine: 30 })];
    await plugin.present!(findings, ctx);

    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations[0].start_line).toBe(5);
    expect(annotations[0].end_line).toBe(30);
  });

  it('falls back to line when endLine is missing', async () => {
    const plugin = new ComplexityPlugin();
    const addAnnotations = vi.fn();
    const ctx = createPresentContext({ addAnnotations });

    const findings = [createComplexityFinding({ line: 5, endLine: undefined })];
    await plugin.present!(findings, ctx);

    const annotations: CheckAnnotation[] = addAnnotations.mock.calls[0][0];
    expect(annotations[0].start_line).toBe(5);
    expect(annotations[0].end_line).toBe(5);
  });
});
