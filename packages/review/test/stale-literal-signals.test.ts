import { describe, it, expect, vi } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractChangedLiterals,
  computeStaleLiteralCandidates,
  computeStaleLiteralCandidatesWithDeadline,
  renderStaleLiteralCandidates,
  renderStaleLiteralSection,
  renderStaleLiteralSectionWithDeadline,
} from '../src/stale-literal-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';
import { silentLogger } from '../src/test-helpers.js';

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

  it('does not extract numeric literals (numbers lack cross-file identity)', () => {
    // A bare number like 4096 or 2.5 matches CSS classes, test values, and
    // unrelated ratios with no shared meaning, so the signal is strings-only.
    const patches = new Map([
      ['src/a.ts', '@@ -1,2 +1,2 @@\n-const max = 4096;\n-const ratio = 2.5;\n+const max = 8192;'],
    ]);
    const values = extractChangedLiterals(patches).map(l => l.value);
    expect(values).not.toContain('4096');
    expect(values).not.toContain('2.5');
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

  it('reports a survivor on a context line adjacent to a pure removal', () => {
    // Regression: a removed-outright literal records changedLine as the *next*
    // new-file line (a `-` line does not advance the counter). An earlier guard
    // that skipped `absLine === changedLine` wrongly suppressed a real survivor
    // sitting on that adjacent context line. Touched-line exclusion is now
    // derived only from `+` lines (none here), so the survivor must surface.
    const patch =
      '@@ -5,3 +5,2 @@\n' +
      '   const a = 1;\n' +
      "-  const old = 'shared-token-abc';\n" +
      "   const other = 'shared-token-abc';";
    const patches = new Map([['src/a.ts', patch]]);
    const repoChunks = [
      makeChunk('src/a.ts', 5, "const a = 1;\nconst other = 'shared-token-abc';"),
    ];

    const candidates = computeStaleLiteralCandidates(makeContext({ patches, repoChunks }));
    const cand = candidates.find(c => c.literal === "'shared-token-abc'");
    expect(cand).toBeDefined();
    expect(cand!.staleSites.map(s => s.line)).toContain(6); // the surviving context line
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
// Single repo-wide pass (perf restructure): equivalence, traversal, budget
// ---------------------------------------------------------------------------

/** A CodeChunk whose `.content` getter increments a shared counter on every access. */
function makeCountingChunk(
  file: string,
  startLine: number,
  content: string,
  accessCounter: { count: number },
): CodeChunk {
  return {
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'function',
      language: 'typescript',
    },
    get content(): string {
      accessCounter.count++;
      return content;
    },
  } as unknown as CodeChunk;
}

describe('scanRepoForStaleSites (single-pass restructure)', () => {
  it('produces identical candidates to a multi-literal, multi-file fixture, including per-literal caps and first-N-in-traversal-order', () => {
    // Two touched literals in one diff; the first has more surviving sites
    // than MAX_SITES_PER_LITERAL (5) spread across multiple repo chunks, the
    // second has exactly one. Proves the single shared pass still enforces
    // each literal's own cap independently and keeps first-N traversal order.
    const patch =
      "@@ -1,2 +1,2 @@\n-const key = 'shared-config-key';\n-const flag = 'legacy-mode-flag';\n+const key = resolveKey();\n+const flag = resolveFlag();";
    const patches = new Map([['src/config.ts', patch]]);

    const repoChunks = [
      makeChunk(
        'src/other1.ts',
        1,
        "const a = 'shared-config-key';\nconst b = 'shared-config-key';",
      ),
      makeChunk(
        'src/other2.ts',
        1,
        "const c = 'shared-config-key';\nconst d = 'shared-config-key';\nconst e = 'shared-config-key';",
      ),
      makeChunk(
        'src/other3.ts',
        1,
        "const f = 'shared-config-key';\nconst g = 'legacy-mode-flag';",
      ),
    ];

    const candidates = computeStaleLiteralCandidates(makeContext({ patches, repoChunks }));

    const key = candidates.find(c => c.literal === "'shared-config-key'");
    expect(key).toBeDefined();
    // Capped at MAX_SITES_PER_LITERAL (5): the first five in chunk/line order,
    // NOT the sixth occurrence in other3.ts.
    expect(key!.staleSites.map(s => `${s.file}:${s.line}`)).toEqual([
      'src/other1.ts:1',
      'src/other1.ts:2',
      'src/other2.ts:1',
      'src/other2.ts:2',
      'src/other2.ts:3',
    ]);

    const flag = candidates.find(c => c.literal === "'legacy-mode-flag'");
    expect(flag).toBeDefined();
    expect(flag!.staleSites.map(s => `${s.file}:${s.line}`)).toEqual(['src/other3.ts:2']);
  });

  it('reads each repo chunk exactly once, regardless of how many literals are touched', () => {
    const counter = { count: 0 };
    const repoChunks = [
      makeCountingChunk(
        'src/a.ts',
        1,
        "const a = 'alpha-value';\nconst b = 'beta-value';",
        counter,
      ),
      makeCountingChunk('src/b.ts', 1, "const c = 'gamma-value';", counter),
    ];
    // Three distinct touched literals — under the old per-literal scan this
    // would read every chunk's content 3x (once per literal); the single-pass
    // scan must read each chunk's content exactly once regardless.
    const patch =
      "@@ -1,3 +1,3 @@\n-const x = 'alpha-value';\n-const y = 'beta-value';\n-const z = 'gamma-value';\n+const x = f();\n+const y = g();\n+const z = h();";
    const patches = new Map([['src/other.ts', patch]]);

    computeStaleLiteralCandidates(makeContext({ patches, repoChunks }));

    expect(counter.count).toBe(repoChunks.length);
  });

  it('returns partial results and logs a diagnostic when the wall-clock budget is exceeded', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'budget-test-literal';\n+const x = compute();"],
    ]);
    const repoChunks = [makeChunk('src/other.ts', 1, "const y = 'budget-test-literal';")];
    const warnings: string[] = [];
    const context: ReviewContext = {
      ...makeContext({ patches, repoChunks }),
      logger: { ...silentLogger, warning: (msg: string) => warnings.push(msg) },
    };

    // An already-past deadline trips the very first check deterministically —
    // no reliance on real elapsed time.
    const candidates = computeStaleLiteralCandidatesWithDeadline(context, Date.now() - 1);

    expect(candidates).toEqual([]); // scan aborted before finding the survivor
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('budget');
  });

  it('does not log when the scan completes within budget', () => {
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'on-time-literal';\n+const x = compute();"],
    ]);
    const repoChunks = [makeChunk('src/other.ts', 1, "const y = 'on-time-literal';")];
    const warnings: string[] = [];
    const context: ReviewContext = {
      ...makeContext({ patches, repoChunks }),
      logger: { ...silentLogger, warning: (msg: string) => warnings.push(msg) },
    };

    const candidates = computeStaleLiteralCandidates(context);

    expect(candidates).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('dedupes survivors when repoChunks contain overlapping ranges for the same file', () => {
    // Two chunks both cover src/dup.ts:6 (e.g. an enclosing chunk and a
    // nested one indexed separately). Without dedup, the single-pass scan
    // would revisit that physical line twice and record the same survivor
    // twice, filling the per-literal cap with duplicates.
    const patch =
      '@@ -1,1 +1,1 @@\n' + "-const old = 'shared-token-abc';\n" + '+const old = compute();';
    const patches = new Map([['src/a.ts', patch]]);
    const repoChunks = [
      makeChunk('src/dup.ts', 5, "const a = 1;\nconst other = 'shared-token-abc';"), // lines 5-6
      makeChunk('src/dup.ts', 6, "const other = 'shared-token-abc';\nconst b = 2;"), // lines 6-7, overlaps at line 6
    ];

    const candidates = computeStaleLiteralCandidates(makeContext({ patches, repoChunks }));
    const cand = candidates.find(c => c.literal === "'shared-token-abc'");
    expect(cand).toBeDefined();
    // Exactly one site for src/dup.ts:6, not two.
    expect(cand!.staleSites).toHaveLength(1);
    expect(cand!.staleSites[0]).toMatchObject({ file: 'src/dup.ts', line: 6 });
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

  it('emits an incomplete-scan notice — not the "None" claim — when the budget is exceeded before finding any survivors', () => {
    // A survivor exists (src/other.ts), but an already-past deadline trips
    // the very first check deterministically, so the scan never gets to see
    // it. Rendering must not tell the agent "discovery is complete" here.
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'timeout-none-literal';\n+const x = compute();"],
    ]);
    const repoChunks = [makeChunk('src/other.ts', 1, "const y = 'timeout-none-literal';")];

    const section = renderStaleLiteralSectionWithDeadline(
      makeContext({ patches, repoChunks }),
      Date.now() - 1,
    );

    expect(section).toContain('<stale_literal_candidates>');
    expect(section).toContain('Scan incomplete');
    expect(section).not.toContain('None —');
    expect(section).not.toContain('discovery step is complete');
  });

  it('still renders the normal candidate block (no incomplete-scan notice) when the scan finds survivors before timing out on a later chunk', () => {
    // Deliberate design choice: the candidate block never claims completeness
    // ("no grep needed" only covers the listed candidates), so a timeout that
    // still yields candidates does not need the incomplete-scan notice — only
    // the zero-candidate "None" claim was ever misleading.
    const patches = new Map([
      ['src/a.ts', "@@ -1,1 +1,1 @@\n-const x = 'timeout-partial-literal';\n+const x = compute();"],
    ]);
    const repoChunks = [
      makeChunk('src/found.ts', 1, "const y = 'timeout-partial-literal';"), // survivor found here
      makeChunk('src/unreached.ts', 1, "const z = 'timeout-partial-literal';"), // scan never gets here
    ];

    const deadline = 2_000;
    let call = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      call++;
      if (call === 1) return 1_000; // startedAt
      if (call === 2) return 1_500; // deadline check for src/found.ts's line — not yet exceeded
      return 3_000; // deadline check for src/unreached.ts's line, and any later call — exceeded
    });

    try {
      const section = renderStaleLiteralSectionWithDeadline(
        makeContext({ patches, repoChunks }),
        deadline,
      );
      expect(section).toContain("'timeout-partial-literal'");
      expect(section).toContain('src/found.ts:1');
      expect(section).not.toContain('src/unreached.ts');
      expect(section).not.toContain('Scan incomplete');
    } finally {
      nowSpy.mockRestore();
    }
  });
});
