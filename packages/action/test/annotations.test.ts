import { describe, it, expect, vi, afterEach } from 'vitest';

import type { ReviewFinding } from '@liendev/review';

import { emitFindingAnnotations } from '../src/index.js';

/** Run `fn` while capturing everything written to process.stdout. */
function capture(fn: () => void): string {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write);
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return writes.join('');
}

const finding = (over: Partial<ReviewFinding>): ReviewFinding => ({
  pluginId: 'agent-review',
  filepath: 'src/foo.ts',
  line: 10,
  severity: 'warning',
  category: 'bug',
  message: 'something',
  ...over,
});

describe('emitFindingAnnotations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps severities to error/warning/notice workflow commands bound to file+line', () => {
    const out = capture(() =>
      emitFindingAnnotations([
        finding({ severity: 'error', filepath: 'a.ts', line: 1, category: 'cyclomatic' }),
        finding({ severity: 'warning', filepath: 'b.ts', line: 2 }),
        finding({ severity: 'info', filepath: 'c.ts', line: 3 }),
      ]),
    );
    expect(out).toContain('::error file=a.ts,line=1');
    expect(out).toContain('title=Lien Review (cyclomatic)');
    expect(out).toContain('::warning file=b.ts,line=2');
    expect(out).toContain('::notice file=c.ts,line=3');
  });

  it('includes endLine and appends the suggestion to the message', () => {
    const out = capture(() =>
      emitFindingAnnotations([
        finding({ line: 5, endLine: 9, message: 'msg', suggestion: 'fix it' }),
      ]),
    );
    expect(out).toContain('line=5,endLine=9');
    expect(out).toContain('fix it');
  });

  it('emits nothing for an empty findings list', () => {
    expect(capture(() => emitFindingAnnotations([]))).toBe('');
  });

  it('escapes `:` and `,` in filepath and title property values', () => {
    const out = capture(() =>
      emitFindingAnnotations([finding({ filepath: 'src/a,b:c.ts', category: 'bug:regression' })]),
    );
    expect(out).toContain('file=src/a%2Cb%3Ac.ts');
    expect(out).toContain('title=Lien Review (bug%3Aregression)');
  });
});
