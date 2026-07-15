import { describe, it, expect } from 'vitest';
import { buildComplexityStatus } from '../src/prompt.js';
import { createTestReport } from '../src/test-helpers.js';

describe('buildComplexityStatus', () => {
  it('says "in touched files" for a normal, PR-scoped report', () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
      { filepath: 'b.ts', symbolName: 'fnB', complexity: 25, threshold: 15 },
    ]);

    const status = buildComplexityStatus(report, null, null);
    expect(status).toContain('2 pre-existing issues in touched files');
    expect(status).not.toContain('repo-wide');
  });

  it('says "repo-wide" instead of "in touched files" when the report covers files beyond the PR (#572 fallback)', () => {
    const report = createTestReport([
      { filepath: 'unrelated/a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
      { filepath: 'unrelated/b.ts', symbolName: 'fnB', complexity: 25, threshold: 15 },
    ]);

    const status = buildComplexityStatus(report, null, null, true);
    expect(status).toContain('2 pre-existing issues repo-wide');
    expect(status).not.toContain('in touched files');
  });

  it('defaults to the "in touched files" wording when isRepoWide is omitted', () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
    ]);

    const status = buildComplexityStatus(report, null, null);
    expect(status).toContain('in touched files');
  });
});
