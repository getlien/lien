import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  inferSingleTokenSwap,
  detectRenameSweeps,
  classifyProseSwap,
  computeRenameSweepSignals,
  renderRenameSweepSignals,
  renderRenameSweepSection,
} from '../src/rename-sweep-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(file: string, startLine: number, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'function',
      language: 'typescript',
    },
  } as unknown as CodeChunk;
}

function ctx(opts: { patches?: Map<string, string>; repoChunks?: CodeChunk[] }): ReviewContext {
  const pr = opts.patches ? { patches: opts.patches } : undefined;
  return {
    pr,
    repoChunks: opts.repoChunks,
    changedFiles: opts.patches ? [...opts.patches.keys()] : [],
    chunks: [],
  } as unknown as ReviewContext;
}

/** A single modification hunk swapping `removed`/`added` line-pairs (git emits all `-` then all `+`). */
function hunk(startLine: number, pairs: Array<[string, string]>): string {
  const removed = pairs.map(([r]) => `-${r}`).join('\n');
  const added = pairs.map(([, a]) => `+${a}`).join('\n');
  return `@@ -${startLine},${pairs.length} +${startLine},${pairs.length} @@\n${removed}\n${added}`;
}

/** A code line that calls `name` — differs from the same line under another name by only that token. */
const call = (name: string, idx: number): string => `  results[${idx}] = ${name}(query);`;

/** A swap-pair for the code line above (old → new). */
const codeSwap = (from: string, to: string, idx: number): [string, string] => [
  call(from, idx),
  call(to, idx),
];

/**
 * The canonical sweep shape: mapping `from`→`to` on 5 lines across 3 files
 * (fileA:2, fileB:2, fileC:1) — meets MIN_OCCURRENCES(5) and MIN_FILES(3).
 */
function canonicalSweep(from = 'semantic_search', to = 'search_code'): Map<string, string> {
  return new Map([
    ['fileA.ts', hunk(1, [codeSwap(from, to, 0), codeSwap(from, to, 1)])],
    ['fileB.ts', hunk(1, [codeSwap(from, to, 0), codeSwap(from, to, 1)])],
    ['fileC.ts', hunk(1, [codeSwap(from, to, 0)])],
  ]);
}

// ---------------------------------------------------------------------------
// inferSingleTokenSwap
// ---------------------------------------------------------------------------

describe('inferSingleTokenSwap', () => {
  it('detects a clean single-token identifier swap', () => {
    expect(
      inferSingleTokenSwap('const r = semantic_search(q);', 'const r = search_code(q);'),
    ).toEqual({ from: 'semantic_search', to: 'search_code' });
  });

  it('detects a token swapped multiple times on one line (consistent mapping)', () => {
    expect(inferSingleTokenSwap('f(old_name, old_name)', 'f(new_name, new_name)')).toEqual({
      from: 'old_name',
      to: 'new_name',
    });
  });

  it('returns null when non-identifier glue also changed (e.g. a number)', () => {
    // semantic_search→search_code AND 1→2: not a pure rename.
    expect(inferSingleTokenSwap('a = semantic_search(1)', 'a = search_code(2)')).toBeNull();
  });

  it('returns null when two different mappings appear on one line', () => {
    expect(inferSingleTokenSwap('foo(alpha, beta)', 'foo(gamma, delta)')).toBeNull();
  });

  it('returns null for identical lines', () => {
    expect(inferSingleTokenSwap('const x = 1;', 'const x = 1;')).toBeNull();
  });

  it('treats an added suffix as a token swap (semantic_search → semantic_search_v2)', () => {
    // The whole `[A-Za-z0-9_]+` run is one token, so this is a legitimate rename;
    // the word-boundary guarantee lives in the survivor scan (see below).
    expect(inferSingleTokenSwap('call(semantic_search)', 'call(semantic_search_v2)')).toEqual({
      from: 'semantic_search',
      to: 'semantic_search_v2',
    });
  });
});

// ---------------------------------------------------------------------------
// detectRenameSweeps — threshold, multi-mapping, keyword/short filters, cap
// ---------------------------------------------------------------------------

describe('detectRenameSweeps', () => {
  it('detects a clean sweep meeting the occurrence/file threshold', () => {
    const mappings = detectRenameSweeps(canonicalSweep());
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toEqual({
      from: 'semantic_search',
      to: 'search_code',
      occurrenceCount: 5,
      fileCount: 3,
    });
  });

  it('does NOT detect below the occurrence threshold (4 occurrences)', () => {
    const patches = new Map([
      ['a.ts', hunk(1, [codeSwap('semantic_search', 'search_code', 0)])],
      ['b.ts', hunk(1, [codeSwap('semantic_search', 'search_code', 0)])],
      [
        'c.ts',
        hunk(1, [
          codeSwap('semantic_search', 'search_code', 0),
          codeSwap('semantic_search', 'search_code', 1),
        ]),
      ],
    ]);
    expect(detectRenameSweeps(patches)).toEqual([]);
  });

  it('does NOT detect below the file threshold (5 occurrences, 2 files)', () => {
    const patches = new Map([
      [
        'a.ts',
        hunk(1, [
          codeSwap('semantic_search', 'search_code', 0),
          codeSwap('semantic_search', 'search_code', 1),
          codeSwap('semantic_search', 'search_code', 2),
        ]),
      ],
      [
        'b.ts',
        hunk(1, [
          codeSwap('semantic_search', 'search_code', 0),
          codeSwap('semantic_search', 'search_code', 1),
        ]),
      ],
    ]);
    expect(detectRenameSweeps(patches)).toEqual([]);
  });

  it('detects multiple concurrent mappings, most-repeated first', () => {
    const patches = new Map<string, string>();
    // mapping 1: get_deps→get_dependents, 6 occurrences across 3 files
    patches.set(
      'a.ts',
      hunk(1, [
        codeSwap('get_deps', 'get_dependents', 0),
        codeSwap('get_deps', 'get_dependents', 1),
      ]),
    );
    patches.set(
      'b.ts',
      hunk(1, [
        codeSwap('get_deps', 'get_dependents', 0),
        codeSwap('get_deps', 'get_dependents', 1),
      ]),
    );
    patches.set(
      'c.ts',
      hunk(1, [
        codeSwap('get_deps', 'get_dependents', 0),
        codeSwap('get_deps', 'get_dependents', 1),
      ]),
    );
    // mapping 2: semantic_search→search_code, 5 occurrences across 3 files
    patches.set(
      'd.ts',
      hunk(1, [
        codeSwap('semantic_search', 'search_code', 0),
        codeSwap('semantic_search', 'search_code', 1),
      ]),
    );
    patches.set(
      'e.ts',
      hunk(1, [
        codeSwap('semantic_search', 'search_code', 0),
        codeSwap('semantic_search', 'search_code', 1),
      ]),
    );
    patches.set('f.ts', hunk(1, [codeSwap('semantic_search', 'search_code', 0)]));

    const mappings = detectRenameSweeps(patches);
    expect(mappings).toHaveLength(2);
    expect(mappings[0].from).toBe('get_deps'); // 6 > 5, sorted first
    expect(mappings[0].occurrenceCount).toBe(6);
    expect(mappings[1].from).toBe('semantic_search');
  });

  it('drops keyword renames (let → const codemod carries no claims)', () => {
    const line = (kw: string): string => `  ${kw} counter = compute();`;
    const patches = new Map([
      ['a.ts', hunk(1, [[line('let'), line('const')]])],
      ['b.ts', hunk(1, [[line('let'), line('const')]])],
      [
        'c.ts',
        hunk(1, [
          [line('let'), line('const')],
          [line('let'), line('const')],
        ]),
      ],
      ['d.ts', hunk(1, [[line('let'), line('const')]])],
    ] as Array<[string, string]>);
    expect(detectRenameSweeps(patches)).toEqual([]);
  });

  it('drops too-short identifier renames', () => {
    const patches = new Map([
      ['a.ts', hunk(1, [['x = ab(1)', 'x = cd(1)']])],
      ['b.ts', hunk(1, [['x = ab(1)', 'x = cd(1)']])],
      [
        'c.ts',
        hunk(1, [
          ['x = ab(1)', 'x = cd(1)'],
          ['y = ab(2)', 'y = cd(2)'],
        ]),
      ],
      ['d.ts', hunk(1, [['x = ab(1)', 'x = cd(1)']])],
    ] as Array<[string, string]>);
    expect(detectRenameSweeps(patches)).toEqual([]);
  });

  it('caps the number of reported mappings at 5', () => {
    const patches = new Map<string, string>();
    for (let k = 0; k < 7; k++) {
      const from = `oldSymbolName${k}`;
      const to = `newSymbolName${k}`;
      patches.set(`m${k}a.ts`, hunk(1, [codeSwap(from, to, 0), codeSwap(from, to, 1)]));
      patches.set(`m${k}b.ts`, hunk(1, [codeSwap(from, to, 0), codeSwap(from, to, 1)]));
      patches.set(`m${k}c.ts`, hunk(1, [codeSwap(from, to, 0)]));
    }
    expect(detectRenameSweeps(patches)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// classifyProseSwap — comment / block-comment / docstring / string / markdown
// ---------------------------------------------------------------------------

describe('classifyProseSwap', () => {
  it('classifies a line comment', () => {
    expect(classifyProseSwap('// uses search_code now', 'search_code', 'a.ts')).toBe('comment');
  });

  it('classifies a block-comment continuation line', () => {
    expect(classifyProseSwap(' * search_code returns the top hits', 'search_code', 'a.ts')).toBe(
      'comment',
    );
  });

  it('classifies a trailing comment on a code line', () => {
    expect(
      classifyProseSwap(
        'const x = compute(); // search_code is the new name',
        'search_code',
        'a.ts',
      ),
    ).toBe('comment');
  });

  it('classifies a Python docstring (triple-quoted)', () => {
    expect(
      classifyProseSwap('    """Runs search_code over the index."""', 'search_code', 'engine.py'),
    ).toBe('docstring');
  });

  it('classifies a string literal', () => {
    expect(classifyProseSwap("  const t = 'search_code is enabled';", 'search_code', 'a.ts')).toBe(
      'string',
    );
  });

  it('classifies every line of a markdown/prose file as doc', () => {
    expect(
      classifyProseSwap('Use search_code for lexical search.', 'search_code', 'guide.md'),
    ).toBe('doc');
  });

  it('returns null for live code (not prose)', () => {
    expect(classifyProseSwap('  return search_code(query);', 'search_code', 'a.ts')).toBeNull();
  });

  it('does not mistake a # inside a string for a trailing comment', () => {
    // The `#fff` marker is inside the string span; the swap is in live code → null.
    expect(
      classifyProseSwap("  const c = '#fff'; foo(search_code);", 'search_code', 'a.ts'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRenameSweepSignals — prose-touched, survivors, word-boundary, drop-clean
// ---------------------------------------------------------------------------

describe('computeRenameSweepSignals', () => {
  it('returns [] when there is no diff', () => {
    expect(computeRenameSweepSignals(ctx({}))).toEqual([]);
  });

  it('returns [] when a sweep is clean (no prose touched, no survivor)', () => {
    // canonicalSweep touches only live-code call sites and leaves no old-name behind.
    expect(computeRenameSweepSignals(ctx({ patches: canonicalSweep() }))).toEqual([]);
  });

  it('emits a prose-touched line when the swap lands in a comment', () => {
    const patches = canonicalSweep();
    // Replace fileC with a hunk whose swap is inside a doc comment.
    patches.set(
      'schema.ts',
      '@@ -10,1 +10,1 @@\n' +
        '-// semantic_search reports as disabled without embeddings\n' +
        '+// search_code reports as disabled without embeddings',
    );
    const signals = computeRenameSweepSignals(ctx({ patches }));
    expect(signals).toHaveLength(1);
    const prose = signals[0].proseTouched;
    expect(prose).toContainEqual({
      file: 'schema.ts',
      line: 10,
      kind: 'comment',
      sentence: '// search_code reports as disabled without embeddings',
    });
  });

  it('emits a post-image survivor (old name left on a context line of a changed file)', () => {
    const patches = canonicalSweep();
    patches.set(
      'legacy.ts',
      '@@ -5,3 +5,3 @@\n' +
        '   // NOTE: semantic_search is still referenced here\n' +
        '-  a = semantic_search(0);\n' +
        '+  a = search_code(0);',
    );
    const signals = computeRenameSweepSignals(ctx({ patches }));
    const survivors = signals[0].survivors;
    expect(survivors).toContainEqual({
      file: 'legacy.ts',
      line: 5,
      snippet: '// NOTE: semantic_search is still referenced here',
      repoWide: false,
    });
  });

  it('emits a repo-wide survivor in an untouched file, skipping changed files', () => {
    const patches = canonicalSweep();
    const repoChunks = [
      // untouched file — the sweep forgot this reference
      makeChunk('other.ts', 40, 'export function old() {\n  return semantic_search(x);\n}'),
      // a changed file: must NOT be re-scanned repo-wide (owned by the diff post-image)
      makeChunk('fileA.ts', 100, '  legacy = semantic_search(z);'),
    ];
    const signals = computeRenameSweepSignals(ctx({ patches, repoChunks }));
    const survivors = signals[0].survivors;
    expect(survivors).toContainEqual({
      file: 'other.ts',
      line: 41,
      snippet: 'return semantic_search(x);',
      repoWide: true,
    });
    // fileA.ts is a changed file — never reported via the repo-wide source.
    expect(survivors.some(s => s.file === 'fileA.ts')).toBe(false);
  });

  it('respects word boundaries: semantic_search does not match semantic_search_v2', () => {
    const patches = canonicalSweep();
    const repoChunks = [
      makeChunk('other.ts', 1, 'const a = semantic_search_v2(x);\nconst b = semantic_search(y);'),
    ];
    const signals = computeRenameSweepSignals(ctx({ patches, repoChunks }));
    const survivors = signals[0].survivors;
    // line 2 (exact token) is a survivor; line 1 (semantic_search_v2) is NOT.
    expect(survivors.some(s => s.file === 'other.ts' && s.line === 2)).toBe(true);
    expect(survivors.some(s => s.file === 'other.ts' && s.line === 1)).toBe(false);
  });

  it('caps survivors per mapping and reports the overflow count', () => {
    const patches = canonicalSweep();
    // 15 surviving references in an untouched file → capped at 12, overflow 3.
    const content = Array.from({ length: 15 }, (_, i) => `  ref${i} = semantic_search(${i});`).join(
      '\n',
    );
    const repoChunks = [makeChunk('survivors.ts', 1, content)];
    const signals = computeRenameSweepSignals(ctx({ patches, repoChunks }));
    expect(signals[0].survivors).toHaveLength(12);
    expect(signals[0].survivorOverflow).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('renderRenameSweepSignals', () => {
  it('returns "" for no signals', () => {
    expect(renderRenameSweepSignals([])).toBe('');
  });

  it('renders the block with the mapping, prose-touched, and survivor lines', () => {
    const md = renderRenameSweepSignals([
      {
        mapping: { from: 'semantic_search', to: 'search_code', occurrenceCount: 40, fileCount: 12 },
        proseTouched: [
          {
            file: 'schema.ts',
            line: 10,
            kind: 'comment',
            sentence: '// search_code reports as disabled without embeddings',
          },
        ],
        proseOverflow: 0,
        survivors: [
          { file: 'other.ts', line: 41, snippet: 'return semantic_search(x);', repoWide: true },
        ],
        survivorOverflow: 0,
      },
    ]);
    expect(md).toContain('<rename_sweep>');
    expect(md).toContain('</rename_sweep>');
    expect(md).toContain('`semantic_search` → `search_code`');
    expect(md).toContain('40 occurrences across 12 files');
    expect(md).toContain('schema.ts:10 (comment)');
    expect(md).toContain('other.ts:41 (untouched file)');
  });

  it('notes overflow instead of dropping silently', () => {
    const md = renderRenameSweepSignals([
      {
        mapping: { from: 'a_symbol', to: 'b_symbol', occurrenceCount: 5, fileCount: 3 },
        proseTouched: [],
        proseOverflow: 0,
        survivors: [{ file: 'x.ts', line: 1, snippet: 'a_symbol', repoWide: true }],
        survivorOverflow: 7,
      },
    ]);
    expect(md).toContain('[+7 more surviving reference(s)');
  });
});

describe('renderRenameSweepSection', () => {
  it('returns "" when there is no diff', () => {
    expect(renderRenameSweepSection(ctx({}))).toBe('');
  });

  // Synthetic mini-#658: the exact failure CodeRabbit caught and Lien Review missed.
  it('surfaces the #658 schema.ts stale-claim comment with file:line and the sentence', () => {
    const patches = canonicalSweep();
    patches.set(
      'packages/core/src/config/schema.ts',
      '@@ -12,1 +12,1 @@\n' +
        '-  // When embeddings are off, semantic_search reports as disabled.\n' +
        '+  // When embeddings are off, search_code reports as disabled.',
    );
    const section = renderRenameSweepSection(ctx({ patches }));
    expect(section).toContain('<rename_sweep>');
    expect(section).toContain('packages/core/src/config/schema.ts:12');
    expect(section).toContain('When embeddings are off, search_code reports as disabled.');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('buildInitialMessage rename-sweep injection', () => {
  it('includes the <rename_sweep> block when a sweep touches prose', () => {
    const patches = canonicalSweep();
    patches.set(
      'docs.md',
      '@@ -1,1 +1,1 @@\n-Use semantic_search for retrieval.\n+Use search_code for retrieval.',
    );
    const message = buildInitialMessage(ctx({ patches }), { blastRadius: null });
    expect(message).toContain('<rename_sweep>');
    expect(message).toContain('docs.md:1 (doc)');
  });

  it('omits the block when there is no rename sweep', () => {
    const patches = new Map([['a.ts', '@@ -1,1 +1,2 @@\n const x = 1;\n+const y = x + 1;']]);
    const message = buildInitialMessage(ctx({ patches }), { blastRadius: null });
    expect(message).not.toContain('<rename_sweep>');
  });
});
