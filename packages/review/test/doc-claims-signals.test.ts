import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractAnchors,
  extractDocClaims,
  findClaimEvidence,
  attachEvidence,
  renderDocClaims,
  renderDocClaimsSection,
  type DocClaim,
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
