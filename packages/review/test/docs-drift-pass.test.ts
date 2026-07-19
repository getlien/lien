import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import {
  docsDriftSkipReason,
  shouldRunDocsDriftPass,
  isDocsDriftPassEnabled,
  computeDocsDriftPassCandidates,
  computeDocsDriftWorklist,
  buildDocsDriftPassPrompts,
  buildDocsDriftPassInitialMessage,
  docsDriftPassBudget,
  postProcessDocsDriftResult,
  mergeDocsDriftFindings,
  mergeDocsDriftResultState,
  DOCS_DRIFT_PASS_SPEC,
  DOCS_DRIFT_PASS_MAX_TURNS,
  DOCS_DRIFT_RULE_ID,
} from '../src/plugins/agent/docs-drift-pass.js';
import { VERDICT_EMISSION_RESERVE_TOKENS } from '../src/plugins/agent/review-pass.js';
import { createTestContext } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import type { AgentConfig, AgentFinding, AgentResult } from '../src/plugins/agent/types.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function makeDocChunk(file: string, startLine: number, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'doc',
      language: 'markdown',
    },
  } as unknown as CodeChunk;
}

function patch(...lines: string[]): string {
  return lines.join('\n');
}

// ---- drifted shape: removed export still named as current in an untouched doc ----

const API_REMOVE_PATCH = patch('@@ -1,1 +0,0 @@', '-export function oldFunc() {}');

function driftedContext(): ReviewContext {
  const patches = new Map([['src/util.ts', API_REMOVE_PATCH]]);
  const repoChunks = [
    makeDocChunk('docs/util-guide.md', 10, 'The `oldFunc` helper requires a valid config object.'),
  ];
  return createTestContext({
    changedFiles: ['src/util.ts'],
    chunks: [],
    repoChunks,
    pr: {
      title: 'Remove oldFunc',
      body: '',
      patches,
    } as unknown as ReviewContext['pr'],
  });
}

/** No signal fires at all — an ordinary PR that removes nothing exported. */
function noCandidateContext(): ReviewContext {
  const patches = new Map([
    ['src/plain.ts', patch('@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;')],
  ]);
  return createTestContext({
    changedFiles: ['src/plain.ts'],
    chunks: [],
    repoChunks: [],
    pr: { title: 'Trivial change', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

/** 20 independent removed exports, each named once in its own untouched doc file — exercises the
 *  MAX_CANDIDATES (15) cap docs-drift-signals.ts already applies, via its own alphabetical-referand
 *  tiebreak (all Tier-1, no other ordering signal). */
function manyCandidatesContext(): ReviewContext {
  const patches = new Map<string, string>();
  const repoChunks: CodeChunk[] = [];
  for (let i = 0; i < 20; i++) {
    const n = String(i).padStart(2, '0');
    patches.set(`src/f${n}.ts`, patch('@@ -1,1 +0,0 @@', `-export function sym${n}() {}`));
    repoChunks.push(
      makeDocChunk(`docs/notes-${n}.md`, 1, `The \`sym${n}\` helper requires review.`),
    );
  }
  return createTestContext({
    changedFiles: [...patches.keys()],
    chunks: [],
    repoChunks,
    pr: { title: 'Remove many exports', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Record<string, unknown> = {}): AgentFinding {
  return {
    filepath: 'docs/util-guide.md',
    line: 10,
    severity: 'warning',
    category: 'docs_drift',
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

// Restore caller state rather than unconditionally deleting.
let previousDocsDriftPass: string | undefined;

beforeEach(() => {
  previousDocsDriftPass = process.env.LIEN_DOCS_DRIFT_PASS;
  delete process.env.LIEN_DOCS_DRIFT_PASS;
});

afterEach(() => {
  if (previousDocsDriftPass === undefined) delete process.env.LIEN_DOCS_DRIFT_PASS;
  else process.env.LIEN_DOCS_DRIFT_PASS = previousDocsDriftPass;
});

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

describe('docsDriftSkipReason / shouldRunDocsDriftPass', () => {
  it('is false (disabled) by default, even with an eligible candidate — ships dark', () => {
    const ctx = driftedContext();
    expect(shouldRunDocsDriftPass(ctx, cfg())).toBe(false);
    expect(docsDriftSkipReason(ctx, cfg())).toContain('disabled');
  });

  it('is true when opted in via config AND a docs-drift candidate exists', () => {
    const ctx = driftedContext();
    expect(shouldRunDocsDriftPass(ctx, cfg({ docsDriftPass: true }))).toBe(true);
  });

  it('is true when opted in via LIEN_DOCS_DRIFT_PASS=on (no config flag)', () => {
    process.env.LIEN_DOCS_DRIFT_PASS = 'on';
    const ctx = driftedContext();
    expect(shouldRunDocsDriftPass(ctx, cfg())).toBe(true);
  });

  it('is false when opted in but no untouched-doc reference exists', () => {
    const ctx = noCandidateContext();
    const reason = docsDriftSkipReason(ctx, cfg({ docsDriftPass: true }));
    expect(reason).toContain('no untouched-doc reference');
  });

  it('is false when there are no patches at all, even when opted in', () => {
    expect(shouldRunDocsDriftPass(createTestContext(), cfg({ docsDriftPass: true }))).toBe(false);
  });

  it('isDocsDriftPassEnabled: config takes precedence, then env', () => {
    expect(isDocsDriftPassEnabled(cfg())).toBe(false);
    expect(isDocsDriftPassEnabled(cfg({ docsDriftPass: true }))).toBe(true);
    process.env.LIEN_DOCS_DRIFT_PASS = 'on';
    expect(isDocsDriftPassEnabled(cfg())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Candidate worklist (reuses docs-drift-signals.ts; already capped/sorted)
// ---------------------------------------------------------------------------

describe('computeDocsDriftPassCandidates', () => {
  it('builds one candidate from a removed export named in an untouched claim line', () => {
    const candidates = computeDocsDriftPassCandidates(driftedContext());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].referand).toBe('oldFunc');
    expect(candidates[0].referandKind).toBe('removed-export');
    expect(candidates[0].docFile).toBe('docs/util-guide.md');
  });

  it('returns [] for a context with no docs-drift candidate', () => {
    expect(computeDocsDriftPassCandidates(noCandidateContext())).toEqual([]);
  });

  it('caps the candidate list at 15 (docs-drift-signals.ts MAX_CANDIDATES)', () => {
    const candidates = computeDocsDriftPassCandidates(manyCandidatesContext());
    expect(candidates).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// computeDocsDriftWorklist — candidate-overflow rank-and-cap
// ---------------------------------------------------------------------------

describe('computeDocsDriftWorklist', () => {
  it('defaults to unlimited budget — defers nothing (byte-identical to before this feature existed)', () => {
    const { candidates, deferredCount, deferredIds } =
      computeDocsDriftWorklist(manyCandidatesContext());
    expect(candidates).toHaveLength(15);
    expect(deferredCount).toBe(0);
    expect(deferredIds).toEqual([]);
  });

  it("caps to the ceiling and defers the remainder, preserving the signal's own (referand) order", () => {
    const ctx = manyCandidatesContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2
    const { candidates, deferredCount, deferredIds } = computeDocsDriftWorklist(ctx, budget);
    expect(candidates.map(c => c.referand)).toEqual(['sym00', 'sym01']);
    expect(deferredCount).toBe(13);
    expect(deferredIds).toEqual([
      'sym02',
      'sym03',
      'sym04',
      'sym05',
      'sym06',
      'sym07',
      'sym08',
      'sym09',
      'sym10',
      'sym11',
    ]); // capped at MAX_DEFERRED_LABELS (10) even though 13 were deferred
  });

  it("a single-candidate context is never capped at this pass's own real (floor) budget", () => {
    const ctx = driftedContext();
    const budget = docsDriftPassBudget(100_000, ctx);
    const { candidates, deferredCount } = computeDocsDriftWorklist(ctx, budget);
    expect(candidates).toHaveLength(1);
    expect(deferredCount).toBe(0);
  });

  // Byte-diff census: a realistic (low-candidate) real-PR shape at its ACTUAL production budget
  // must produce prompt output byte-identical to the pre-feature default call.
  it('byte-diff census: the ordinary single-candidate real-PR shape is unaffected at the real budget', () => {
    const ctx = driftedContext();
    const realBudget = docsDriftPassBudget(100_000, ctx);
    expect(buildDocsDriftPassPrompts(ctx, realBudget)).toEqual(buildDocsDriftPassPrompts(ctx));
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('buildDocsDriftPassPrompts', () => {
  it('hard-cuts the tool list to read_file + grep_codebase only', () => {
    const { systemPrompt } = buildDocsDriftPassPrompts(driftedContext());
    expect(systemPrompt).toContain('read_file');
    expect(systemPrompt).toContain('grep_codebase');
    expect(systemPrompt).not.toContain('get_files_context');
    expect(systemPrompt).not.toContain('get_dependents');
    expect(systemPrompt).not.toContain('list_functions');
    expect(systemPrompt).not.toContain('get_complexity');
  });

  it("includes a loop-scoped strategy and a docs-drift-shaped example, not another pass's prompt", () => {
    const { systemPrompt } = buildDocsDriftPassPrompts(driftedContext());
    expect(systemPrompt).toContain('Docs Drift');
    expect(systemPrompt).toContain('untouched doc presents a removed symbol as current');
    expect(systemPrompt).not.toContain('Structural Analysis');
    expect(systemPrompt).not.toContain('Stale Duplicate Literal Check');
    expect(systemPrompt).not.toContain('Incomplete Handling Check');
  });

  it('includes the historical/intentional false-positive verdict guidance', () => {
    const { systemPrompt } = buildDocsDriftPassPrompts(driftedContext());
    expect(systemPrompt).toContain('verdict_guidance');
    expect(systemPrompt).toContain('historical');
    expect(systemPrompt).toContain('intentional');
  });

  it('requires one findings-array entry per candidate id with the four-value verdict vocabulary', () => {
    const { systemPrompt } = buildDocsDriftPassPrompts(driftedContext());
    expect(systemPrompt).toContain('candidateId');
    expect(systemPrompt).toContain('drifted | historical | intentional | unverifiable');
    expect(systemPrompt).toContain('candidate-1');
  });

  it('names category among the required fields, not just in the illustrative example', () => {
    const { systemPrompt } = buildDocsDriftPassPrompts(driftedContext());
    const requiredFieldsSentence = systemPrompt
      .split('\n')
      .find(line => line.startsWith('EVERY entry requires'));
    expect(requiredFieldsSentence).toBeDefined();
    expect(requiredFieldsSentence).toContain('category');
  });

  it('builds an initial message with the <docs_drift> worklist tag', () => {
    const message = buildDocsDriftPassInitialMessage(driftedContext());
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('<docs_drift>');
    expect(message).toContain('oldFunc');
    expect(message).toContain('docs/util-guide.md:10');
  });

  it('renders the removal diff hunk (code side) when re-derivable from the diff', () => {
    const message = buildDocsDriftPassInitialMessage(driftedContext());
    expect(message).toContain('```diff');
    expect(message).toContain('-export function oldFunc');
  });

  it('renders the doc excerpt in a fence', () => {
    const message = buildDocsDriftPassInitialMessage(driftedContext());
    expect(message).toContain('requires a valid config object');
  });

  it('does not include competing signal blocks (blast radius, doc claims, stale literal, etc.)', () => {
    const message = buildDocsDriftPassInitialMessage(driftedContext());
    expect(message).not.toContain('<blast_radius>');
    expect(message).not.toContain('<doc_claims>');
    expect(message).not.toContain('<stale_literal_candidates>');
    expect(message).not.toContain('<removed_exports>');
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: contract text differs ONLY when the worklist was capped
  // -------------------------------------------------------------------------

  it('is byte-identical to before this feature existed when the budget is not passed (default unlimited)', () => {
    const ctx = manyCandidatesContext();
    const withBudget = buildDocsDriftPassPrompts(ctx, Number.POSITIVE_INFINITY);
    const withoutBudget = buildDocsDriftPassPrompts(ctx);
    expect(withoutBudget).toEqual(withBudget);
    expect(withoutBudget.initialMessage).not.toContain('CANDIDATE OVERFLOW');
  });

  it('lists only the affordable candidates and appends the overflow note when the budget caps the worklist', () => {
    const ctx = manyCandidatesContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const { systemPrompt, initialMessage } = buildDocsDriftPassPrompts(ctx, budget);
    expect(systemPrompt).toContain('candidate-1');
    expect(systemPrompt).toContain('candidate-2');
    expect(systemPrompt).not.toContain('candidate-3');
    expect(initialMessage).toContain('sym00');
    expect(initialMessage).toContain('sym01');
    expect(initialMessage).not.toContain('sym02');
    expect(initialMessage).toContain('CANDIDATE OVERFLOW');
    expect(initialMessage).toContain('13 additional eligible candidate(s)');
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('docsDriftPassBudget', () => {
  it('scales with candidate count, clamped to the shared one-round-trip floor for a single candidate', () => {
    const budget = docsDriftPassBudget(100_000, driftedContext());
    // 1 candidate: 2000 + 800*1 = 2800, clamped up to the 11,000 shared floor.
    expect(budget).toBe(11_000);
  });

  it('is independent of the main pass base budget (candidate-count driven, not a fraction)', () => {
    const low = docsDriftPassBudget(10_000, manyCandidatesContext());
    const high = docsDriftPassBudget(500_000, manyCandidatesContext());
    expect(low).toBe(high);
  });

  it('scales past the floor once candidate count is high enough', () => {
    // 15 candidates (the cap): 2000 + 800*15 = 14000 > 11,000 floor.
    const budget = docsDriftPassBudget(100_000, manyCandidatesContext());
    expect(budget).toBe(14_000);
  });

  it('turn cap is exported and equals DOCS_DRIFT_PASS_MAX_TURNS', () => {
    expect(DOCS_DRIFT_PASS_SPEC.maxTurns).toBe(DOCS_DRIFT_PASS_MAX_TURNS);
  });
});

// ---------------------------------------------------------------------------
// postProcessDocsDriftResult
// ---------------------------------------------------------------------------

describe('postProcessDocsDriftResult', () => {
  it('keeps only verdict:"drifted" entries as real findings, stripping candidateId/verdict', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'drifted', message: 'real drift' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe('real drift');
    expect((result.findings[0] as Record<string, unknown>).candidateId).toBeUndefined();
    expect((result.findings[0] as Record<string, unknown>).verdict).toBeUndefined();
  });

  it('drops historical/intentional/unverifiable verdicts entirely', () => {
    for (const verdict of ['historical', 'intentional', 'unverifiable']) {
      const raw = fakeResult({
        findings: [finding({ candidateId: 'candidate-1', verdict, message: 'not drift' })],
      });
      const result = postProcessDocsDriftResult(raw, driftedContext());
      expect(result.findings).toHaveLength(0);
    }
  });

  it('is complete when the single candidate got a recognized verdict', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'intentional' })],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
  });

  it('marks the result incomplete with stopReason "incomplete_verdict" when a candidate id is missing', () => {
    const raw = fakeResult({ findings: [] }); // candidate-1 never got a verdict
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('keeps the ORIGINAL stopReason when the client was already incomplete for a real reason', () => {
    const raw = fakeResult({ findings: [], incomplete: true, stopReason: 'budget' });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('budget');
  });

  it('does not mutate the input result', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'drifted' })],
    });
    postProcessDocsDriftResult(raw, driftedContext());
    expect(raw.findings).toHaveLength(1);
    expect((raw.findings[0] as Record<string, unknown>).candidateId).toBe('candidate-1');
  });

  it('is incomplete when a candidate id is present but its verdict is missing', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: undefined, message: 'no verdict' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0);
  });

  it('is incomplete when a candidate id is present but its verdict is not a recognized value', () => {
    const raw = fakeResult({
      findings: [
        finding({
          candidateId: 'candidate-1',
          verdict: 'maybe-drifted' as never,
          message: 'bogus',
        }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when the same candidate id is verdicted twice (duplicate, not "covered")', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable', message: 'first' }),
        finding({ candidateId: 'candidate-1', verdict: 'drifted', message: 'second' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when an entry names a candidate id outside the worklist, and the phantom never leaks through', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({ candidateId: 'candidate-99', verdict: 'drifted', message: 'phantom candidate' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: deferral is attested, NOT incompleteness
  // -------------------------------------------------------------------------

  it('stamps candidatesDeferred/deferredCandidateIds when the budget capped the worklist', () => {
    const ctx = manyCandidatesContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'intentional' }),
        finding({ candidateId: 'candidate-2', verdict: 'intentional' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, ctx, budget);
    expect(result.candidatesDeferred).toBe(13);
    expect(result.deferredCandidateIds).toHaveLength(10); // capped at MAX_DEFERRED_LABELS
    expect(result.deferredCandidateIds![0]).toBe('sym02');
  });

  it('a capped-but-complete run (every LISTED candidate verdicted) stays incomplete:false — deferral is not incompleteness', () => {
    const ctx = manyCandidatesContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'intentional' }),
        finding({ candidateId: 'candidate-2', verdict: 'intentional' }),
      ],
    });
    const result = postProcessDocsDriftResult(raw, ctx, budget);
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
    expect(result.candidatesDeferred).toBe(13);
  });

  it('reports candidatesDeferred: 0 and no deferredCandidateIds when nothing was capped (default budget)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'intentional' })],
    });
    const result = postProcessDocsDriftResult(raw, driftedContext());
    expect(result.candidatesDeferred).toBe(0);
    expect(result.deferredCandidateIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeDocsDriftFindings — loop wins on own-ruleId collision; doc-truth wins cross-dedup
// ---------------------------------------------------------------------------

describe('mergeDocsDriftFindings', () => {
  it('drops a same-ruleId main-pass finding at the same location and keeps the loop finding', () => {
    const main = [finding({ line: 10, ruleId: DOCS_DRIFT_RULE_ID, message: 'stale main copy' })];
    const loop = [finding({ line: 10, message: 'loop with evidence' })];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('loop with evidence');
    expect(merged[0].ruleId).toBe(DOCS_DRIFT_RULE_ID);
  });

  it('dedupes a nearby same-ruleId main-pass finding (within ±2 lines) but keeps a distant one', () => {
    const main = [
      finding({ line: 11, ruleId: DOCS_DRIFT_RULE_ID, message: 'near' }),
      finding({ line: 40, ruleId: DOCS_DRIFT_RULE_ID, message: 'far, unrelated' }),
    ];
    const loop = [finding({ line: 10, message: 'loop' })];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['far, unrelated', 'loop'].sort());
  });

  it('does NOT drop a nearby main-pass finding from a DIFFERENT rule (proximity alone is not enough)', () => {
    const main = [finding({ line: 10, ruleId: 'error-swallowing', message: 'unrelated real bug' })];
    const loop = [finding({ line: 10, message: 'loop finding' })];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unrelated real bug']);
  });

  it('does NOT drop a nearby main-pass finding with no ruleId at all', () => {
    const main = [finding({ line: 10, ruleId: undefined, message: 'unattributed' })];
    const loop = [finding({ line: 10, message: 'loop finding' })];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unattributed']);
  });

  it('forces ruleId to docs-drift on every loop finding', () => {
    const loop = [finding({ ruleId: undefined, message: 'no-rule' })];
    const merged = mergeDocsDriftFindings([], loop);
    expect(merged[0].ruleId).toBe(DOCS_DRIFT_RULE_ID);
  });

  it('does not mutate the input arrays', () => {
    const main = [finding({ filepath: 'a.md', line: 1 })];
    const loop = [finding({ filepath: 'b.md', line: 1, ruleId: 'x' })];
    mergeDocsDriftFindings(main, loop);
    expect(loop[0].ruleId).toBe('x');
    expect(main).toHaveLength(1);
  });

  it('appends a loop finding on a distinct file alongside an unrelated main finding', () => {
    const main = [finding({ filepath: 'a.md', line: 1, message: 'unrelated' })];
    const loop = [finding({ filepath: 'b.md', line: 1, message: 'loop' })];
    const merged = mergeDocsDriftFindings(main, loop);
    expect(merged.map(f => f.message).sort()).toEqual(['loop', 'unrelated']);
  });

  // -------------------------------------------------------------------------
  // Cross-dedup vs doc-truth: doc-truth wins (design §2's "both-fire case" backstop)
  // -------------------------------------------------------------------------

  it('drops a docs-drift loop finding whose location collides with an existing doc-truth finding', () => {
    const main = [
      finding({
        filepath: 'docs/util-guide.md',
        line: 10,
        ruleId: 'doc-truth',
        message: 'doc-truth saw it first',
      }),
    ];
    const loop = [
      finding({ filepath: 'docs/util-guide.md', line: 11, message: 'docs-drift also flagged it' }),
    ];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('doc-truth saw it first');
    expect(merged[0].ruleId).toBe('doc-truth');
  });

  it('keeps a docs-drift loop finding that does NOT collide with any doc-truth finding', () => {
    const main = [
      finding({
        filepath: 'docs/other.md',
        line: 5,
        ruleId: 'doc-truth',
        message: 'unrelated doc-truth finding',
      }),
    ];
    const loop = [finding({ filepath: 'docs/util-guide.md', line: 10, message: 'real drift' })];

    const merged = mergeDocsDriftFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual([
      'real drift',
      'unrelated doc-truth finding',
    ]);
  });

  it('keeps the doc-truth main finding itself untouched by the cross-dedup', () => {
    const main = [
      finding({ filepath: 'docs/util-guide.md', line: 10, ruleId: 'doc-truth', message: 'kept' }),
    ];
    const merged = mergeDocsDriftFindings(main, []);
    expect(merged).toEqual(main);
  });
});

// ---------------------------------------------------------------------------
// mergeDocsDriftResultState
// ---------------------------------------------------------------------------

describe('mergeDocsDriftResultState', () => {
  it('marks the merged result incomplete, naming this pass via incompleteFromPass', () => {
    const main = fakeResult();
    main.incomplete = false;
    main.stopReason = 'completed';
    const loop = fakeResult({ incomplete: true, stopReason: 'incomplete_verdict' });

    mergeDocsDriftResultState(main, loop);

    expect(main.incomplete).toBe(true);
    expect(main.stopReason).toBe('incomplete_verdict');
    expect(main.incompleteFromPass).toBe('docs-drift');
  });

  it('leaves an already-incomplete main pass untouched (no attribution overwrite)', () => {
    const main = fakeResult({ incomplete: true, stopReason: 'max_turns' });
    const loop = fakeResult({ incomplete: true, stopReason: 'budget' });

    mergeDocsDriftResultState(main, loop);

    expect(main.stopReason).toBe('max_turns');
    expect(main.incompleteFromPass).toBeUndefined();
  });

  it('is a no-op when the loop pass is complete or null', () => {
    const main = fakeResult();
    mergeDocsDriftResultState(main, fakeResult());
    expect(main.incomplete).toBe(false);

    mergeDocsDriftResultState(main, null);
    expect(main.incomplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DOCS_DRIFT_PASS_SPEC (the ReviewPassSpec bundle)
// ---------------------------------------------------------------------------

describe('DOCS_DRIFT_PASS_SPEC', () => {
  it("wires this module's own pure functions into the ReviewPassSpec contract", () => {
    expect(DOCS_DRIFT_PASS_SPEC.name).toBe('docs-drift-loop');
    expect(DOCS_DRIFT_PASS_SPEC.skipPlugin).toBe('agent-review:docs-drift-loop');
    expect(DOCS_DRIFT_PASS_SPEC.maxTurns).toBe(DOCS_DRIFT_PASS_MAX_TURNS);
    expect(DOCS_DRIFT_PASS_SPEC.mergeFindings).toBe(mergeDocsDriftFindings);
    expect(DOCS_DRIFT_PASS_SPEC.mergeResultState).toBe(mergeDocsDriftResultState);
    expect(DOCS_DRIFT_PASS_SPEC.postProcessResult).toBe(postProcessDocsDriftResult);
  });

  it('gateReason is docsDriftSkipReason', () => {
    const ctx = driftedContext();
    expect(DOCS_DRIFT_PASS_SPEC.gateReason(ctx, cfg({ docsDriftPass: true }))).toBeNull();
    expect(DOCS_DRIFT_PASS_SPEC.gateReason(ctx, cfg())).toContain('disabled');
  });

  it('buildPrompts delegates to buildDocsDriftPassPrompts', () => {
    const ctx = driftedContext();
    expect(DOCS_DRIFT_PASS_SPEC.buildPrompts(ctx, docsDriftPassBudget(100_000, ctx))).toEqual(
      buildDocsDriftPassPrompts(ctx, docsDriftPassBudget(100_000, ctx)),
    );
  });

  it('budget delegates to docsDriftPassBudget', () => {
    const ctx = driftedContext();
    expect(DOCS_DRIFT_PASS_SPEC.budget(100_000, ctx)).toBe(docsDriftPassBudget(100_000, ctx));
  });
});
