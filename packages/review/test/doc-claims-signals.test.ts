import { describe, it, expect } from 'vitest';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractDocClaims,
  renderDocClaims,
  renderDocClaimsSection,
  type DocClaim,
} from '../src/doc-claims-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

function ctxWithPatches(patches?: Map<string, string>): ReviewContext {
  return {
    pr: patches ? { patches } : undefined,
    changedFiles: patches ? [...patches.keys()] : [],
    chunks: [],
  } as unknown as ReviewContext;
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
