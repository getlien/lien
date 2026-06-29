import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractChangedLiterals,
  computeStaleLiteralCandidates,
  renderStaleLiteralCandidates,
  renderStaleLiteralSection,
} from '../src/stale-literal-signals.js';
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
  diffLines?: Map<string, Set<number>>;
}): ReviewContext {
  const pr =
    opts.patches || opts.diffLines
      ? { patches: opts.patches, diffLines: opts.diffLines }
      : undefined;
  return { pr, repoChunks: opts.repoChunks } as unknown as ReviewContext;
}

// The canonical PR #539 shape: an unconditional model literal is
// conditionalized in place (so it lands on BOTH a `-` and a `+` line) while a
// sibling site keeps it hardcoded.
const CONDITIONALIZE_PATCH = `@@ -10,3 +10,4 @@
   const cfg = load();
-  const model = 'claude-sonnet-4-6';
+  const model = cfg.openrouterApiKey
+    ? 'gemini-3-flash'
+    : 'claude-sonnet-4-6';
   return model;`;

const PR_REVIEW_CONTENT = [
  'const cfg = load();', // 10
  'const model = cfg.openrouterApiKey', // 11
  "  ? 'gemini-3-flash'", // 12
  "  : 'claude-sonnet-4-6';", // 13
  'return model;', // 14
  '', // 15
  'function reportMeta() {', // 16
  '  // legacy attribution', // 17
  '  const ctx = {};', // 18
  '  ctx.provider = "openrouter";', // 19
  "  adapterContext.model = 'claude-sonnet-4-6';", // 20
].join('\n');

// ---------------------------------------------------------------------------
// extractChangedLiterals
// ---------------------------------------------------------------------------

describe('extractChangedLiterals', () => {
  it('extracts a distinctive literal touched on a `-` line', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'feature-flag-alpha';\n+const x = readFlag();"],
    ]);
    const lits = extractChangedLiterals(patches);
    expect(lits.map(l => l.value)).toContain('feature-flag-alpha');
  });

  it('extracts a literal touched on a `+` line (conditionalized in place)', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const values = extractChangedLiterals(patches).map(l => l.value);
    expect(values).toContain('claude-sonnet-4-6');
    expect(values).toContain('gemini-3-flash');
  });

  it('records each literal once even when on both `-` and `+`', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const sonnet = extractChangedLiterals(patches).filter(l => l.value === 'claude-sonnet-4-6');
    expect(sonnet).toHaveLength(1);
  });

  it('skips low-signal literals (short, common words, booleans)', () => {
    const patches = new Map([
      [
        'src/a.ts',
        "@@ -1,4 +1,4 @@\n-const a = 'ab';\n-const b = 'name';\n-const c = true;\n+const d = 'kind';",
      ],
    ]);
    const values = extractChangedLiterals(patches).map(l => l.value);
    expect(values).not.toContain('ab'); // < 3 chars
    expect(values).not.toContain('name'); // common, no special char, < 6
    expect(values).not.toContain('true'); // boolean keyword
    expect(values).not.toContain('kind'); // common, no special char, < 6
  });

  it('keeps configuration-like strings (special chars / digits / length)', () => {
    const patches = new Map([
      [
        'src/a.ts',
        "@@ -1,3 +1,3 @@\n-const u = 'baseUrl';\n-const p = 'src/config/app.json';\n+const v = 'v2.1.0';",
      ],
    ]);
    const values = extractChangedLiterals(patches).map(l => l.value);
    expect(values).toContain('baseUrl'); // length >= 6
    expect(values).toContain('src/config/app.json'); // has '/'
    expect(values).toContain('v2.1.0'); // has digits + '.'
  });

  it('extracts distinctive numbers but skips small ones', () => {
    const patches = new Map([
      ['src/a.ts', '@@ -1,2 +1,2 @@\n-const max = 4096;\n-const n = 42;\n+const max = 8192;'],
    ]);
    const values = extractChangedLiterals(patches).map(l => l.value);
    expect(values).toContain('4096'); // >= 3 digits
    expect(values).not.toContain('42'); // < 3 digits
  });
});

// ---------------------------------------------------------------------------
// computeStaleLiteralCandidates
// ---------------------------------------------------------------------------

describe('computeStaleLiteralCandidates', () => {
  it('returns [] when there is no diff', () => {
    expect(computeStaleLiteralCandidates(makeContext({ repoChunks: [] }))).toEqual([]);
  });

  it('returns [] when there is no repo index to scan', () => {
    const patches = new Map([['src/a.ts', CONDITIONALIZE_PATCH]]);
    expect(computeStaleLiteralCandidates(makeContext({ patches }))).toEqual([]);
  });

  it('flags a literal conditionalized at one site but hardcoded at a sibling site', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const diffLines = new Map([['src/pr-review.ts', new Set([11, 12, 13])]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];

    const candidates = computeStaleLiteralCandidates(
      makeContext({ patches, repoChunks, diffLines }),
    );

    const sonnet = candidates.find(c => c.literal === "'claude-sonnet-4-6'");
    expect(sonnet).toBeDefined();
    expect(sonnet!.kind).toBe('string');
    expect(sonnet!.staleSites.map(s => s.line)).toContain(20); // the hardcoded sibling
    expect(sonnet!.staleSites.map(s => s.line)).not.toContain(13); // the changed site itself
    expect(sonnet!.confidence).toBe('high'); // survivor is value-emitting code
  });

  it('excludes the conditionalized-in-place site even when diffLines is absent', () => {
    // No diffLines provided — touched lines must be derived from the patch so
    // the literal's own `+` else-branch (line 13) is not reported as a survivor.
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];

    const candidates = computeStaleLiteralCandidates(makeContext({ patches, repoChunks }));
    const sonnet = candidates.find(c => c.literal === "'claude-sonnet-4-6'");
    expect(sonnet).toBeDefined();
    expect(sonnet!.staleSites.map(s => s.line)).toContain(20); // the real sibling
    expect(sonnet!.staleSites.map(s => s.line)).not.toContain(13); // its own changed `+` line
  });

  it('does not flag the PR-introduced value that has no stale copy', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const diffLines = new Map([['src/pr-review.ts', new Set([11, 12, 13])]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];

    const candidates = computeStaleLiteralCandidates(
      makeContext({ patches, repoChunks, diffLines }),
    );
    expect(candidates.find(c => c.literal === "'gemini-3-flash'")).toBeUndefined();
  });

  it('returns no candidate when the literal does not survive elsewhere', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'lonely-literal-xyz';\n+const x = compute();"],
    ]);
    const diffLines = new Map([['src/a.ts', new Set([1])]]);
    const repoChunks = [makeChunk('src/a.ts', 1, 'const x = compute();\nreturn x;')];
    expect(computeStaleLiteralCandidates(makeContext({ patches, repoChunks, diffLines }))).toEqual(
      [],
    );
  });

  it('flags a comment-only survivor at low confidence', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const m = 'model-x-9000';\n+const m = pick();"],
    ]);
    const diffLines = new Map([['src/a.ts', new Set([1])]]);
    const repoChunks = [
      makeChunk('src/a.ts', 1, 'const m = pick();'),
      makeChunk('src/notes.ts', 5, "// historical default was 'model-x-9000'"),
    ];
    const candidates = computeStaleLiteralCandidates(
      makeContext({ patches, repoChunks, diffLines }),
    );
    const cand = candidates.find(c => c.literal === "'model-x-9000'");
    expect(cand).toBeDefined();
    expect(cand!.confidence).toBe('low');
    expect(cand!.staleSites[0].isComment).toBe(true);
  });

  it('marks survivors in test files', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const m = 'model-x-9000';\n+const m = pick();"],
    ]);
    const diffLines = new Map([['src/a.ts', new Set([1])]]);
    const repoChunks = [
      makeChunk('src/a.ts', 1, 'const m = pick();'),
      makeChunk('src/a.test.ts', 5, "expect(m).toBe('model-x-9000');"),
    ];
    const candidates = computeStaleLiteralCandidates(
      makeContext({ patches, repoChunks, diffLines }),
    );
    const cand = candidates.find(c => c.literal === "'model-x-9000'");
    expect(cand!.staleSites[0].isTest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderStaleLiteralCandidates
// ---------------------------------------------------------------------------

describe('renderStaleLiteralCandidates', () => {
  it('returns empty string for no candidates', () => {
    expect(renderStaleLiteralCandidates([])).toBe('');
  });

  it('renders the block naming the literal and both locations', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const diffLines = new Map([['src/pr-review.ts', new Set([11, 12, 13])]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];
    const candidates = computeStaleLiteralCandidates(
      makeContext({ patches, repoChunks, diffLines }),
    );

    const md = renderStaleLiteralCandidates(candidates);
    expect(md).toContain('<stale_literal_candidates>');
    expect(md).toContain('</stale_literal_candidates>');
    expect(md).toContain("'claude-sonnet-4-6'");
    expect(md).toContain('src/pr-review.ts:20'); // the stale site
    expect(md).toMatch(/changed at src\/pr-review\.ts:1[1-3]/); // the touched site
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring (zero-LLM proof the signal reaches the agent)
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection', () => {
  it('includes the <stale_literal_candidates> block when candidates exist', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const diffLines = new Map([['src/pr-review.ts', new Set([11, 12, 13])]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];
    const context = {
      ...makeContext({ patches, repoChunks, diffLines }),
      changedFiles: ['src/pr-review.ts'],
      chunks: [],
    } as unknown as ReviewContext;

    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).toContain('<stale_literal_candidates>');
    expect(message).toContain("'claude-sonnet-4-6'");
    expect(message).toContain('src/pr-review.ts:20');
  });

  it('omits the block entirely when no scan was possible (no diff / no index)', () => {
    const context = {
      ...makeContext({ repoChunks: [] }),
      changedFiles: ['src/a.ts'],
      chunks: [],
    } as unknown as ReviewContext;
    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).not.toContain('<stale_literal_candidates>');
  });

  it('emits an explicit "None" block when the scan ran but found nothing', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'lonely-literal-xyz';\n+const x = compute();"],
    ]);
    const repoChunks = [makeChunk('src/a.ts', 1, 'const x = compute();')];
    const context = {
      ...makeContext({ patches, repoChunks }),
      changedFiles: ['src/a.ts'],
      chunks: [],
    } as unknown as ReviewContext;
    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).toContain('<stale_literal_candidates>');
    expect(message).toContain('None');
  });
});

// ---------------------------------------------------------------------------
// renderStaleLiteralSection — distinguishes "clean scan" from "no scan"
// ---------------------------------------------------------------------------

describe('renderStaleLiteralSection', () => {
  it('returns "" when no scan was possible (no diff or no index)', () => {
    expect(renderStaleLiteralSection(makeContext({ repoChunks: [] }))).toBe('');
    const patches = new Map([['src/a.ts', CONDITIONALIZE_PATCH]]);
    expect(renderStaleLiteralSection(makeContext({ patches }))).toBe(''); // no repoChunks
  });

  it('returns a "None" block when the scan ran but found nothing', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'lonely-literal-xyz';\n+const x = compute();"],
    ]);
    const repoChunks = [makeChunk('src/a.ts', 1, 'const x = compute();')];
    const section = renderStaleLiteralSection(makeContext({ patches, repoChunks }));
    expect(section).toContain('<stale_literal_candidates>');
    expect(section).toContain('None');
  });

  it('returns the candidate block when there are candidates', () => {
    const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
    const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];
    const section = renderStaleLiteralSection(makeContext({ patches, repoChunks }));
    expect(section).toContain("'claude-sonnet-4-6'");
    expect(section).not.toContain('None —');
  });
});
