import { describe, it, expect } from 'vitest';

import { collectChangedFiles } from './changed-files.js';
import type { SignalContext } from './signal-context.js';

function ctx(overrides: Partial<SignalContext>): SignalContext {
  return {
    chunks: [],
    changedFiles: [],
    complexityReport: { summary: {}, files: {} } as SignalContext['complexityReport'],
    ...overrides,
  };
}

describe('collectChangedFiles', () => {
  it('unions all three sources', () => {
    const result = collectChangedFiles(
      ctx({
        changedFiles: ['src/a.ts'],
        allChangedFiles: ['README.md'],
        pr: { patches: new Map([['docs/b.md', '@@ -1 +1 @@']]) },
      }),
    );

    expect([...result].sort()).toEqual(['README.md', 'docs/b.md', 'src/a.ts']);
  });

  it('deduplicates a path present in more than one source', () => {
    const result = collectChangedFiles(
      ctx({
        changedFiles: ['src/a.ts'],
        allChangedFiles: ['src/a.ts'],
        pr: { patches: new Map([['src/a.ts', '']]) },
      }),
    );

    expect([...result]).toEqual(['src/a.ts']);
  });

  // Each source alone is an incomplete picture — that is the whole reason this
  // helper exists — so a caller must still get the others when one is absent.
  it('tolerates any single source being absent', () => {
    expect([...collectChangedFiles(ctx({ changedFiles: ['a.ts'] }))]).toEqual(['a.ts']);
    expect([...collectChangedFiles(ctx({ allChangedFiles: ['b.md'] }))]).toEqual(['b.md']);
    expect([...collectChangedFiles(ctx({ pr: { patches: new Map([['c.go', '']]) } }))]).toEqual([
      'c.go',
    ]);
  });

  it('returns empty when nothing changed', () => {
    expect(collectChangedFiles(ctx({})).size).toBe(0);
  });

  it('tolerates a pr with no patches at all', () => {
    expect(collectChangedFiles(ctx({ changedFiles: ['a.ts'], pr: {} })).size).toBe(1);
  });
});
