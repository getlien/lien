import { describe, it, expect } from 'vitest';
import { applyResponseBudget } from './response-budget.js';

/** The default budget used by applyResponseBudget when no maxChars is passed. */
const DEFAULT_BUDGET = 12_000;

/** Create a content string of approximately `chars` characters. */
function bigContent(chars: number): string {
  const line = 'const x = someFunctionCall(arg1, arg2, arg3);\n';
  const lines = Math.ceil(chars / line.length);
  return Array(lines).fill(line).join('');
}

/** Create a results-shaped response (search_code, list_functions, find_similar). */
function makeResultsResponse(count: number, contentSize: number) {
  return {
    indexInfo: { indexVersion: 1, indexDate: '2025-01-01' },
    results: Array.from({ length: count }, (_, i) => ({
      content: bigContent(contentSize),
      metadata: { file: `src/file-${i}.ts`, startLine: 1, endLine: 50, language: 'typescript' },
      score: 0.9 - i * 0.01,
      relevance: 'relevant',
    })),
  };
}

/** Create a get_files_context multi-file response. */
function makeFilesResponse(fileCount: number, chunksPerFile: number, contentSize: number) {
  const files = Object.fromEntries(
    Array.from({ length: fileCount }, (_, f) => [
      `src/file-${f}.ts`,
      {
        chunks: Array.from({ length: chunksPerFile }, (_, i) => ({
          content: bigContent(contentSize),
          metadata: { file: `src/file-${f}.ts`, startLine: i * 50, endLine: (i + 1) * 50 },
        })),
        testAssociations: [`src/__tests__/file-${f}.test.ts`],
      },
    ]),
  );
  return { indexInfo: { indexVersion: 1, indexDate: '2025-01-01' }, files };
}

/** Create a get_complexity violations response. */
function makeViolationsResponse(count: number, contentSize: number) {
  return {
    indexInfo: { indexVersion: 1, indexDate: '2025-01-01' },
    summary: { filesAnalyzed: count, avgComplexity: 20, maxComplexity: 50, violationCount: count },
    violations: Array.from({ length: count }, (_, i) => ({
      content: bigContent(contentSize),
      filepath: `src/file-${i}.ts`,
      symbolName: `complexFunc${i}`,
      complexity: 30 - i,
      metricType: 'cyclomatic',
      severity: 'error',
    })),
  };
}

describe('applyResponseBudget', () => {
  it('returns unchanged when under budget', () => {
    const input = { results: [{ content: 'small', metadata: {} }] };
    const { result, truncation } = applyResponseBudget(input);

    expect(result).toEqual(input);
    expect(truncation).toBeUndefined();
  });

  it('truncates content fields in Phase 1 for results[] shape', () => {
    const input = makeResultsResponse(10, 5000);
    expect(JSON.stringify(input).length).toBeGreaterThan(DEFAULT_BUDGET);

    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.phase).toBeGreaterThanOrEqual(1);
    expect(truncation!.originalItemCount).toBe(10);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_BUDGET);

    const res = result as typeof input;
    for (const r of res.results) {
      expect(r.content.length).toBeLessThan(5000);
    }
  });

  it('drops items in Phase 2 when Phase 1 is insufficient', () => {
    // Many items with moderate content
    const input = makeResultsResponse(50, 1000);
    expect(JSON.stringify(input).length).toBeGreaterThan(DEFAULT_BUDGET);

    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.originalItemCount).toBe(50);
    expect(truncation!.finalItemCount).toBeLessThan(50);
    expect(truncation!.message).toMatch(/^Showing \d+ results \(response-size cap;/);
    // Never claim "of 50" as if 50 were the true match total — it's just
    // the pre-trim array size this function was handed.
    expect(truncation!.message).not.toMatch(/\bof 50\b/);
    const res = result as typeof input;
    expect(res.results.length).toBeLessThan(50);
  });

  it('applies Phase 3 when Phase 1+2 are insufficient', () => {
    // Multiple items with large metadata so even after Phase 1 (10 lines) + Phase 2 (drop items),
    // the single remaining item with 10 lines of content + metadata still exceeds budget.
    const hugeMetadata = { file: 'big.ts', extra: 'x'.repeat(500) };
    const input = {
      results: [
        { content: bigContent(50000), metadata: hugeMetadata },
        { content: bigContent(50000), metadata: hugeMetadata },
      ],
    };
    // Budget so tight that 10 lines + metadata won't fit
    const { result, truncation } = applyResponseBudget(input, 800);

    expect(truncation).toBeDefined();
    expect(truncation!.phase).toBe(3);
    const res = result as typeof input;
    expect(res.results[0].content).toContain('... (truncated)');
  });

  it('handles get_files_context multi-file shape', () => {
    const input = makeFilesResponse(3, 20, 1000);
    expect(JSON.stringify(input).length).toBeGreaterThan(DEFAULT_BUDGET);

    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_BUDGET);
  });

  it('handles get_complexity violations[] shape', () => {
    const input = makeViolationsResponse(20, 2000);
    expect(JSON.stringify(input).length).toBeGreaterThan(DEFAULT_BUDGET);

    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(DEFAULT_BUDGET);
  });

  it('respects custom maxChars parameter', () => {
    const input = makeResultsResponse(5, 2000);
    const size = JSON.stringify(input).length;
    expect(size).toBeGreaterThan(5000);

    const { truncation } = applyResponseBudget(input, 5000);
    expect(truncation).toBeDefined();
  });

  it('does not mutate the original input', () => {
    const input = makeResultsResponse(10, 2000);
    const originalContent = input.results[0].content;

    applyResponseBudget(input);

    expect(input.results[0].content).toBe(originalContent);
    expect(input.results.length).toBe(10);
  });

  it('preserves note field when no truncation needed', () => {
    const input = { results: [{ content: 'small', metadata: {} }], note: 'existing note' };
    const { result } = applyResponseBudget(input);

    expect((result as any).note).toBe('existing note');
  });

  it('truncation info includes original and final sizes', () => {
    const input = makeResultsResponse(10, 5000);
    const { truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.originalChars).toBeGreaterThan(DEFAULT_BUDGET);
    expect(truncation!.finalChars).toBeLessThanOrEqual(DEFAULT_BUDGET);
    expect(truncation!.originalItemCount).toBe(10);
    expect(truncation!.finalItemCount).toBeGreaterThan(0);
    expect(truncation!.message).toMatch(/Narrow filters or lower limit/);
  });

  it('Phase 1 message says "content trimmed" when no items are dropped', () => {
    // 3 items with large content — Phase 1 truncation alone should fit
    const input = makeResultsResponse(3, 5000);
    expect(JSON.stringify(input).length).toBeGreaterThan(DEFAULT_BUDGET);

    const { truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.phase).toBe(1);
    expect(truncation!.originalItemCount).toBe(3);
    expect(truncation!.finalItemCount).toBe(3);
    expect(truncation!.message).toContain('content trimmed to fit');
  });

  it('Phase 2 message reports a drop count, never a fabricated total', () => {
    const input = makeResultsResponse(50, 1000);
    const { truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.finalItemCount).toBeLessThan(truncation!.originalItemCount);
    expect(truncation!.message).toMatch(/^Showing \d+ results \(response-size cap;/);
    expect(truncation!.message).toContain('not the underlying match count');
    expect(truncation!.message).not.toMatch(/\bof 50\b/);
  });

  it('forces hasMore to true when items are dropped, even if the tool had set it false', () => {
    const input = { ...makeResultsResponse(50, 1000), hasMore: false };
    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.finalItemCount).toBeLessThan(truncation!.originalItemCount);
    expect((result as { hasMore: boolean }).hasMore).toBe(true);
  });

  it('does not add a hasMore field where none existed', () => {
    const input = makeResultsResponse(50, 1000);
    const { result } = applyResponseBudget(input);

    expect(result as object).not.toHaveProperty('hasMore');
  });

  it('leaves hasMore untouched when only content is trimmed (no items dropped)', () => {
    const input = { ...makeResultsResponse(3, 5000), hasMore: false };
    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.finalItemCount).toBe(truncation!.originalItemCount);
    expect((result as { hasMore: boolean }).hasMore).toBe(false);
  });

  it('corrects nextOffset by the drop count so paging never skips dropped items', () => {
    // Regression: a pagination cursor computed upstream (offset + limit)
    // assumes the full pre-cut page was delivered. Found dogfooding
    // list_functions against sidekiq: a 50-item page collapsed to 23 by this
    // size cap still advised nextOffset:50 — skipping the 27 real items that
    // were fetched but silently dropped here. nextOffset must shrink by
    // exactly the drop count instead.
    const input = { ...makeResultsResponse(50, 1000), hasMore: true, nextOffset: 50 };
    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    const dropped = truncation!.originalItemCount - truncation!.finalItemCount;
    expect(dropped).toBeGreaterThan(0);
    const res = result as { nextOffset: number; results: unknown[] };
    expect(res.nextOffset).toBe(50 - dropped);
    // The corrected cursor must point exactly at the first item NOT shown.
    expect(res.nextOffset).toBe(res.results.length);
  });

  it('does not touch nextOffset when no items are dropped', () => {
    const input = { ...makeResultsResponse(3, 5000), hasMore: false, nextOffset: 3 };
    const { result, truncation } = applyResponseBudget(input);

    expect(truncation).toBeDefined();
    expect(truncation!.finalItemCount).toBe(truncation!.originalItemCount);
    expect((result as { nextOffset: number }).nextOffset).toBe(3);
  });

  it('does not add a nextOffset field where none existed', () => {
    const input = makeResultsResponse(50, 1000);
    const { result } = applyResponseBudget(input);

    expect(result as object).not.toHaveProperty('nextOffset');
  });

  it('returns unchanged for non-object results', () => {
    const out = applyResponseBudget('just a string');
    expect(out.result).toBe('just a string');
    expect(out.truncation).toBeUndefined();
  });

  it('returns unchanged when no content arrays found', () => {
    const input = { data: 'x'.repeat(50_000) };
    const out = applyResponseBudget(input);
    expect(out.truncation).toBeUndefined();
  });
});
