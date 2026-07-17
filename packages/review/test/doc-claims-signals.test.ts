import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractAnchors,
  extractCitedPath,
  extractDocClaims,
  extractCommentProse,
  addedCodeCommentLines,
  findClaimEvidence,
  attachEvidence,
  renderDocClaims,
  renderDocClaimsSection,
  type DocClaim,
  type DocClaimCitedPath,
  type DocClaimEvidence,
} from '../src/doc-claims-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

function ctxWithPatches(patches?: Map<string, string>): ReviewContext {
  return {
    pr: patches ? { patches } : undefined,
    changedFiles: patches ? [...patches.keys()] : [],
    chunks: [],
  } as unknown as ReviewContext;
}

/** Build a synthetic repo chunk for evidence-lookup tests. */
function chunk(
  file: string,
  startLine: number,
  content: string,
  extra: Partial<CodeChunk['metadata']> = {},
): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'block',
      language: 'typescript',
      ...extra,
    },
  } as CodeChunk;
}

/** A DocClaim with the given text (shape is irrelevant to evidence lookup). */
function claimOf(claimText: string, file = DOC): DocClaim {
  return { file, claimText, shape: 'mechanism' };
}

/** A DocClaim carrying an explicit citedPath (see extractCitedPath), for evidence tests. */
function claimWithCitedPath(claimText: string, citedPath: DocClaimCitedPath, file = DOC): DocClaim {
  return { file, claimText, shape: 'mechanism', citedPath };
}

/** Build a one-hunk patch adding the given lines to a file. */
function added(...lines: string[]): string {
  const body = lines.map(l => `+${l}`).join('\n');
  return `@@ -1,1 +1,${lines.length + 1} @@\n # context\n${body}`;
}

// A guidance/doc surface (matches isGuidanceSurface) for each shape.
const DOC = 'docs/architecture/thing.md';

// ---------------------------------------------------------------------------
// extractDocClaims — per shape
// ---------------------------------------------------------------------------

describe('extractDocClaims — claim shapes', () => {
  function shapeOf(line: string, file = DOC): DocClaim | undefined {
    return extractDocClaims(new Map([[file, added(line)]]))[0];
  }

  it('mechanism: a search mechanism named lexical/semantic', () => {
    const c = shapeOf(
      '`search_code` is now lexical BM25 keyword search, not meaning-based matching.',
    );
    expect(c).toMatchObject({ file: DOC, shape: 'mechanism' });
  });

  it('mechanism requires a nearby search-domain word (no bare "lexical")', () => {
    // "lexical scope" is a language concept, not a search-mechanism claim.
    expect(shapeOf('Variables follow lexical scope inside the closure.')).toBeUndefined();
  });

  it('state: "reports as disabled"', () => {
    expect(shapeOf('When the index is empty, search reports as disabled.')?.shape).toBe('state');
  });

  it('state: "disabled when …"', () => {
    expect(shapeOf('The feature is disabled when embeddings are absent.')?.shape).toBe('state');
  });

  it('default: "defaults to N"', () => {
    expect(shapeOf('The chunk batch size defaults to 32.')?.shape).toBe('default');
  });

  it('scope-gate: existence gate paired with a fallback consequence (pr667 shape)', () => {
    const c = shapeOf(
      'It has an index (`structural.db` exists). If either fails we fall back to standalone.',
    );
    expect(c?.shape).toBe('scope-gate');
  });

  it('scope-unchanged: "are otherwise unchanged" (pr711 shape)', () => {
    expect(
      shapeOf('LienErrorCode and the public error exports are otherwise unchanged.')?.shape,
    ).toBe('scope-unchanged');
  });

  it('scope-unchanged does NOT match a bare status-word fragment', () => {
    // "unchanged" as a lone descriptor (no linking verb) is not a scope claim.
    expect(shapeOf('An unchanged file resolves from the base.')).toBeUndefined();
  });

  it('requirement: "… required" (pr716 shape)', () => {
    expect(shapeOf('No compiler or build toolchain required on supported platforms.')?.shape).toBe(
      'requirement',
    );
  });

  it('negation: a software-subject "do not <verb>" (pr687 shape)', () => {
    expect(
      shapeOf('Configs that name a retired backend do not crash: Lien warns once.')?.shape,
    ).toBe('negation');
  });

  it('does NOT trigger on a bare developer imperative ("never run …")', () => {
    // Bare modal imperatives are guidance to humans, not falsifiable code claims.
    expect(shapeOf('Never run a plain `npm install` in the worktree.')).toBeUndefined();
  });

  it('does NOT trigger on plain descriptive prose', () => {
    expect(shapeOf('This section explains the overall design of the overlay.')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractDocClaims — surface scoping, fences, tables, removed lines
// ---------------------------------------------------------------------------

describe('extractDocClaims — scoping and filtering', () => {
  it('only scans guidance/doc surfaces, not analyzable source', () => {
    const patch = added('The parser is disabled when the flag is off.');
    // Same claim line in a .ts source file must NOT be extracted here.
    expect(extractDocClaims(new Map([['packages/core/src/thing.ts', patch]]))).toHaveLength(0);
    // But in a doc surface it is.
    expect(extractDocClaims(new Map([[DOC, patch]]))).toHaveLength(1);
  });

  it('skips claim-shaped lines inside fenced code blocks', () => {
    const patch =
      '@@ -1,1 +1,4 @@\n' +
      ' # Doc\n' +
      '+```ts\n' +
      '+const cfg = load(); // defaults to 32, required, disabled when empty\n' +
      '+```';
    expect(extractDocClaims(new Map([[DOC, patch]]))).toHaveLength(0);
  });

  it('skips Markdown table rows', () => {
    const patch = added('| disabled when empty | yes |');
    expect(extractDocClaims(new Map([[DOC, patch]]))).toHaveLength(0);
  });

  it('ignores claim-shaped removed ("-") lines — only added prose counts', () => {
    const patch =
      '@@ -1,2 +1,1 @@\n' +
      '-The feature is disabled when embeddings are absent.\n' +
      '+The feature runs.';
    expect(extractDocClaims(new Map([[DOC, patch]]))).toHaveLength(0);
  });

  it('dedupes identical claim lines across files', () => {
    const line = 'The batch size defaults to 32.';
    const claims = extractDocClaims(
      new Map([
        [DOC, added(line)],
        ['.changeset/x.md', added(line)],
      ]),
    );
    expect(claims).toHaveLength(1);
  });

  it('caps a claim line at ~200 chars with an ellipsis', () => {
    const long = `The batch size defaults to 32 ${'x'.repeat(400)}`;
    const c = extractDocClaims(new Map([[DOC, added(long)]]))[0];
    expect(c.claimText.length).toBeLessThanOrEqual(202);
    expect(c.claimText.endsWith('…')).toBe(true);
  });

  it('ignores claim-shaped words inside markdown link targets', () => {
    // PR #687's Note: the ADR link slug contains "lexical-search", which
    // false-classified the line as `mechanism` and stole the excerpt center
    // from the real claim ("do not crash") later in the sentence.
    const note = `> **Note:** backend removed (see [ADR-011](decisions/0011-sqlite-structural-store-fts5-lexical-search.md)). ${'y'.repeat(200)} configs that name a retired backend do not crash: Lien warns once.`;
    const c = extractDocClaims(new Map([[DOC, added(note)]]))[0];
    expect(c.shape).toBe('negation');
    expect(c.claimText).toContain('do not crash');
  });

  it('centers a capped excerpt on the matched phrase, not the line head', () => {
    // The PR #687 shape: a one-line blockquote Note whose falsifiable phrase
    // ("do not crash") sits hundreds of chars in. Head-truncation would cut
    // exactly the words the reviewer must verify.
    const long = `> **Note:** ${'y'.repeat(300)} existing configs that name a retired backend do not crash: Lien warns once ${'z'.repeat(100)}`;
    const c = extractDocClaims(new Map([[DOC, added(long)]]))[0];
    expect(c.claimText).toContain('do not crash');
    expect(c.claimText.startsWith('…')).toBe(true);
    expect(c.claimText.length).toBeLessThanOrEqual(202);
  });
});

// ---------------------------------------------------------------------------
// renderDocClaims
// ---------------------------------------------------------------------------

describe('renderDocClaims', () => {
  it('returns "" for no claims', () => {
    expect(renderDocClaims([])).toBe('');
  });

  it('renders a <doc_claims> block naming doc-truth and listing file: "claim"', () => {
    const md = renderDocClaims([
      { file: DOC, claimText: 'search reports as disabled', shape: 'state' },
    ]);
    expect(md).toContain('<doc_claims>');
    expect(md).toContain('</doc_claims>');
    expect(md).toContain('doc-truth');
    expect(md).toContain(`- ${DOC}: "search reports as disabled"`);
  });

  it('caps at 20 entries and notes the overflow rather than dropping silently', () => {
    const many: DocClaim[] = Array.from({ length: 25 }, (_, i) => ({
      file: DOC,
      claimText: `claim number ${i}`,
      shape: 'requirement' as const,
    }));
    const md = renderDocClaims(many);
    expect(md).toContain('[+5 more claim(s) omitted');
    // 20 rendered claim lines + the overflow note
    expect(md.match(/^- docs\//gm)).toHaveLength(20);
  });
});

describe('renderDocClaimsSection', () => {
  it('returns "" when there is no diff', () => {
    expect(renderDocClaimsSection(ctxWithPatches())).toBe('');
  });

  it('renders the block from context patches', () => {
    const section = renderDocClaimsSection(
      ctxWithPatches(new Map([[DOC, added('The batch size defaults to 32.')]])),
    );
    expect(section).toContain('<doc_claims>');
    expect(section).toContain('The batch size defaults to 32.');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('buildInitialMessage doc-claims injection', () => {
  it('includes the <doc_claims> block when a guidance surface has a claim', () => {
    const ctx = ctxWithPatches(new Map([[DOC, added('The batch size defaults to 32.')]]));
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).toContain('<doc_claims>');
    expect(message).toContain('The batch size defaults to 32.');
  });

  it('omits the block when no guidance surface carries a claim', () => {
    const ctx = ctxWithPatches(
      new Map([['packages/core/src/thing.ts', added('const y = x + 1;')]]),
    );
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).not.toContain('<doc_claims>');
  });
});

// ---------------------------------------------------------------------------
// extractAnchors
// ---------------------------------------------------------------------------

describe('extractAnchors', () => {
  it('extracts a dotted/starred config key', () => {
    expect(extractAnchors('the `embeddings.*` keys still load')).toContain('embeddings.*');
    expect(extractAnchors('requires a `structural.db` file')).toContain('structural.db');
    expect(extractAnchors('bump `core.embeddingBatchSize` to 64')).toContain(
      'core.embeddingBatchSize',
    );
  });

  it('extracts camelCase and PascalCase identifiers', () => {
    const a = extractAnchors('resolveIndexStrategy returns an OverlayBackend when linked');
    expect(a).toContain('resolveIndexStrategy');
    expect(a).toContain('OverlayBackend');
  });

  it('extracts snake_case / SCREAMING_SNAKE identifiers', () => {
    const a = extractAnchors('the `search_code` tool honors LIEN_WORKTREE_STANDALONE');
    expect(a).toContain('search_code');
    expect(a).toContain('LIEN_WORKTREE_STANDALONE');
  });

  it('mines plain words only from backtick spans, not free prose', () => {
    // `lancedb`/`qdrant` inside backticks are anchors …
    const a = extractAnchors('a retired backend (`backend: "lancedb"` / `"qdrant"`)');
    expect(a).toContain('lancedb');
    expect(a).toContain('qdrant');
    // … but the same word bare in prose is NOT (kept off generic vocabulary).
    expect(extractAnchors('the backend was retired and removed')).not.toContain('backend');
  });

  it('filters noise: sub-4-char tokens, pure numbers, stop words', () => {
    // `db` is too short; `32` is a number; `true`/`when` are stop words.
    const a = extractAnchors('set `db` to `32` when `true`');
    expect(a).not.toContain('db');
    expect(a).not.toContain('32');
    expect(a).not.toContain('true');
    expect(a).not.toContain('when');
  });

  it('returns [] for prose with no code-ish tokens', () => {
    expect(extractAnchors('This section explains the overall design of the overlay.')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractCitedPath (#749)
// ---------------------------------------------------------------------------

describe('extractCitedPath', () => {
  it('extracts a backtick-quoted path plus an adjacent backtick symbol', () => {
    const cp = extractCitedPath(
      'currently `moonshotai/kimi-k2.7-code`; see `packages/review/src/defaults.ts` for `DEFAULT_REVIEW_MODEL`, the source of truth.',
    );
    expect(cp?.path).toBe('packages/review/src/defaults.ts');
    expect(cp?.symbol).toBe('DEFAULT_REVIEW_MODEL');
  });

  it('parses a markdown-link citation whose display text is the path', () => {
    const cp = extractCitedPath(
      'see [packages/review/src/defaults.ts](../../packages/review/src/defaults.ts) for the source of truth',
    );
    expect(cp?.path).toBe('packages/review/src/defaults.ts');
  });

  it('does not treat a bare word without an extension/path shape as a citedPath', () => {
    expect(extractCitedPath('see defaults for the source of truth')).toBeUndefined();
  });

  it('returns the path with no symbol when no adjacent backticked identifier is present', () => {
    const cp = extractCitedPath('the default lives in packages/review/src/defaults.ts today');
    expect(cp).toEqual({ path: 'packages/review/src/defaults.ts' });
  });

  it('does not mistake the backtick-quoted path token itself for the adjacent symbol', () => {
    const cp = extractCitedPath('see `packages/review/src/defaults.ts` for details');
    expect(cp?.symbol).toBeUndefined();
  });

  it('skips a non-identifier-shaped backtick span (e.g. a model name) when looking for the adjacent symbol', () => {
    const cp = extractCitedPath(
      'model is `moonshotai/kimi-k2.7-code`; source: `packages/review/src/defaults.ts`',
    );
    expect(cp?.symbol).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractDocClaims — citedPath wiring (#749)
// ---------------------------------------------------------------------------

describe('extractDocClaims — citedPath wiring', () => {
  it('records the citedPath (and adjacent symbol) extracted from a real claim line', () => {
    const line =
      'The review model defaults to `moonshotai/kimi-k2.7-code`; see `packages/review/src/defaults.ts` for `DEFAULT_REVIEW_MODEL`, the source of truth.';
    const c = extractDocClaims(new Map([[DOC, added(line)]]))[0];
    expect(c.citedPath).toEqual({
      path: 'packages/review/src/defaults.ts',
      symbol: 'DEFAULT_REVIEW_MODEL',
    });
  });

  it('leaves citedPath unset for a claim with no file citation', () => {
    const c = extractDocClaims(new Map([[DOC, added('The batch size defaults to 32.')]]))[0];
    expect(c.citedPath).toBeUndefined();
  });

  it('extracts a citation that the claim-excerpt window truncates away', () => {
    // Regression pin from replaying against PR #748: the claim phrase sits
    // early in a long line, the citation sits past MAX_CLAIM_CHARS, so the
    // match-centered excerpt excludes it — extraction must run on the FULL
    // line, not the windowed claimText.
    const filler = 'and the surrounding prose keeps going with more descriptive detail '.repeat(4);
    const line = `The pass defaults to on ${filler}— see \`packages/review/src/defaults.ts\` for \`DEFAULT_REVIEW_MODEL\`, the source of truth.`;
    const c = extractDocClaims(new Map([[DOC, added(line)]]))[0];
    expect(c.claimText).not.toContain('defaults.ts'); // window really cut it
    expect(c.citedPath).toEqual({
      path: 'packages/review/src/defaults.ts',
      symbol: 'DEFAULT_REVIEW_MODEL',
    });
  });
});

// ---------------------------------------------------------------------------
// findClaimEvidence — ranking
// ---------------------------------------------------------------------------

describe('findClaimEvidence — ranking', () => {
  const CODE = 'packages/core/src/overlay-resolution.ts';
  const OTHER_DOC = 'docs/architecture/other.md';

  it('prefers a changed code file over a changed doc for the same anchor', () => {
    const claim = claimOf('the `structuralStore` is the only backend');
    const chunks = [
      chunk(OTHER_DOC, 10, 'mentions structuralStore in prose'),
      chunk(CODE, 20, 'export const structuralStore = makeStore();'),
    ];
    const changed = new Set([CODE, OTHER_DOC]);
    const ev = findClaimEvidence(claim, chunks, changed);
    expect(ev?.file).toBe(CODE);
  });

  it('prefers a changed sibling doc over a NON-changed code file (omission shape)', () => {
    const claim = claimOf('a retired backend (`backend: "lancedb"`) does not crash');
    const chunks = [
      chunk('packages/core/src/legacy.ts', 5, 'const lancedb = null; // non-changed code'),
      chunk(OTHER_DOC, 40, 'ADR: lancedb and embeddings.* keys still load, warn once'),
    ];
    const changed = new Set([OTHER_DOC]); // only the sibling doc is part of this PR
    const ev = findClaimEvidence(claim, chunks, changed);
    expect(ev?.file).toBe(OTHER_DOC);
    expect(ev?.fromDoc).toBe(true);
  });

  it('prefers an exact symbolName match over a plain content match', () => {
    const claim = claimOf('`resolveIndexStrategy` gates overlay mode');
    const chunks = [
      chunk(CODE, 8, 'a comment mentioning resolveIndexStrategy in passing'),
      chunk('packages/core/src/strategy.ts', 84, 'export function resolveIndexStrategy() {}', {
        symbolName: 'resolveIndexStrategy',
        type: 'function',
      }),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set([CODE])); // symbol chunk file NOT changed
    expect(ev?.file).toBe('packages/core/src/strategy.ts');
  });

  it('ranks a test-file match below a non-changed doc match', () => {
    const claim = claimOf('the `overlayMask` suppresses base rows');
    const chunks = [
      chunk('packages/core/src/x.test.ts', 3, 'expect(overlayMask).toBe(true)'),
      chunk('docs/notes.md', 12, 'overlayMask is the per-file suppression set'),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set());
    expect(ev?.file).toBe('docs/notes.md');
  });

  it('ranks a test file last even on an exact symbolName match (deliberate)', () => {
    // A same-named helper defined in a test fixture is a collision, not the
    // described behavior — the test-file demotion wins over SymbolMatch.
    const claim = claimOf('`resolveIndexStrategy` gates overlay mode');
    const chunks = [
      chunk('packages/core/test/strategy.test.ts', 5, 'function resolveIndexStrategy() {}', {
        symbolName: 'resolveIndexStrategy',
        type: 'function',
      }),
      chunk('packages/core/src/strategy.ts', 84, 'calls resolveIndexStrategy() at startup'),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set());
    expect(ev?.file).toBe('packages/core/src/strategy.ts');
  });

  it('never cites the claim’s own file as its evidence', () => {
    const claim = claimOf('`structural.db` exists', DOC);
    const chunks = [chunk(DOC, 2, 'the doc itself mentions structural.db here')];
    expect(findClaimEvidence(claim, chunks, new Set([DOC]))).toBeUndefined();
  });

  it('falls back to a case-insensitive match when nothing matches verbatim', () => {
    const claim = claimOf('the `OverlayBackend` merges rows');
    const chunks = [chunk('packages/core/src/x.ts', 1, 'class overlaybackend {}')];
    const ev = findClaimEvidence(claim, chunks, new Set());
    expect(ev?.file).toBe('packages/core/src/x.ts');
  });

  it('returns undefined when the claim has no anchors or there is no index', () => {
    expect(
      findClaimEvidence(
        claimOf('purely descriptive prose here'),
        [chunk('a.ts', 1, 'x')],
        new Set(),
      ),
    ).toBeUndefined();
    expect(
      findClaimEvidence(claimOf('`structural.db` exists'), undefined, new Set()),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findClaimEvidence — excerpt windowing
// ---------------------------------------------------------------------------

describe('findClaimEvidence — excerpt', () => {
  it('centers the window on the line carrying the MOST anchors, not the first', () => {
    // `SqliteBackend` appears alone up top; the load-bearing cluster
    // (`lancedb` + `qdrant`) sits lower — the excerpt must land on the cluster.
    const content = [
      'line0: SqliteBackend is the store', // 1 anchor
      'line1: filler',
      'line2: filler',
      'line3: filler',
      'line4: retired `lancedb`/`qdrant` keys still load', // 2 anchors
      'line5: filler',
    ].join('\n');
    const claim = claimOf('`SqliteBackend`, `lancedb`, and `qdrant` behavior');
    const chunks = [chunk('docs/adr.md', 100, content)];
    const ev = findClaimEvidence(claim, chunks, new Set(['docs/adr.md']))!;
    expect(ev.excerpt).toContain('lancedb');
    expect(ev.excerpt).toContain('qdrant');
    expect(ev.excerpt).not.toContain('line0'); // not centered on the lone top anchor
    expect(ev.startLine).toBe(102); // 100 + (line4 index 4 - 2 lines of lead-in)
  });

  it('caps the excerpt near MAX_EVIDENCE_CHARS with ellipses', () => {
    const long = `prefix ${'x'.repeat(300)} structuralStore ${'y'.repeat(300)} suffix`;
    const ev = findClaimEvidence(
      claimOf('`structuralStore` here'),
      [chunk('a.ts', 1, long)],
      new Set(),
    )!;
    expect(ev.excerpt.length).toBeLessThanOrEqual(402);
    expect(ev.excerpt).toContain('structuralStore');
    expect(ev.excerpt.startsWith('…')).toBe(true);
  });

  it('defangs triple backticks so they cannot break the render fence', () => {
    const ev = findClaimEvidence(
      claimOf('`sampleFn` example'),
      [chunk('a.ts', 1, 'before\n```ts\nsampleFn()\n```\nafter')],
      new Set(),
    )!;
    expect(ev.excerpt).not.toContain('```');
    expect(ev.excerpt).toContain("'''");
  });
});

// ---------------------------------------------------------------------------
// findClaimEvidence — citedPath (#749)
// ---------------------------------------------------------------------------

describe('findClaimEvidence — citedPath', () => {
  const CODE = 'packages/review/src/defaults.ts';

  it("ranks the cited file's symbol chunk first, bypassing decoys in other files entirely", () => {
    const claim = claimWithCitedPath(
      'currently `moonshotai/kimi-k2.7-code`; see `packages/review/src/defaults.ts` for `DEFAULT_REVIEW_MODEL`, the source of truth.',
      { path: CODE, symbol: 'DEFAULT_REVIEW_MODEL' },
    );
    const chunks = [
      // A decoy in a different file mentioning the same symbol/keywords.
      chunk(
        'packages/review/src/other.ts',
        1,
        'DEFAULT_REVIEW_MODEL mentioned here too, moonshotai/kimi-k2.7-code',
      ),
      chunk(CODE, 1, 'export const OTHER_CONST = 1;'),
      chunk(CODE, 12, 'export const DEFAULT_REVIEW_MODEL = "moonshotai/kimi-k2.7-code";', {
        symbolName: 'DEFAULT_REVIEW_MODEL',
        type: 'const',
      }),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set())!;
    expect(ev.file).toBe(CODE);
    expect(ev.startLine).toBe(12);
    expect(ev.excerpt).toContain('DEFAULT_REVIEW_MODEL');
  });

  it("falls back to the cited file's best keyword-overlap chunk when no symbol was captured", () => {
    const claim = claimWithCitedPath(
      'the `packages/review/src/defaults.ts` module exports `modelList` among other config',
      { path: CODE },
    );
    const chunks = [
      chunk(CODE, 1, 'export const UNRELATED = 1;'),
      chunk(CODE, 20, 'export const modelList = ["a", "b"];'),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set())!;
    expect(ev.file).toBe(CODE);
    expect(ev.startLine).toBe(20);
  });

  it('attaches a one-line "not found" note — not a fenced excerpt — when the cited path does not resolve', () => {
    const claim = claimWithCitedPath('see `packages/review/src/ghost.ts` for details', {
      path: 'packages/review/src/ghost.ts',
    });
    const chunks = [chunk(CODE, 1, 'export const DEFAULT_REVIEW_MODEL = 1;')];
    const ev = findClaimEvidence(claim, chunks, new Set())!;
    expect(ev.citedPathMissing).toBe(true);
    expect(ev.file).toBe('packages/review/src/ghost.ts');

    const md = renderDocClaims([{ ...claim, evidence: ev }]);
    expect(md).toContain('was not found in the index');
    expect(md).not.toContain('```'); // a one-line note, not a fenced block
  });

  it('takes priority over the generic anchor/tier scan even when a changed file would otherwise win', () => {
    const claim = claimWithCitedPath(
      'the `structuralStore` lives in `packages/core/src/store.ts`',
      {
        path: 'packages/core/src/store.ts',
      },
    );
    const chunks = [
      chunk('packages/core/src/changed.ts', 1, 'export const structuralStore = 1;'),
      chunk('packages/core/src/store.ts', 5, 'export const structuralStore = makeStore();'),
    ];
    // changed.ts is CHANGED and would win the generic tier scan — the citation
    // must still resolve to the cited file, not the changed decoy.
    const changed = new Set(['packages/core/src/changed.ts']);
    const ev = findClaimEvidence(claim, chunks, changed)!;
    expect(ev.file).toBe('packages/core/src/store.ts');
  });
});

// ---------------------------------------------------------------------------
// attachEvidence + render integration
// ---------------------------------------------------------------------------

describe('attachEvidence and renderer', () => {
  it('attaches located evidence and renders it as a fenced excerpt', () => {
    const ctx = {
      changedFiles: ['packages/core/src/store.ts'],
      chunks: [],
      repoChunks: [chunk('packages/core/src/store.ts', 42, 'export const structuralStore = 1;')],
      pr: { patches: new Map() },
    } as unknown as ReviewContext;
    const claims = attachEvidence([claimOf('the `structuralStore` is the default')], ctx);
    expect(claims[0].evidence?.file).toBe('packages/core/src/store.ts');

    const md = renderDocClaims(claims);
    expect(md).toContain('evidence — packages/core/src/store.ts:42:');
    expect(md).toContain('structuralStore');
  });

  it('labels sibling-doc evidence and shows the no-evidence hint otherwise', () => {
    const withDoc: DocClaim = {
      file: DOC,
      claimText: 'omission claim',
      shape: 'negation',
      evidence: {
        file: 'docs/adr.md',
        startLine: 5,
        excerpt: 'the fuller enumeration',
        anchor: 'x',
        fromDoc: true,
      } satisfies DocClaimEvidence,
    };
    const md = renderDocClaims([withDoc, claimOf('unlocatable claim')]);
    expect(md).toContain('evidence (sibling doc) — docs/adr.md:5:');
    expect(md).toContain('none located');
  });

  it('drops per-entry evidence (never a claim) once the block budget is hit', () => {
    // 20 claims each carrying a ~400-char excerpt overflows the 8k block cap,
    // so later entries must swap the excerpt for the omission note while every
    // claim header still renders.
    const big = 'Z'.repeat(400);
    const claims: DocClaim[] = Array.from({ length: 20 }, (_, i) => ({
      file: DOC,
      claimText: `claim ${i}`,
      shape: 'requirement' as const,
      evidence: {
        file: `code/f${i}.ts`,
        startLine: i + 1,
        excerpt: big,
        anchor: 'a',
        fromDoc: false,
      },
    }));
    const md = renderDocClaims(claims);
    expect(md.match(/^- docs\//gm)).toHaveLength(20); // all claims survive
    expect(md).toContain('evidence located but omitted to respect the input budget');
  });
});

// ---------------------------------------------------------------------------
// extractCommentProse — code-file comment/docstring/description-literal shapes
// ---------------------------------------------------------------------------

describe('extractCommentProse', () => {
  it("extracts a JSDoc/block-comment continuation line (pr658 Finding A's exact shape)", () => {
    expect(
      extractCommentProse('     * keep working; search_code and find_similar report as disabled.'),
    ).toBe('keep working; search_code and find_similar report as disabled.');
  });

  it('extracts a // line comment', () => {
    expect(extractCommentProse('// The batch size defaults to 32.')).toBe(
      'The batch size defaults to 32.',
    );
  });

  it('extracts a # line comment (Python/Ruby style)', () => {
    expect(extractCommentProse('# The batch size defaults to 32.')).toBe(
      'The batch size defaults to 32.',
    );
  });

  it('extracts a Rust /// doc-comment', () => {
    expect(extractCommentProse('/// The batch size defaults to 32.')).toBe(
      'The batch size defaults to 32.',
    );
  });

  // Regression (Lien Review finding on this PR, #814): a same-line block-comment/triple-quote
  // CLOSER must not leak into the captured prose.
  it('strips the same-line closer off a single-line block comment (`/** ... */`)', () => {
    expect(extractCommentProse('/** Defaults to true. */')).toBe('Defaults to true.');
    expect(extractCommentProse('/* Defaults to true. */')).toBe('Defaults to true.');
  });

  it('still captures a block-comment opener with no closer on this line (multi-line JSDoc)', () => {
    expect(extractCommentProse('/** Defaults to true')).toBe('Defaults to true');
  });

  it('strips the same-line closer off a single-line triple-quoted docstring', () => {
    expect(extractCommentProse('"""Required."""')).toBe('Required.');
    expect(extractCommentProse("'''Required.'''")).toBe('Required.');
  });

  it('still captures a triple-quote opener with no closer on this line (multi-line docstring)', () => {
    expect(extractCommentProse('"""Required.')).toBe('Required.');
  });

  // Regression (Lien Review finding on this PR): a closer with an EXTRA star (`**/`, as opposed
  // to the plain `*/`) must be stripped in full, not leave a stray trailing `*` behind.
  it('strips a doubled-star closer (`**/`) in full, leaving no stray star', () => {
    expect(extractCommentProse('/** Defaults to true. **/')).toBe('Defaults to true.');
    expect(extractCommentProse('/* Defaults to true. **/')).toBe('Defaults to true.');
  });

  it('extracts a .describe(...) call — the config-schema-description shape', () => {
    expect(extractCommentProse(".describe('Defaults to 20 when omitted.'),")).toBe(
      'Defaults to 20 when omitted.',
    );
  });

  // Regression (CodeRabbit finding on this PR): an escaped quote inside the description string
  // must not be mistaken for the closing delimiter.
  it('does not truncate a .describe(...) string at an escaped quote', () => {
    expect(extractCommentProse(".describe('User\\'s mode defaults to safe.'),")).toBe(
      "User\\'s mode defaults to safe.",
    );
  });

  it('extracts a description: "..." object-literal key', () => {
    expect(extractCommentProse('description: "Required when scope is set to file.",')).toBe(
      'Required when scope is set to file.',
    );
  });

  it('does not extract a shebang line', () => {
    expect(extractCommentProse('#!/usr/bin/env node')).toBeUndefined();
  });

  it('does not extract a preprocessor directive or region marker', () => {
    expect(extractCommentProse('#include <stdio.h>')).toBeUndefined();
    expect(extractCommentProse('#region Constants')).toBeUndefined();
  });

  it('does not extract a plain code line with no comment/description shape', () => {
    expect(extractCommentProse('const s = "search reports as disabled";')).toBeUndefined();
  });

  it('excludes a TODO comment even when it reads as claim-shaped', () => {
    expect(extractCommentProse('// TODO: this should default to 32 eventually')).toBeUndefined();
  });

  it('excludes an attribution line', () => {
    expect(extractCommentProse('// Copyright 2026, required for all files.')).toBeUndefined();
  });

  it('excludes a doc-comment tag line even when claim-shaped', () => {
    expect(extractCommentProse('// @param batchSize - defaults to 32')).toBeUndefined();
  });

  it('returns undefined for an empty/whitespace-only line', () => {
    expect(extractCommentProse('   ')).toBeUndefined();
  });
});

describe('addedCodeCommentLines', () => {
  it('collects only ADDED comment-shaped lines from a patch, ignoring code and trailing comments', () => {
    const patch = [
      '@@ -1,3 +1,5 @@',
      ' export function f() {',
      '+  // The batch size defaults to 32.',
      '+  return UNIQUE_MARKER; // trailing comment is not extracted',
      '+}',
    ].join('\n');
    expect(addedCodeCommentLines(patch)).toEqual(['The batch size defaults to 32.']);
  });
});

// ---------------------------------------------------------------------------
// extractDocClaims — widened to changed CODE files (pr658 Finding A)
// ---------------------------------------------------------------------------

describe('extractDocClaims — widened to changed CODE files', () => {
  const SCHEMA_FILE = 'packages/core/src/config/schema.ts';
  const SEARCH_SCHEMA_FILE = 'packages/cli/src/mcp/schemas/search.schema.ts';

  it('ACCEPTANCE: extracts the exact pr658 Finding A claim from a JSDoc comment in a changed CODE file', () => {
    // The real added line from PR #658's schema.ts hunk: the rename to `search_code` was
    // textually correct but left the underlying "reports as disabled" claim stale (#657 made
    // search_code lexical, not embedding-gated) — see this module's header and the pr658 fixture.
    const patch = added('     * keep working; search_code and find_similar report as disabled.');
    const claims = extractDocClaims(new Map([[SCHEMA_FILE, patch]]));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      file: SCHEMA_FILE,
      shape: 'state',
      claimText: 'keep working; search_code and find_similar report as disabled.',
    });
  });

  it('still ignores an ordinary (non-comment) code line even when claim-shaped', () => {
    const patch = added('  const s = "search reports as disabled";');
    expect(extractDocClaims(new Map([[SCHEMA_FILE, patch]]))).toHaveLength(0);
  });

  it('extracts a .describe(...) claim from a zod schema file (the description-literal shape)', () => {
    const patch = added("    .describe('Defaults to 20 when omitted.'),");
    const claims = extractDocClaims(new Map([[SEARCH_SCHEMA_FILE, patch]]));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ file: SEARCH_SCHEMA_FILE, shape: 'default' });
  });

  it('extracts a citedPath from a code-comment claim (bridges into referenced-file prefetch)', () => {
    const patch = added('// This flag defaults to on in .github/workflows/lien-review.yml.');
    const claims = extractDocClaims(new Map([['packages/action/src/index.ts', patch]]));
    expect(claims).toHaveLength(1);
    expect(claims[0].citedPath).toEqual({ path: '.github/workflows/lien-review.yml' });
  });

  it('does NOT extract from a guidance surface via the code-file path (no double-scan)', () => {
    // A .md guidance surface is scanned via addedProseLines already; confirm the widening doesn't
    // also run the code-comment scan over it (which would be redundant, not wrong, but the
    // dedupe-by-claimText would hide a double-scan bug for a claim whose PROSE line doesn't look
    // like a comment at all — e.g. a bare markdown line never matches `extractCommentProse`).
    const patch = added('The batch size defaults to 32.');
    const claims = extractDocClaims(new Map([[DOC, patch]]));
    expect(claims).toHaveLength(1);
  });

  it('negatives end-to-end: TODO / attribution / section-header / plain-code-string lines produce no claims', () => {
    const patch = added(
      '// TODO: should default to 32 eventually',
      '// Copyright 2026, required for all files.',
      '// ---- Configuration ----',
      'const s = "search reports as disabled";',
    );
    expect(extractDocClaims(new Map([[SCHEMA_FILE, patch]]))).toHaveLength(0);
  });

  it('caps code-derived claims at MAX_CODE_CLAIMS (10), separately from doc-surface claims', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `// Feature${i} defaults to ${i}.`);
    const patch = added(...lines);
    expect(extractDocClaims(new Map([[SCHEMA_FILE, patch]]))).toHaveLength(10);
  });

  // Regression (CodeRabbit finding on this PR): the cap must count NET-NEW code claims, not
  // raw pre-dedup candidates — a source's own duplicate of an already-seen claim must not spend
  // budget a later, genuinely unique claim from that same source needs.
  it('code-claim cap counts net-new claims, not pre-dedup candidates', () => {
    const dupLine = 'The batch size defaults to 32.';
    const codeLines = [
      ...Array.from({ length: 10 }, () => `// ${dupLine}`),
      '// A totally separate claim requires special handling here.',
    ];
    const patches = new Map([
      [DOC, added(dupLine)], // smaller hunk — sorts first, seeds `seen` before the code file
      [SCHEMA_FILE, added(...codeLines)],
    ]);
    const claims = extractDocClaims(patches);
    // Only 2 distinct claims survive: the guidance one, and the 11th code line's unique claim —
    // the 10 duplicate code lines contribute nothing and must not have consumed the cap.
    expect(claims).toHaveLength(2);
    expect(claims.some(c => c.file === SCHEMA_FILE && c.claimText.includes('separate claim'))).toBe(
      true,
    );
  });

  it('does not let a comment-heavy code diff crowd out doc-surface claims', () => {
    const codeLines = Array.from({ length: 15 }, (_, i) => `// Feature${i} defaults to ${i}.`);
    const patches = new Map([
      [SCHEMA_FILE, added(...codeLines)],
      [DOC, added('The batch size defaults to 32.')],
    ]);
    const claims = extractDocClaims(patches);
    expect(claims).toHaveLength(11); // 10 code claims (capped) + 1 doc-surface claim
    expect(claims.filter(c => c.file === DOC)).toHaveLength(1);
    expect(claims.filter(c => c.file === SCHEMA_FILE)).toHaveLength(10);
  });

  it('ranks a small code-comment hunk ahead of a much larger doc-surface hunk (smallest-hunk-first fairness)', () => {
    const bigDocPatch = added(
      ...Array.from({ length: 30 }, (_, i) => `Some descriptive prose line number ${i}.`),
      'The batch size defaults to 32.',
    );
    const tinyCodePatch = added(
      '     * keep working; search_code and find_similar report as disabled.',
    );
    const claims = extractDocClaims(
      new Map([
        [DOC, bigDocPatch],
        [SCHEMA_FILE, tinyCodePatch],
      ]),
    );
    expect(claims[0].file).toBe(SCHEMA_FILE); // the tiny hunk sorts first
  });
});

// ---------------------------------------------------------------------------
// findClaimEvidence — referenced-file diff prefetch (issue: PR #811's own review)
// ---------------------------------------------------------------------------

describe('findClaimEvidence — referenced-file diff prefetch', () => {
  const WORKFLOW_FILE = '.github/workflows/lien-review.yml';

  function workflowPatch(): string {
    return added("  LIEN_STALE_DUP_PASS: 'on'", "  LIEN_INCOMPLETE_PASS: 'on'");
  }

  it('prefetches the diff hunk for a cited file that is part of the PR, even with NO repo index at all', () => {
    const claim = claimWithCitedPath(
      'sets `LIEN_STALE_DUP_PASS` in .github/workflows/lien-review.yml',
      { path: WORKFLOW_FILE },
    );
    const patches = new Map([[WORKFLOW_FILE, workflowPatch()]]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    expect(ev.fromDiff).toBe(true);
    expect(ev.fromDoc).toBe(false);
    expect(ev.file).toBe(WORKFLOW_FILE);
    expect(ev.excerpt).toContain('LIEN_STALE_DUP_PASS');
    expect(ev.startLine).toBe(1);
  });

  it('resolves a cited path that is a suffix of a changed file key (leniency parity with the indexed-chunk lookup)', () => {
    const claim = claimWithCitedPath('see workflows/lien-review.yml', {
      path: 'workflows/lien-review.yml',
    });
    const patches = new Map([[WORKFLOW_FILE, workflowPatch()]]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    expect(ev.file).toBe(WORKFLOW_FILE);
    expect(ev.fromDiff).toBe(true);
  });

  // Regression (CodeRabbit finding on this PR): an EXACT path match must win over a suffix match
  // regardless of Map iteration order, and an AMBIGUOUS suffix (two candidates share it) must
  // resolve to neither rather than an arbitrary one.
  it('prefers an exact path match over a same-suffix decoy, regardless of iteration order', () => {
    const claim = claimWithCitedPath('see lien-review.yml', { path: 'lien-review.yml' });
    const patches = new Map([
      ['some/other/lien-review.yml', 'decoy patch'], // suffix match, but NOT exact — and first
      ['lien-review.yml', 'the real one'], // exact match
    ]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    expect(ev.file).toBe('lien-review.yml');
    expect(ev.excerpt).toContain('the real one');
  });

  it('does not resolve an ambiguous suffix shared by two changed files', () => {
    const claim = claimWithCitedPath('see lien-review.yml', { path: 'lien-review.yml' });
    const patches = new Map([
      ['a/lien-review.yml', 'patch A'],
      ['b/lien-review.yml', 'patch B'],
    ]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    expect(ev.citedPathMissing).toBe(true);
  });

  it('prefers the PR diff hunk over an indexed chunk when the cited file is both changed and indexed', () => {
    const claim = claimWithCitedPath('see packages/review/src/defaults.ts', {
      path: 'packages/review/src/defaults.ts',
    });
    const patches = new Map([
      ['packages/review/src/defaults.ts', added('export const X = 1; // from diff')],
    ]);
    const chunks = [
      chunk('packages/review/src/defaults.ts', 40, 'export const X = 2; // from index'),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set(), patches)!;
    expect(ev.fromDiff).toBe(true);
    expect(ev.excerpt).toContain('from diff');
    expect(ev.excerpt).not.toContain('from index');
  });

  it('falls back to the indexed chunk when the cited file is not part of the PR diff', () => {
    const claim = claimWithCitedPath('see packages/review/src/defaults.ts', {
      path: 'packages/review/src/defaults.ts',
    });
    const patches = new Map([['some/other/file.ts', added('unrelated')]]);
    const chunks = [chunk('packages/review/src/defaults.ts', 40, 'export const X = 2;')];
    const ev = findClaimEvidence(claim, chunks, new Set(), patches)!;
    expect(ev.fromDiff).toBeFalsy();
    expect(ev.file).toBe('packages/review/src/defaults.ts');
  });

  it('degrades loudly, naming the index AND the PR diff, when the cited path resolves against neither', () => {
    const claim = claimWithCitedPath('see packages/review/src/ghost.ts', {
      path: 'packages/review/src/ghost.ts',
    });
    const patches = new Map([['some/other/file.ts', added('unrelated')]]);
    const chunks = [chunk('packages/review/src/defaults.ts', 1, 'export const X = 1;')];
    const ev = findClaimEvidence(claim, chunks, new Set(), patches)!;
    expect(ev.citedPathMissing).toBe(true);

    const md = renderDocClaims([{ ...claim, evidence: ev }]);
    expect(md).toContain('was not found in the index or PR diff');
    expect(md).not.toContain('```'); // a one-line note, not a fenced block
  });

  it('caps an oversized diff-hunk excerpt with a loud truncation note', () => {
    const claim = claimWithCitedPath('see packages/review/src/big.ts', {
      path: 'packages/review/src/big.ts',
    });
    const bigPatch = added('x '.repeat(500));
    const patches = new Map([['packages/review/src/big.ts', bigPatch]]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    expect(ev.excerpt).toContain('[diff truncated to respect the input budget]');
    expect(ev.excerpt.length).toBeLessThan(bigPatch.length);
  });

  it('renders the "evidence (PR diff)" label distinctly from sibling-doc/plain evidence', () => {
    const claim = claimWithCitedPath('see .github/workflows/lien-review.yml', {
      path: WORKFLOW_FILE,
    });
    const patches = new Map([[WORKFLOW_FILE, workflowPatch()]]);
    const ev = findClaimEvidence(claim, undefined, new Set(), patches)!;
    const md = renderDocClaims([{ ...claim, evidence: ev }]);
    expect(md).toContain('evidence (PR diff)');
  });

  it('backward-compatible: omitting the patches argument entirely preserves the pre-existing repoChunks-only behavior', () => {
    const claim = claimWithCitedPath('see packages/review/src/defaults.ts', {
      path: 'packages/review/src/defaults.ts',
    });
    const chunks = [
      chunk('packages/review/src/defaults.ts', 12, 'export const DEFAULT_REVIEW_MODEL = 1;'),
    ];
    const ev = findClaimEvidence(claim, chunks, new Set())!; // no 4th arg — old call shape
    expect(ev.fromDiff).toBeUndefined();
    expect(ev.file).toBe('packages/review/src/defaults.ts');
  });
});

describe('attachEvidence — referenced-file diff prefetch wiring', () => {
  it('passes context.pr.patches through so a citedPath claim gets diff evidence', () => {
    const WORKFLOW_FILE = '.github/workflows/lien-review.yml';
    const ctx = {
      changedFiles: [],
      chunks: [],
      pr: { patches: new Map([[WORKFLOW_FILE, added("LIEN_STALE_DUP_PASS: 'on'")]]) },
    } as unknown as ReviewContext;
    const claims = attachEvidence(
      [
        claimWithCitedPath('sets LIEN_STALE_DUP_PASS in .github/workflows/lien-review.yml', {
          path: WORKFLOW_FILE,
        }),
      ],
      ctx,
    );
    expect(claims[0].evidence?.fromDiff).toBe(true);
  });
});
