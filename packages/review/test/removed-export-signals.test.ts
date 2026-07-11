import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractRemovedExports,
  findSurvivingReferences,
  changesetMentions,
  computeRemovedExportContexts,
  renderRemovedExports,
  renderRemovedExportsSection,
  type RemovedExport,
  type RemovedExportContext,
} from '../src/removed-export-signals.js';
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
  };
}

function makeContext(opts: {
  patches?: Map<string, string>;
  repoChunks?: CodeChunk[];
}): ReviewContext {
  const pr = opts.patches ? { patches: opts.patches } : undefined;
  return { pr, repoChunks: opts.repoChunks } as unknown as ReviewContext;
}

function patch(...lines: string[]): string {
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// extractRemovedExports — declaration shapes
// ---------------------------------------------------------------------------

describe('extractRemovedExports', () => {
  it('extracts each removed export declaration shape', () => {
    const patches = new Map([
      [
        'src/a.ts',
        patch(
          '@@ -1,8 +1,0 @@',
          '-export function doThing() {}',
          '-export class Widget {}',
          '-export const CONFIG = 1;',
          '-export interface Options {}',
          '-export type Handler = () => void;',
          '-export enum Color { Red }',
        ),
      ],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toEqual(
      expect.arrayContaining(['doThing', 'Widget', 'CONFIG', 'Options', 'Handler', 'Color']),
    );
  });

  it('extracts a removed default export as `default (X)`', () => {
    const patches = new Map([
      ['src/a.ts', patch('@@ -1,1 +0,0 @@', '-export default function handler() {}')],
    ]);
    expect(extractRemovedExports(patches).map(r => r.symbol)).toContain('default (handler)');
  });

  it('extracts members of an inline `export { A, B } from` list', () => {
    const patches = new Map([
      ['src/index.ts', patch('@@ -1,1 +0,0 @@', "-export { Alpha, Beta } from './mod';")],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  });

  it('takes the public alias for `A as B` re-exports (incl. `default as X`)', () => {
    const patches = new Map([
      [
        'src/index.ts',
        patch(
          '@@ -1,1 +0,0 @@',
          "-export { internal as publicName, default as Thing } from './m';",
        ),
      ],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toContain('publicName');
    expect(symbols).toContain('Thing');
    expect(symbols).not.toContain('internal');
  });

  it('detects a single member removed from a surviving multi-line export list', () => {
    // The `export {` opener is only in the hunk-header section text; the sole
    // change is a bare `-  EmbeddingError,` member line (the PR #711 shape).
    const patches = new Map([
      [
        'packages/core/src/index.ts',
        patch(
          '@@ -182,7 +182,6 @@ export {',
          '   LienError,',
          '-  EmbeddingError,',
          '   IndexingError,',
        ),
      ],
    ]);
    expect(extractRemovedExports(patches).map(r => r.symbol)).toEqual(['EmbeddingError']);
  });

  it('detects one member dropped when the whole inline list is rewritten (- list vs + list)', () => {
    const patches = new Map([
      [
        'src/index.ts',
        patch(
          '@@ -1,1 +1,1 @@',
          '-export { Keep, Drop } from "./m";',
          '+export { Keep } from "./m";',
        ),
      ],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toContain('Drop');
    expect(symbols).not.toContain('Keep'); // survived on the `+` line
  });

  it('excludes a symbol re-added on a `+` export line anywhere (a moved export)', () => {
    const patches = new Map([
      ['src/old.ts', patch('@@ -1,1 +0,0 @@', "-export { Mover } from './impl';")],
      ['src/new.ts', patch('@@ -0,0 +1,1 @@', "+export { Mover } from './impl';")],
    ]);
    expect(extractRemovedExports(patches).map(r => r.symbol)).not.toContain('Mover');
  });

  it('extracts a removed Rust `pub fn` (and other pub items)', () => {
    const patches = new Map([
      [
        'src/parser.rs',
        patch(
          '@@ -1,3 +0,0 @@',
          '-pub fn parse_input(path: &str) -> Result<Parsed, Error> {',
          '-pub struct ParsedInput {}',
          '-pub enum Kind { A }',
        ),
      ],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['parse_input', 'ParsedInput', 'Kind']));
  });

  it('skips non-code files', () => {
    const patches = new Map([
      ['README.md', patch('@@ -1,1 +0,0 @@', '-export function fromDocs() {}')],
      ['package.json', patch('@@ -1,1 +0,0 @@', '-  "export": "value"')],
    ]);
    expect(extractRemovedExports(patches)).toEqual([]);
  });

  it('records the file a symbol was removed from and dedupes by symbol', () => {
    const patches = new Map([
      [
        'src/errors/index.ts',
        patch('@@ -1,1 +0,0 @@', '-export class EmbeddingError extends X {}'),
      ],
      ['src/index.ts', patch('@@ -1,3 +1,2 @@ export {', '   A,', '-  EmbeddingError,', '   B,')],
    ]);
    const removed = extractRemovedExports(patches);
    const embedding = removed.filter(r => r.symbol === 'EmbeddingError');
    expect(embedding).toHaveLength(1);
    expect(embedding[0].file).toBe('src/errors/index.ts'); // first occurrence
  });
  it('a } inside a trailing comment does not end a multi-line export list', () => {
    const patches = new Map([
      [
        'src/a.ts',
        patch(
          '@@ -1,5 +1,2 @@',
          ' export {',
          '-  Foo, // note: old }',
          '-  Bar,',
          ' } from "./m";',
        ),
      ],
    ]);
    const symbols = extractRemovedExports(patches).map(r => r.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['Foo', 'Bar']));
  });

  it('records a removed bulk re-export as a bulk entry (never swept)', () => {
    const patches = new Map([
      ['src/index.ts', patch('@@ -1,1 +1,0 @@', "-export * from './internal';")],
    ]);
    const removed = extractRemovedExports(patches);
    expect(removed).toHaveLength(1);
    expect(removed[0].symbol).toBe("* (all re-exports of './internal')");
    // The bulk entry must not produce a reference sweep.
    const refs = findSurvivingReferences(removed, [
      makeChunk('src/other.ts', 1, "export * from './elsewhere';"),
    ]);
    expect(refs.get(removed[0].symbol)).toBeUndefined();
  });

  it('treats a bare default list member as a default export, not a sweepable name', () => {
    const patches = new Map([
      ['src/index.ts', patch('@@ -1,1 +1,0 @@', "-export { default } from './widget';")],
    ]);
    const removed = extractRemovedExports(patches);
    expect(removed[0].symbol).toBe('default (default)');
    const refs = findSurvivingReferences(removed, [
      makeChunk('src/other.ts', 1, 'export default function x() {}'),
    ]);
    // No `\bdefault\b` sweep — every default keyword in the repo must NOT match.
    expect(refs.get(removed[0].symbol)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findSurvivingReferences
// ---------------------------------------------------------------------------

describe('findSurvivingReferences', () => {
  it('excludes same-file references by design (export removal ≠ definition removal)', () => {
    // `export { helper }` dropped while `function helper` stays for internal
    // use: same-file refs are legitimate; cross-file importers are the signal.
    const removed = [{ symbol: 'helper', file: 'src/a.ts' }];
    const refs = findSurvivingReferences(removed, [
      makeChunk('src/a.ts', 10, 'function helper() {}\nconst x = helper();'),
      makeChunk('src/b.ts', 3, "import { helper } from './a';"),
    ]);
    expect(refs.get('helper')?.map(r => r.file)).toEqual(['src/b.ts']);
  });
  const removed: RemovedExport[] = [{ symbol: 'parse_input', file: 'src/parser.rs' }];

  it('finds references in the head corpus outside the symbol’s own file', () => {
    const repoChunks = [
      makeChunk('src/main.rs', 200, 'let x = 1;\nlet input = parser::parse_input(path)?;'),
      makeChunk('src/reporter.rs', 40, 'let input = parser::parse_input(p)?;'),
    ];
    const refs = findSurvivingReferences(removed, repoChunks).get('parse_input') ?? [];
    expect(refs.map(r => `${r.file}:${r.line}`)).toEqual(['src/main.rs:201', 'src/reporter.rs:40']);
  });

  it('excludes the file the symbol was removed from', () => {
    const repoChunks = [
      makeChunk('src/parser.rs', 5, '// parse_input used to live here'),
      makeChunk('src/main.rs', 10, 'parser::parse_input(p);'),
    ];
    const refs = findSurvivingReferences(removed, repoChunks).get('parse_input') ?? [];
    expect(refs.every(r => r.file !== 'src/parser.rs')).toBe(true);
    expect(refs.map(r => r.file)).toContain('src/main.rs');
  });

  it('matches on word boundaries — parse_input must not match parse_inputs', () => {
    const repoChunks = [makeChunk('src/main.rs', 1, 'let y = parse_inputs(all);')];
    const refs = findSurvivingReferences(removed, repoChunks).get('parse_input') ?? [];
    expect(refs).toHaveLength(0);
  });

  it('caps references per symbol at 5, in traversal order', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      makeChunk(`src/c${i}.rs`, 1, 'parse_input(x);'),
    );
    const refs = findSurvivingReferences(removed, many).get('parse_input') ?? [];
    expect(refs).toHaveLength(5);
    expect(refs.map(r => r.file)).toEqual([
      'src/c0.rs',
      'src/c1.rs',
      'src/c2.rs',
      'src/c3.rs',
      'src/c4.rs',
    ]);
  });

  it('dedupes a physical line covered by overlapping chunks', () => {
    const repoChunks = [
      makeChunk('src/main.rs', 5, 'let a = 1;\nparse_input(x);'), // line 6
      makeChunk('src/main.rs', 6, 'parse_input(x);\nlet b = 2;'), // line 6 again
    ];
    const refs = findSurvivingReferences(removed, repoChunks).get('parse_input') ?? [];
    expect(refs.filter(r => r.line === 6)).toHaveLength(1);
  });

  it('skips default exports (no stable importable name)', () => {
    const refs = findSurvivingReferences(
      [{ symbol: 'default (handler)', file: 'src/a.ts' }],
      [makeChunk('src/b.ts', 1, 'handler();')],
    );
    expect(refs.size).toBe(0);
  });

  it('returns an empty map when there is no repo index', () => {
    expect(findSurvivingReferences(removed, undefined).size).toBe(0);
    expect(findSurvivingReferences(removed, []).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// changesetMentions
// ---------------------------------------------------------------------------

describe('changesetMentions', () => {
  it('detects a removed symbol mentioned on a `+` line of a changeset', () => {
    const removed: RemovedExport[] = [{ symbol: 'EmbeddingError', file: 'src/errors/index.ts' }];
    const patches = new Map([
      [
        '.changeset/remove-embedding-error.md',
        patch('@@ -0,0 +1,2 @@', '+Removed the unused `EmbeddingError` class and its error codes.'),
      ],
    ]);
    expect(changesetMentions(removed, patches).get('EmbeddingError')).toBe(
      '.changeset/remove-embedding-error.md',
    );
  });

  it('ignores mentions on non-added lines and outside .changeset', () => {
    const removed: RemovedExport[] = [{ symbol: 'Widget', file: 'src/a.ts' }];
    const patches = new Map([
      ['.changeset/x.md', patch('@@ -1,1 +0,0 @@', '-Removed Widget in a prior release.')],
      ['docs/notes.md', patch('@@ -0,0 +1,1 @@', '+Widget is documented here.')],
    ]);
    expect(changesetMentions(removed, patches).has('Widget')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe('renderRemovedExports', () => {
  it('returns "" for no contexts', () => {
    expect(renderRemovedExports([])).toBe('');
  });

  it('renders a block naming the symbol, its removal file, and surviving refs', () => {
    const contexts: RemovedExportContext[] = [
      {
        symbol: 'parse_input',
        file: 'src/parser.rs',
        survivingReferences: [
          { file: 'src/main.rs', line: 210 },
          { file: 'src/reporter.rs', line: 40 },
        ],
        changesetFile: null,
      },
    ];
    const md = renderRemovedExports(contexts);
    expect(md).toContain('<removed_exports>');
    expect(md).toContain('</removed_exports>');
    expect(md).toContain('parse_input (removed from src/parser.rs)');
    expect(md).toContain('2 surviving reference(s): src/main.rs:210, src/reporter.rs:40');
  });

  it('notes a changeset mention on a clean (0-reference) removal', () => {
    const md = renderRemovedExports([
      {
        symbol: 'EmbeddingError',
        file: 'src/errors/index.ts',
        survivingReferences: [],
        changesetFile: '.changeset/remove-embedding-error.md',
      },
    ]);
    expect(md).toContain('EmbeddingError');
    expect(md).toContain('0 surviving reference(s)');
    expect(md).toContain('described in changeset .changeset/remove-embedding-error.md');
  });

  it('names both rules’ verbs in the header (structural-analysis + boundary-change)', () => {
    const md = renderRemovedExports([
      { symbol: 'X', file: 'a.ts', survivingReferences: [], changesetFile: null },
    ]);
    expect(md).toContain('structural-analysis');
    expect(md).toContain('boundary-change');
  });

  it('caps at 15 entries with an explicit omission note', () => {
    const contexts: RemovedExportContext[] = Array.from({ length: 20 }, (_, i) => ({
      symbol: `Sym${i}`,
      file: 'src/a.ts',
      survivingReferences: [],
      changesetFile: null,
    }));
    const md = renderRemovedExports(contexts);
    expect(md).toContain('more removed export(s) omitted');
    // 5 omitted (20 - 15).
    expect(md).toContain('+5 more');
  });
});

// ---------------------------------------------------------------------------
// computeRemovedExportContexts — sorting
// ---------------------------------------------------------------------------

describe('computeRemovedExportContexts', () => {
  it('sorts surviving-reference entries first, then changeset-mentioned', () => {
    const patches = new Map([
      [
        'src/index.ts',
        patch(
          '@@ -1,3 +0,0 @@',
          '-export const Clean = 1;',
          '-export const Breaks = 2;',
          '-export const Documented = 3;',
        ),
      ],
      ['.changeset/x.md', patch('@@ -0,0 +1,1 @@', '+Removed `Documented`.')],
    ]);
    const repoChunks = [makeChunk('src/consumer.ts', 1, 'use(Breaks);')];
    const order = computeRemovedExportContexts(makeContext({ patches, repoChunks })).map(
      c => c.symbol,
    );
    expect(order[0]).toBe('Breaks'); // has a surviving reference
    expect(order[1]).toBe('Documented'); // changeset-mentioned
    expect(order[2]).toBe('Clean'); // neither
  });

  it('returns [] when there is no diff', () => {
    expect(computeRemovedExportContexts(makeContext({}))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderRemovedExportsSection + buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('renderRemovedExportsSection', () => {
  it('returns "" when the PR removes no exports', () => {
    const patches = new Map([
      ['src/a.ts', patch('@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;')],
    ]);
    expect(renderRemovedExportsSection(makeContext({ patches }))).toBe('');
  });
});

describe('buildInitialMessage injection', () => {
  it('includes the <removed_exports> block with surviving references', () => {
    const patches = new Map([
      ['src/parser.rs', patch('@@ -1,1 +0,0 @@', '-pub fn parse_input(p: &str) {}')],
    ]);
    const repoChunks = [makeChunk('src/main.rs', 210, 'parser::parse_input(p);')];
    const context = {
      ...makeContext({ patches, repoChunks }),
      changedFiles: ['src/parser.rs'],
      chunks: [],
    } as unknown as ReviewContext;

    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).toContain('<removed_exports>');
    expect(message).toContain('parse_input (removed from src/parser.rs)');
    expect(message).toContain('src/main.rs:210');
  });

  it('omits the block entirely when no exports were removed', () => {
    const patches = new Map([
      ['src/a.ts', patch('@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;')],
    ]);
    const context = {
      ...makeContext({ patches }),
      changedFiles: ['src/a.ts'],
      chunks: [],
    } as unknown as ReviewContext;
    expect(buildInitialMessage(context, { blastRadius: null })).not.toContain('<removed_exports>');
  });
});
