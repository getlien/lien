import { describe, it, expect, afterEach } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import {
  staleDuplicateSkipReason,
  shouldRunStaleDuplicatePass,
  buildStaleDuplicatePassPrompts,
  buildStaleDuplicatePassInitialMessage,
  staleDuplicatePassBudget,
  postProcessStaleDuplicateResult,
  computeStaleDuplicateWorklist,
  mergeStaleDuplicateFindings,
  mergeStaleDuplicateResultState,
  isStaleDuplicateMainDisabled,
  applyStaleDuplicateMainOverride,
  STALE_DUPLICATE_PASS_SPEC,
  STALE_DUP_PASS_MAX_TURNS,
} from '../src/plugins/agent/stale-duplicate-pass.js';
import { VERDICT_EMISSION_RESERVE_TOKENS } from '../src/plugins/agent/review-pass.js';
import { BUILTIN_RULES, buildTriggerContext, selectRules } from '../src/plugins/agent/rules.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';
import { createTestContext } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import type { AgentConfig, AgentFinding, AgentResult } from '../src/plugins/agent/types.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
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

// The canonical PR #539 shape (mirrors stale-literal-signals.test.ts): a
// model literal is conditionalized in place at lines 11-13 of pr-review.ts,
// while a SAME-FILE sibling site (line 20, a value-emitting assignment)
// keeps it hardcoded — high confidence, same-file production survivor, so
// this trips the loop's eligibility threshold.
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

/** An eligible context: the CONDITIONALIZE_PATCH shape, same-file high-confidence survivor. */
function eligibleContext(extra?: Partial<ReviewContext>): ReviewContext {
  const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
  const repoChunks = [makeChunk('src/pr-review.ts', 10, PR_REVIEW_CONTENT)];
  return createTestContext({
    changedFiles: ['src/pr-review.ts'],
    chunks: [],
    pr: {
      title: 'Bump default model',
      body: '',
      patches,
    } as unknown as ReviewContext['pr'],
    repoChunks,
    ...extra,
  });
}

/** A context whose only survivor is a DIFFERENT file (fails the same-file threshold). */
function differentFileOnlyContext(): ReviewContext {
  const patches = new Map([['src/pr-review.ts', CONDITIONALIZE_PATCH]]);
  const repoChunks = [
    makeChunk(
      'src/pr-review.ts',
      10,
      'const cfg = load();\nconst model = compute();\nreturn model;',
    ),
    makeChunk('src/other-file.ts', 1, "adapterContext.model = 'claude-sonnet-4-6';"),
  ];
  return createTestContext({
    changedFiles: ['src/pr-review.ts'],
    chunks: [],
    pr: { title: 'Bump default model', body: '', patches } as unknown as ReviewContext['pr'],
    repoChunks,
  });
}

/** `n` independent same-file, high-confidence stale-duplicate candidates — each file mirrors
 *  `eligibleContext`'s own CONDITIONALIZE_PATCH/PR_REVIEW_CONTENT shape with a distinct literal,
 *  so the shared signal's own confidence/same-area scoring ties on everything except insertion
 *  order (stable sort) — deterministic for rank-and-cap overflow testing. */
function manyCandidatesContext(n: number): ReviewContext {
  const patches = new Map<string, string>();
  const repoChunks: CodeChunk[] = [];
  for (let i = 0; i < n; i++) {
    const literal = `token-${i}`;
    const file = `src/pr-review-${i}.ts`;
    patches.set(
      file,
      `@@ -10,3 +10,4 @@
   const cfg = load();
-  const model = '${literal}';
+  const model = cfg.openrouterApiKey
+    ? 'gemini-3-flash'
+    : '${literal}';
   return model;`,
    );
    const content = [
      'const cfg = load();', // 10
      'const model = cfg.openrouterApiKey', // 11
      "  ? 'gemini-3-flash'", // 12
      `  : '${literal}';`, // 13
      'return model;', // 14
      '',
      'function reportMeta() {',
      '  // legacy attribution',
      '  const ctx = {};',
      '  ctx.provider = "openrouter";',
      `  adapterContext.model = '${literal}';`, // 20
    ].join('\n');
    repoChunks.push(makeChunk(file, 10, content));
  }
  return createTestContext({
    changedFiles: [...patches.keys()],
    chunks: [],
    pr: { title: 'Bump default models', body: '', patches } as unknown as ReviewContext['pr'],
    repoChunks,
  });
}

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Record<string, unknown> = {}): AgentFinding {
  return {
    filepath: 'src/pr-review.ts',
    line: 20,
    severity: 'warning',
    category: 'logic_error',
    message: 'msg',
    ...overrides,
  } as AgentFinding;
}

function fakeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    findings: [],
    summary: { riskLevel: 'low', overview: 'ok', keyChanges: [] },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.01 },
    turns: 1,
    stopReason: 'completed',
    incomplete: false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.LIEN_STALE_DUP_PASS;
  delete process.env.LIEN_STALE_DUP_MAIN;
});

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

describe('staleDuplicateSkipReason / shouldRunStaleDuplicatePass', () => {
  it('is false (disabled) by default, even with an eligible candidate — pilot ships dark', () => {
    const ctx = eligibleContext();
    expect(shouldRunStaleDuplicatePass(ctx, cfg())).toBe(false);
    expect(staleDuplicateSkipReason(ctx, cfg())).toContain('disabled');
  });

  it('is true when opted in via config AND an eligible candidate exists', () => {
    const ctx = eligibleContext();
    expect(shouldRunStaleDuplicatePass(ctx, cfg({ staleDuplicatePass: true }))).toBe(true);
    expect(staleDuplicateSkipReason(ctx, cfg({ staleDuplicatePass: true }))).toBeNull();
  });

  it('is true when opted in via LIEN_STALE_DUP_PASS=on (no config flag)', () => {
    process.env.LIEN_STALE_DUP_PASS = 'on';
    const ctx = eligibleContext();
    expect(shouldRunStaleDuplicatePass(ctx, cfg())).toBe(true);
  });

  it('is false when opted in but no candidate clears the eligibility threshold', () => {
    const ctx = differentFileOnlyContext();
    const reason = staleDuplicateSkipReason(ctx, cfg({ staleDuplicatePass: true }));
    expect(reason).toContain('loop eligibility threshold not met');
  });

  it('is false when there are no patches at all, even when opted in', () => {
    expect(
      shouldRunStaleDuplicatePass(createTestContext(), cfg({ staleDuplicatePass: true })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('buildStaleDuplicatePassPrompts', () => {
  it('hard-cuts the tool list to read_file + grep_codebase only', () => {
    const { systemPrompt } = buildStaleDuplicatePassPrompts(eligibleContext());
    expect(systemPrompt).toContain('read_file');
    expect(systemPrompt).toContain('grep_codebase');
    expect(systemPrompt).not.toContain('get_dependents');
    expect(systemPrompt).not.toContain('get_files_context');
    expect(systemPrompt).not.toContain('list_functions');
    expect(systemPrompt).not.toContain('get_complexity');
  });

  it('includes the stale-duplicate rule strategy and example, scoped to this pass only', () => {
    const { systemPrompt } = buildStaleDuplicatePassPrompts(eligibleContext());
    expect(systemPrompt).toContain('Stale Duplicate Literal Check');
    expect(systemPrompt).toContain('partial model bump leaves stale hardcoded copy');
    expect(systemPrompt).not.toContain('Edge Case Sweep');
    expect(systemPrompt).not.toContain('### Structural Analysis');
  });

  it('requires one findings-array entry per candidate id in the output format', () => {
    const { systemPrompt } = buildStaleDuplicatePassPrompts(eligibleContext());
    expect(systemPrompt).toContain('candidateId');
    expect(systemPrompt).toContain('"verdict"');
    expect(systemPrompt).toContain('candidate-1');
  });

  // Regression for the #814 doc-truth-v2 screen: a real captured vote had the model omit
  // `category` from every per-claim verdict entry, silently dropping them all at
  // `isValidFinding` (which requires `category`) — because the contract's "EVERY entry
  // requires ..." sentence didn't name it, even though the example JSON above it does. This
  // pass's contract shares the identical sentence shape, so it carried the same latent gap.
  it('names category among the required fields, not just in the illustrative example', () => {
    const { systemPrompt } = buildStaleDuplicatePassPrompts(eligibleContext());
    const requiredFieldsSentence = systemPrompt
      .split('\n')
      .find(line => line.startsWith('EVERY entry requires'));
    expect(requiredFieldsSentence).toBeDefined();
    expect(requiredFieldsSentence).toContain('category');
  });

  // Regression coverage for the confirmed FP probe finding on a real captured
  // PR: this pass verdicted "stale" on a test-helper mock hardcoding a
  // production rule's display name/category purely to build a fake object —
  // reasoning about a hypothetical future rename, not actual runtime drift.
  it('includes verdict guidance distinguishing runtime-behavior literals from inert test-double duplication', () => {
    const { systemPrompt } = buildStaleDuplicatePassPrompts(eligibleContext());
    expect(systemPrompt).toContain('<verdict_guidance>');
    expect(systemPrompt).toContain('test double');
    expect(systemPrompt).toContain('intentional-reuse');
    expect(systemPrompt).toContain('test ASSERTION');
  });

  it('builds an initial message with the worklist, changed-site hunk, and surviving sites', () => {
    const message = buildStaleDuplicatePassInitialMessage(eligibleContext());
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('<stale_literal_candidates>');
    expect(message).toContain('candidate-1');
    expect(message).toContain("'claude-sonnet-4-6'");
    expect(message).toContain('Changed site: src/pr-review.ts:1');
    expect(message).toContain('```diff');
    expect(message).toContain('Surviving site(s):');
    expect(message).toContain('src/pr-review.ts:20');
  });

  it('does not include competing signal blocks (blast radius, doc claims, etc.)', () => {
    const message = buildStaleDuplicatePassInitialMessage(eligibleContext());
    expect(message).not.toContain('<blast_radius>');
    expect(message).not.toContain('<doc_claims>');
    expect(message).not.toContain('<removed_exports>');
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: contract text differs ONLY when the worklist was capped
  // -------------------------------------------------------------------------

  it('is byte-identical to before this feature existed when the budget is not passed (default unlimited)', () => {
    const ctx = manyCandidatesContext(5);
    const withBudget = buildStaleDuplicatePassPrompts(ctx, Number.POSITIVE_INFINITY);
    const withoutBudget = buildStaleDuplicatePassPrompts(ctx);
    expect(withoutBudget).toEqual(withBudget);
    expect(withoutBudget.initialMessage).not.toContain('CANDIDATE OVERFLOW');
  });

  it('lists only the affordable candidates and appends the overflow note when the budget caps the worklist', () => {
    const ctx = manyCandidatesContext(5);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 800; // affords 2 of 5
    const { systemPrompt, initialMessage } = buildStaleDuplicatePassPrompts(ctx, budget);
    expect(systemPrompt).toContain('candidate-1');
    expect(systemPrompt).toContain('candidate-2');
    expect(systemPrompt).not.toContain('candidate-3');
    expect(initialMessage).toContain('candidate-1');
    expect(initialMessage).toContain('candidate-2');
    expect(initialMessage).not.toContain('candidate-3');
    expect(initialMessage).toContain('CANDIDATE OVERFLOW');
    expect(initialMessage).toContain('3 additional eligible candidate(s)');
  });

  it('does not append the overflow note when the full worklist fits inside the budget', () => {
    const ctx = manyCandidatesContext(2);
    const budget = staleDuplicatePassBudget(100_000, ctx);
    const { initialMessage } = buildStaleDuplicatePassPrompts(ctx, budget);
    expect(initialMessage).not.toContain('CANDIDATE OVERFLOW');
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('staleDuplicatePassBudget', () => {
  it('scales with candidate count, clamped to the shared one-round-trip floor for a single candidate', () => {
    const budget = staleDuplicatePassBudget(100_000, eligibleContext());
    // 1 candidate: 2000 + 800*1 = 2800, clamped up to the 11,000 floor (#811 fix —
    // was 4,000, smaller than a single Kimi turn's measured 5,526-6,564 tokens).
    expect(budget).toBe(11_000);
  });

  it('is independent of the main pass base budget (candidate-count driven, not a fraction)', () => {
    const low = staleDuplicatePassBudget(10_000, eligibleContext());
    const high = staleDuplicatePassBudget(500_000, eligibleContext());
    expect(low).toBe(high);
  });
});

// ---------------------------------------------------------------------------
// computeStaleDuplicateWorklist — candidate-overflow rank-and-cap
// ---------------------------------------------------------------------------

describe('computeStaleDuplicateWorklist', () => {
  it('sanity check: manyCandidatesContext(3) yields 3 candidates in insertion order', () => {
    const { candidates } = computeStaleDuplicateWorklist(manyCandidatesContext(3));
    expect(candidates.map(c => c.literal)).toEqual(["'token-0'", "'token-1'", "'token-2'"]);
  });

  it('defaults to unlimited budget — defers nothing (byte-identical to before this feature existed)', () => {
    const { candidates, deferredCount, deferredIds } = computeStaleDuplicateWorklist(
      manyCandidatesContext(5),
    );
    expect(candidates).toHaveLength(5);
    expect(deferredCount).toBe(0);
    expect(deferredIds).toEqual([]);
  });

  it("a single-candidate context is never capped at this pass's own real (floor) budget", () => {
    const ctx = eligibleContext();
    const realBudget = staleDuplicatePassBudget(100_000, ctx);
    const { candidates, deferredCount } = computeStaleDuplicateWorklist(ctx, realBudget);
    expect(candidates).toHaveLength(1);
    expect(deferredCount).toBe(0);
  });

  // Byte-diff census: a realistic (low-candidate) real-PR shape at its ACTUAL
  // production budget must produce prompt output byte-identical to the
  // pre-feature default call — overflow handling changes nothing on the
  // common case.
  it('byte-diff census: the ordinary single-candidate real-PR shape is unaffected at the real budget', () => {
    const ctx = eligibleContext();
    const realBudget = staleDuplicatePassBudget(100_000, ctx);
    expect(buildStaleDuplicatePassPrompts(ctx, realBudget)).toEqual(
      buildStaleDuplicatePassPrompts(ctx),
    );
  });

  it("caps to the ceiling and defers the REMAINDER, preserving the signal's own order", () => {
    const ctx = manyCandidatesContext(5);
    // reserve + 2*800 leaves room for exactly 2 candidates at this pass's own
    // evidence-inline per-candidate cost (800).
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 800;
    const { candidates, deferredCount, deferredIds } = computeStaleDuplicateWorklist(ctx, budget);
    expect(candidates.map(c => c.literal)).toEqual(["'token-0'", "'token-1'"]);
    expect(deferredCount).toBe(3);
    expect(deferredIds).toEqual(["'token-2'", "'token-3'", "'token-4'"]);
  });

  it('defers everything when the budget cannot even cover the verdict-emission reserve', () => {
    const ctx = manyCandidatesContext(2);
    const { candidates, deferredCount } = computeStaleDuplicateWorklist(ctx, 0);
    expect(candidates).toEqual([]);
    expect(deferredCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// postProcessStaleDuplicateResult
// ---------------------------------------------------------------------------

describe('postProcessStaleDuplicateResult', () => {
  it('keeps only verdict:"stale" entries as real findings, stripping candidateId/verdict', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'stale', message: 'real bug' })],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe('real bug');
    expect((result.findings[0] as Record<string, unknown>).candidateId).toBeUndefined();
    expect((result.findings[0] as Record<string, unknown>).verdict).toBeUndefined();
  });

  it('drops intentional-reuse and unverifiable verdicts entirely', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'intentional-reuse', message: 'not stale' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.findings).toHaveLength(0);
  });

  it('is complete when every candidate id got a verdict (single-candidate fixture)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'unverifiable' })],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
  });

  it('marks the result incomplete with stopReason "incomplete_verdict" when a candidate id is missing', () => {
    const raw = fakeResult({ findings: [] }); // candidate-1 never got a verdict
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('keeps the ORIGINAL stopReason when the client was already incomplete for a real reason', () => {
    const raw = fakeResult({ findings: [], incomplete: true, stopReason: 'budget' });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('budget'); // NOT overwritten to incomplete_verdict
  });

  it('does not mutate the input result', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'stale' })],
    });
    postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(raw.findings).toHaveLength(1);
    expect((raw.findings[0] as Record<string, unknown>).candidateId).toBe('candidate-1');
  });

  // Regression coverage for the CodeRabbit finding on this pass's initial
  // version: candidateId-presence-only checking let a malformed entry
  // (right id, missing/garbage verdict) count as "covered" while it was
  // ALSO dropped from findings by the verdict==='stale' filter — a silent
  // gap in both directions, the exact thing this pass's honesty contract
  // exists to prevent.
  it('is incomplete when a candidate id is present but its verdict is missing', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: undefined, message: 'no verdict' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0); // never silently promoted to a finding either
  });

  it('is incomplete when a candidate id is present but its verdict is not a recognized value', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'maybe-stale' as never, message: 'bogus' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when the same candidate id is verdicted twice (duplicate, not "covered")', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable', message: 'first' }),
        finding({ candidateId: 'candidate-1', verdict: 'stale', message: 'second' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when an entry names a candidate id outside the worklist', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({ candidateId: 'candidate-99', verdict: 'stale', message: 'phantom candidate' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: deferral is attested, NOT incompleteness
  // -------------------------------------------------------------------------

  it('stamps candidatesDeferred/deferredCandidateIds on the result when the budget capped the worklist', () => {
    const ctx = manyCandidatesContext(5);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 800; // affords 2 of 5
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({ candidateId: 'candidate-2', verdict: 'unverifiable' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, ctx, budget);
    expect(result.candidatesDeferred).toBe(3);
    expect(result.deferredCandidateIds).toEqual(["'token-2'", "'token-3'", "'token-4'"]);
  });

  it('a capped-but-complete run (every LISTED candidate verdicted) stays incomplete:false — deferral is not incompleteness', () => {
    const ctx = manyCandidatesContext(5);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 800; // affords 2 of 5
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({ candidateId: 'candidate-2', verdict: 'unverifiable' }),
      ],
    });
    const result = postProcessStaleDuplicateResult(raw, ctx, budget);
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
    expect(result.candidatesDeferred).toBe(3);
  });

  it('still requires coverage of every LISTED (kept) candidate — omitting one is incomplete_verdict, cap or not', () => {
    const ctx = manyCandidatesContext(5);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 800; // lists candidate-1/candidate-2 only
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'unverifiable' })], // candidate-2 missing
    });
    const result = postProcessStaleDuplicateResult(raw, ctx, budget);
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('reports candidatesDeferred: 0 and no deferredCandidateIds when nothing was capped (default budget)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'unverifiable' })],
    });
    const result = postProcessStaleDuplicateResult(raw, eligibleContext());
    expect(result.candidatesDeferred).toBe(0);
    expect(result.deferredCandidateIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeStaleDuplicateFindings — loop wins (opposite of doc-truth's dedupe)
// ---------------------------------------------------------------------------

describe('mergeStaleDuplicateFindings', () => {
  it('drops a main-pass finding at the same location and keeps the loop finding', () => {
    const main = [finding({ line: 20, ruleId: 'stale-duplicate', message: 'main freeform' })];
    const loop = [finding({ line: 20, message: 'loop with evidence' })];

    const merged = mergeStaleDuplicateFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('loop with evidence');
    expect(merged[0].ruleId).toBe('stale-duplicate');
  });

  it('dedupes a nearby main-pass stale-duplicate finding (within ±2 lines) but keeps a distant one', () => {
    const main = [
      // distance 1 from the loop finding at line 20, SAME rule → dropped
      finding({ line: 21, ruleId: 'stale-duplicate', message: 'near' }),
      finding({ line: 30, ruleId: 'stale-duplicate', message: 'far' }), // distance 10 → kept
    ];
    const loop = [finding({ line: 20, message: 'loop' })];

    const merged = mergeStaleDuplicateFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['far', 'loop'].sort());
  });

  // Regression coverage for the CodeRabbit finding on this pass's initial
  // version: proximity-only matching could drop an UNRELATED rule's real
  // finding just because it landed near a stale-duplicate loop finding.
  it('does NOT drop a nearby main-pass finding from a DIFFERENT rule (proximity alone is not enough)', () => {
    const main = [finding({ line: 20, ruleId: 'error-swallowing', message: 'unrelated real bug' })];
    const loop = [finding({ line: 20, message: 'loop finding' })];

    const merged = mergeStaleDuplicateFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unrelated real bug']);
  });

  it('does NOT drop a nearby main-pass finding with no ruleId at all', () => {
    const main = [finding({ line: 20, ruleId: undefined, message: 'unattributed' })];
    const loop = [finding({ line: 20, message: 'loop finding' })];

    const merged = mergeStaleDuplicateFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unattributed']);
  });

  it('forces ruleId to stale-duplicate on every loop finding', () => {
    const loop = [finding({ ruleId: undefined, message: 'no-rule' })];
    const merged = mergeStaleDuplicateFindings([], loop);
    expect(merged[0].ruleId).toBe('stale-duplicate');
  });

  it('does not mutate the input arrays', () => {
    const main = [finding({ filepath: 'a.ts', line: 1 })];
    const loop = [finding({ filepath: 'b.ts', line: 1, ruleId: 'x' })];
    mergeStaleDuplicateFindings(main, loop);
    expect(loop[0].ruleId).toBe('x');
    expect(main).toHaveLength(1);
  });

  it('appends a loop finding on a distinct file alongside an unrelated main finding', () => {
    const main = [finding({ filepath: 'a.ts', line: 1, message: 'unrelated' })];
    const loop = [finding({ filepath: 'b.ts', line: 1, message: 'loop' })];
    const merged = mergeStaleDuplicateFindings(main, loop);
    expect(merged.map(f => f.message).sort()).toEqual(['loop', 'unrelated']);
  });
});

// ---------------------------------------------------------------------------
// mergeStaleDuplicateResultState
// ---------------------------------------------------------------------------

describe('mergeStaleDuplicateResultState', () => {
  it('marks the merged result incomplete, naming this pass via incompleteFromPass', () => {
    const main = fakeResult();
    main.incomplete = false;
    main.stopReason = 'completed';
    const loop = fakeResult({ incomplete: true, stopReason: 'incomplete_verdict' });

    mergeStaleDuplicateResultState(main, loop);

    expect(main.incomplete).toBe(true);
    expect(main.stopReason).toBe('incomplete_verdict');
    expect(main.incompleteFromPass).toBe('stale-duplicate');
  });

  it('leaves an already-incomplete main pass untouched (no attribution overwrite)', () => {
    const main = fakeResult({ incomplete: true, stopReason: 'max_turns' });
    const loop = fakeResult({ incomplete: true, stopReason: 'budget' });

    mergeStaleDuplicateResultState(main, loop);

    expect(main.stopReason).toBe('max_turns');
    expect(main.incompleteFromPass).toBeUndefined();
  });

  it('is a no-op when the loop pass is complete or null', () => {
    const main = fakeResult();
    mergeStaleDuplicateResultState(main, fakeResult());
    expect(main.incomplete).toBe(false);

    mergeStaleDuplicateResultState(main, null);
    expect(main.incomplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Main-pass interaction override (LIEN_STALE_DUP_MAIN)
// ---------------------------------------------------------------------------

describe('applyStaleDuplicateMainOverride / isStaleDuplicateMainDisabled', () => {
  it('is unchanged by default (flag unset)', () => {
    expect(isStaleDuplicateMainDisabled()).toBe(false);
    const ctx = eligibleContext();
    const rules = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    const result = applyStaleDuplicateMainOverride(rules);
    expect(result).toBe(rules); // same reference — true no-op
    expect(result.active.map(r => r.id)).toContain('stale-duplicate');
  });

  it('strips stale-duplicate from active and records it as skipped when LIEN_STALE_DUP_MAIN=off', () => {
    process.env.LIEN_STALE_DUP_MAIN = 'off';
    expect(isStaleDuplicateMainDisabled()).toBe(true);
    const ctx = eligibleContext();
    const rules = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    const result = applyStaleDuplicateMainOverride(rules);
    expect(result.active.map(r => r.id)).not.toContain('stale-duplicate');
    expect(result.skipped.some(s => s.includes('stale-duplicate'))).toBe(true);
  });

  it('is unaffected by an unrelated env value', () => {
    process.env.LIEN_STALE_DUP_MAIN = 'on';
    expect(isStaleDuplicateMainDisabled()).toBe(false);
  });

  it("removes the main pass's <stale_literal_candidates> block end-to-end when the override strips the rule", () => {
    const ctx = eligibleContext();
    const rulesOn = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    expect(buildInitialMessage(ctx, { blastRadius: null, rules: rulesOn })).toContain(
      '<stale_literal_candidates>',
    );

    process.env.LIEN_STALE_DUP_MAIN = 'off';
    const rulesOff = applyStaleDuplicateMainOverride(
      selectRules(BUILTIN_RULES, buildTriggerContext(ctx)),
    );
    expect(buildInitialMessage(ctx, { blastRadius: null, rules: rulesOff })).not.toContain(
      '<stale_literal_candidates>',
    );
  });

  it('a caller that never resolves rules (e.g. CLI mode) still gets the block regardless of the flag', () => {
    process.env.LIEN_STALE_DUP_MAIN = 'off';
    const ctx = eligibleContext();
    expect(buildInitialMessage(ctx, { blastRadius: null })).toContain('<stale_literal_candidates>');
  });
});

// ---------------------------------------------------------------------------
// STALE_DUPLICATE_PASS_SPEC (the ReviewPassSpec bundle)
// ---------------------------------------------------------------------------

describe('STALE_DUPLICATE_PASS_SPEC', () => {
  it("wires this module's own pure functions into the ReviewPassSpec contract", () => {
    expect(STALE_DUPLICATE_PASS_SPEC.name).toBe('stale-duplicate-loop');
    expect(STALE_DUPLICATE_PASS_SPEC.skipPlugin).toBe('agent-review:stale-duplicate-loop');
    expect(STALE_DUPLICATE_PASS_SPEC.maxTurns).toBe(STALE_DUP_PASS_MAX_TURNS);
    expect(STALE_DUPLICATE_PASS_SPEC.mergeFindings).toBe(mergeStaleDuplicateFindings);
    expect(STALE_DUPLICATE_PASS_SPEC.mergeResultState).toBe(mergeStaleDuplicateResultState);
    expect(STALE_DUPLICATE_PASS_SPEC.postProcessResult).toBe(postProcessStaleDuplicateResult);
  });

  it('gateReason is staleDuplicateSkipReason', () => {
    const ctx = eligibleContext();
    expect(STALE_DUPLICATE_PASS_SPEC.gateReason(ctx, cfg({ staleDuplicatePass: true }))).toBeNull();
    expect(STALE_DUPLICATE_PASS_SPEC.gateReason(ctx, cfg())).toContain('disabled');
  });

  it('buildPrompts delegates to buildStaleDuplicatePassPrompts', () => {
    const ctx = eligibleContext();
    expect(STALE_DUPLICATE_PASS_SPEC.buildPrompts(ctx)).toEqual(
      buildStaleDuplicatePassPrompts(ctx),
    );
  });

  it('budget delegates to staleDuplicatePassBudget', () => {
    const ctx = eligibleContext();
    expect(STALE_DUPLICATE_PASS_SPEC.budget(100_000, ctx)).toBe(
      staleDuplicatePassBudget(100_000, ctx),
    );
  });
});
