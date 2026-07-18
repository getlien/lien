import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import {
  removedExportsSkipReason,
  shouldRunRemovedExportsPass,
  isRemovedExportsPassEnabled,
  computeRemovedExportsCandidates,
  computeRemovedExportsWorklist,
  buildRemovedExportsPassPrompts,
  buildRemovedExportsPassInitialMessage,
  removedExportsPassBudget,
  postProcessRemovedExportsResult,
  mergeRemovedExportsFindings,
  mergeRemovedExportsResultState,
  REMOVED_EXPORTS_PASS_SPEC,
  REMOVED_EXPORTS_PASS_MAX_TURNS,
  STRUCTURAL_ANALYSIS_RULE_ID,
} from '../src/plugins/agent/removed-exports-pass.js';
import { BUILTIN_RULES, buildTriggerContext, selectRules } from '../src/plugins/agent/rules.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';
import { VERDICT_EMISSION_RESERVE_TOKENS } from '../src/plugins/agent/review-pass.js';
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
      type: 'block',
      language: 'typescript',
    },
  } as unknown as CodeChunk;
}

function patch(...lines: string[]): string {
  return lines.join('\n');
}

// ---- breaking shape: removed export still called from a different file ----

const API_REMOVE_PATCH = patch(
  '@@ -1,3 +0,0 @@',
  '-export function fetchUser(id: string) {',
  '-  return db.get(id);',
  '-}',
);

const CONSUMER_CONTENT = [
  'function loadProfile(id: string) {',
  '  return fetchUser(id);',
  '}',
].join('\n');

function breakingOnlyContext(): ReviewContext {
  const patches = new Map([['src/api.ts', API_REMOVE_PATCH]]);
  const repoChunks = [makeChunk('src/consumer.ts', 1, CONSUMER_CONTENT)];
  return createTestContext({
    changedFiles: ['src/api.ts'],
    chunks: [],
    repoChunks,
    pr: {
      title: 'Remove fetchUser',
      body: '',
      patches,
    } as unknown as ReviewContext['pr'],
  });
}

// ---- changeset-documented shape: removal accompanied by a changeset entry ----

const WIDGET_REMOVE_PATCH = patch('@@ -1,1 +0,0 @@', '-export function widget() {}');
const CHANGESET_PATCH = patch(
  '@@ -0,0 +1,4 @@',
  '+---',
  "+'@liendev/core': minor",
  '+---',
  '+',
  '+Removed `widget` — use `newWidget` instead.',
);

function changesetDocumentedContext(): ReviewContext {
  const patches = new Map([
    ['src/widget.ts', WIDGET_REMOVE_PATCH],
    ['.changeset/silly-otters-jump.md', CHANGESET_PATCH],
  ]);
  return createTestContext({
    changedFiles: ['src/widget.ts', '.changeset/silly-otters-jump.md'],
    chunks: [],
    repoChunks: [],
    pr: {
      title: 'Remove widget (documented)',
      body: '',
      patches,
    } as unknown as ReviewContext['pr'],
  });
}

// ---- rename shape: removed in one file, re-added (same symbol) in another ----

function renameContext(): ReviewContext {
  const patches = new Map([
    ['src/old.ts', patch('@@ -1,1 +0,0 @@', '-export function widget() {}')],
    ['src/new.ts', patch('@@ -0,0 +1,1 @@', '+export function widget() {}')],
  ]);
  return createTestContext({
    changedFiles: ['src/old.ts', 'src/new.ts'],
    chunks: [],
    repoChunks: [],
    pr: { title: 'Move widget', body: '', patches } as unknown as ReviewContext['pr'],
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

/** 20 independent removed exports (no surviving refs, no changesets) — exercises
 * the MAX_CANDIDATES (15) cap deterministically via the shared signal's own
 * alphabetical tiebreak (no refs/changeset to sort by). */
function manyRemovalsContext(): ReviewContext {
  const patches = new Map<string, string>();
  for (let i = 0; i < 20; i++) {
    const n = String(i).padStart(2, '0');
    patches.set(`src/f${n}.ts`, patch('@@ -1,1 +0,0 @@', `-export function sym${n}() {}`));
  }
  return createTestContext({
    changedFiles: [...patches.keys()],
    chunks: [],
    repoChunks: [],
    pr: { title: 'Remove many exports', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Record<string, unknown> = {}): AgentFinding {
  return {
    filepath: 'src/consumer.ts',
    line: 4,
    severity: 'error',
    category: 'breaking_change',
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
let previousRemovedExportsPass: string | undefined;

beforeEach(() => {
  previousRemovedExportsPass = process.env.LIEN_REMOVED_EXPORTS_PASS;
  delete process.env.LIEN_REMOVED_EXPORTS_PASS;
});

afterEach(() => {
  if (previousRemovedExportsPass === undefined) delete process.env.LIEN_REMOVED_EXPORTS_PASS;
  else process.env.LIEN_REMOVED_EXPORTS_PASS = previousRemovedExportsPass;
});

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

describe('removedExportsSkipReason / shouldRunRemovedExportsPass', () => {
  it('is false (disabled) by default, even with an eligible candidate — ships dark', () => {
    const ctx = breakingOnlyContext();
    expect(shouldRunRemovedExportsPass(ctx, cfg())).toBe(false);
    expect(removedExportsSkipReason(ctx, cfg())).toContain('disabled');
  });

  it('is true when opted in via config AND a removed export exists', () => {
    const ctx = breakingOnlyContext();
    expect(shouldRunRemovedExportsPass(ctx, cfg({ removedExportsPass: true }))).toBe(true);
  });

  it('is true when opted in via LIEN_REMOVED_EXPORTS_PASS=on (no config flag)', () => {
    process.env.LIEN_REMOVED_EXPORTS_PASS = 'on';
    const ctx = breakingOnlyContext();
    expect(shouldRunRemovedExportsPass(ctx, cfg())).toBe(true);
  });

  it('is false when opted in but no export is removed', () => {
    const ctx = noCandidateContext();
    const reason = removedExportsSkipReason(ctx, cfg({ removedExportsPass: true }));
    expect(reason).toContain('no removed public export');
  });

  it('is false for a rename (removed in one file, re-added elsewhere) even when opted in', () => {
    const ctx = renameContext();
    expect(shouldRunRemovedExportsPass(ctx, cfg({ removedExportsPass: true }))).toBe(false);
  });

  it('is false when there are no patches at all, even when opted in', () => {
    expect(
      shouldRunRemovedExportsPass(createTestContext(), cfg({ removedExportsPass: true })),
    ).toBe(false);
  });

  it('isRemovedExportsPassEnabled: config takes precedence, then env', () => {
    expect(isRemovedExportsPassEnabled(cfg())).toBe(false);
    expect(isRemovedExportsPassEnabled(cfg({ removedExportsPass: true }))).toBe(true);
    process.env.LIEN_REMOVED_EXPORTS_PASS = 'on';
    expect(isRemovedExportsPassEnabled(cfg())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Candidate worklist (reuses removed-export-signals.ts; rename disambiguation)
// ---------------------------------------------------------------------------

describe('computeRemovedExportsCandidates', () => {
  it('builds one candidate from a plain removed export', () => {
    const candidates = computeRemovedExportsCandidates(breakingOnlyContext());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].symbol).toBe('fetchUser');
    expect(candidates[0].file).toBe('src/api.ts');
  });

  it('finds the surviving cross-file reference for a breaking-shaped candidate', () => {
    const candidates = computeRemovedExportsCandidates(breakingOnlyContext());
    expect(candidates[0].survivingReferences).toHaveLength(1);
    expect(candidates[0].survivingReferences[0].file).toBe('src/consumer.ts');
  });

  it('records the changeset file for a documented removal', () => {
    const candidates = computeRemovedExportsCandidates(changesetDocumentedContext());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].symbol).toBe('widget');
    expect(candidates[0].changesetFile).toBe('.changeset/silly-otters-jump.md');
  });

  it('excludes a rename (removed here, re-added elsewhere) — not a real removal', () => {
    expect(computeRemovedExportsCandidates(renameContext())).toEqual([]);
  });

  it('returns [] for a context with no removed export', () => {
    expect(computeRemovedExportsCandidates(noCandidateContext())).toEqual([]);
  });

  it('caps the candidate list at 15 (MAX_CANDIDATES)', () => {
    const candidates = computeRemovedExportsCandidates(manyRemovalsContext());
    expect(candidates).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// computeRemovedExportsWorklist — candidate-overflow rank-and-cap
// ---------------------------------------------------------------------------

describe('computeRemovedExportsWorklist', () => {
  it('defaults to unlimited budget — defers nothing (byte-identical to before this feature existed)', () => {
    const { candidates, deferredCount, deferredIds } =
      computeRemovedExportsWorklist(manyRemovalsContext());
    expect(candidates).toHaveLength(15);
    expect(deferredCount).toBe(0);
    expect(deferredIds).toEqual([]);
  });

  it("caps to the ceiling and defers the remainder, preserving the signal's own (alphabetical) order", () => {
    const ctx = manyRemovalsContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2
    const { candidates, deferredCount, deferredIds } = computeRemovedExportsWorklist(ctx, budget);
    expect(candidates.map(c => c.symbol)).toEqual(['sym00', 'sym01']);
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

  it("reproduces the #813-shaped overflow: 15 candidates at this pass's own scaled budget still defer most of them", () => {
    // 15 candidates: removedExportsPassBudget scales to 2,000 + 800*15 =
    // 14,000 — a "correctly scaled" budget by the OLD prompt-sizing formula,
    // yet confirming each surviving reference needs a real read_file
    // round-trip (module doc: "no inline snippet is attached"), so the
    // realistic ceiling is far smaller than 15.
    const ctx = manyRemovalsContext();
    const budget = removedExportsPassBudget(100_000, ctx);
    expect(budget).toBe(14_000);
    const { candidates, deferredCount } = computeRemovedExportsWorklist(ctx, budget);
    expect(candidates.length).toBeLessThan(15);
    expect(candidates.length + deferredCount).toBe(15);
  });

  it("a single-candidate context is never capped at this pass's own real (floor) budget", () => {
    const ctx = breakingOnlyContext();
    const budget = removedExportsPassBudget(100_000, ctx);
    const { candidates, deferredCount } = computeRemovedExportsWorklist(ctx, budget);
    expect(candidates).toHaveLength(1);
    expect(deferredCount).toBe(0);
  });

  // Byte-diff census: a realistic (low-candidate) real-PR shape at its ACTUAL
  // production budget must produce prompt output byte-identical to the
  // pre-feature default call — overflow handling changes nothing on the
  // common case.
  it('byte-diff census: the ordinary single-candidate real-PR shape is unaffected at the real budget', () => {
    const ctx = breakingOnlyContext();
    const realBudget = removedExportsPassBudget(100_000, ctx);
    expect(buildRemovedExportsPassPrompts(ctx, realBudget)).toEqual(
      buildRemovedExportsPassPrompts(ctx),
    );
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('buildRemovedExportsPassPrompts', () => {
  it('hard-cuts the tool list to read_file + grep_codebase only', () => {
    const { systemPrompt } = buildRemovedExportsPassPrompts(breakingOnlyContext());
    expect(systemPrompt).toContain('read_file');
    expect(systemPrompt).toContain('grep_codebase');
    expect(systemPrompt).not.toContain('get_files_context');
    expect(systemPrompt).not.toContain('get_dependents');
    expect(systemPrompt).not.toContain('list_functions');
    expect(systemPrompt).not.toContain('get_complexity');
  });

  it("includes a loop-scoped strategy and a removed-export-shaped example, not the shared rule's broader prompt", () => {
    const { systemPrompt } = buildRemovedExportsPassPrompts(breakingOnlyContext());
    expect(systemPrompt).toContain('Structural Analysis');
    expect(systemPrompt).toContain('removed export, real caller breaks');
    // The shared rule's own broader-job prompt text names tools this loop's
    // hard-cut toolset doesn't provide — must not leak in verbatim.
    expect(systemPrompt).not.toContain('Use get_files_context on changed files');
    expect(systemPrompt).not.toContain('Use get_dependents on every changed');
    expect(systemPrompt).not.toContain('fetchUser now returns undefined');
    expect(systemPrompt).not.toContain('Stale Duplicate Literal Check');
    expect(systemPrompt).not.toContain('Incomplete Handling Check');
  });

  it('includes the changeset/test-only false-positive verdict guidance', () => {
    const { systemPrompt } = buildRemovedExportsPassPrompts(breakingOnlyContext());
    expect(systemPrompt).toContain('verdict_guidance');
    expect(systemPrompt).toContain('changeset');
    expect(systemPrompt).toContain('internal-only');
  });

  it('requires one findings-array entry per candidate id with the four-value verdict vocabulary', () => {
    const { systemPrompt } = buildRemovedExportsPassPrompts(breakingOnlyContext());
    expect(systemPrompt).toContain('candidateId');
    expect(systemPrompt).toContain('breaking | intentional | internal-only | unverifiable');
    expect(systemPrompt).toContain('candidate-1');
  });

  // Regression for #816 (the pilot/second-loop/doc-truth-v2 fix): a real captured vote had the
  // model omit `category` from every per-claim verdict entry, silently dropping them all at
  // `isValidFinding` (which requires `category`) — because the contract's "EVERY entry
  // requires ..." sentence didn't name it, even though the example JSON above it does. This
  // pass's contract shares the identical sentence shape, so it carries the same latent gap if
  // not fixed here too.
  it('names category among the required fields, not just in the illustrative example', () => {
    const { systemPrompt } = buildRemovedExportsPassPrompts(breakingOnlyContext());
    const requiredFieldsSentence = systemPrompt
      .split('\n')
      .find(line => line.startsWith('EVERY entry requires'));
    expect(requiredFieldsSentence).toBeDefined();
    expect(requiredFieldsSentence).toContain('category');
  });

  it('builds an initial message with the <removed_exports> worklist tag (matches the rule text)', () => {
    const message = buildRemovedExportsPassInitialMessage(breakingOnlyContext());
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('<removed_exports>');
    expect(message).toContain('fetchUser');
    expect(message).toContain('src/consumer.ts:');
  });

  it('renders the removal diff hunk when the patch is available', () => {
    const message = buildRemovedExportsPassInitialMessage(breakingOnlyContext());
    expect(message).toContain('```diff');
    expect(message).toContain('-export function fetchUser');
  });

  it('renders "none found" for a candidate with no surviving reference', () => {
    const message = buildRemovedExportsPassInitialMessage(changesetDocumentedContext());
    expect(message).toContain('none found in the head corpus');
    expect(message).toContain('Changeset: described in .changeset/silly-otters-jump.md');
  });

  it('renders "none found" for the changeset line when no changeset mentions the symbol', () => {
    const message = buildRemovedExportsPassInitialMessage(breakingOnlyContext());
    expect(message).toContain('Changeset: none found mentioning this symbol');
  });

  it('does not include competing signal blocks (blast radius, doc claims, stale literal, etc.)', () => {
    const message = buildRemovedExportsPassInitialMessage(breakingOnlyContext());
    expect(message).not.toContain('<blast_radius>');
    expect(message).not.toContain('<doc_claims>');
    expect(message).not.toContain('<stale_literal_candidates>');
    expect(message).not.toContain('<incomplete_handling_candidates>');
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: contract text differs ONLY when the worklist was capped
  // -------------------------------------------------------------------------

  it('is byte-identical to before this feature existed when the budget is not passed (default unlimited)', () => {
    const ctx = manyRemovalsContext();
    const withBudget = buildRemovedExportsPassPrompts(ctx, Number.POSITIVE_INFINITY);
    const withoutBudget = buildRemovedExportsPassPrompts(ctx);
    expect(withoutBudget).toEqual(withBudget);
    expect(withoutBudget.initialMessage).not.toContain('CANDIDATE OVERFLOW');
  });

  it('lists only the affordable candidates and appends the overflow note when the budget caps the worklist', () => {
    const ctx = manyRemovalsContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const { systemPrompt, initialMessage } = buildRemovedExportsPassPrompts(ctx, budget);
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

describe('removedExportsPassBudget', () => {
  it('scales with candidate count, clamped to the shared one-round-trip floor for a single candidate', () => {
    const budget = removedExportsPassBudget(100_000, breakingOnlyContext());
    // 1 candidate: 2000 + 800*1 = 2800, clamped up to the 11,000 shared floor.
    expect(budget).toBe(11_000);
  });

  it('is independent of the main pass base budget (candidate-count driven, not a fraction)', () => {
    const low = removedExportsPassBudget(10_000, manyRemovalsContext());
    const high = removedExportsPassBudget(500_000, manyRemovalsContext());
    expect(low).toBe(high);
  });

  it('scales past the floor once candidate count is high enough', () => {
    // 15 candidates (the cap): 2000 + 800*15 = 14000 > 11,000 floor.
    const budget = removedExportsPassBudget(100_000, manyRemovalsContext());
    expect(budget).toBe(14_000);
  });

  it('turn cap is exported and equals REMOVED_EXPORTS_PASS_MAX_TURNS', () => {
    expect(REMOVED_EXPORTS_PASS_SPEC.maxTurns).toBe(REMOVED_EXPORTS_PASS_MAX_TURNS);
  });
});

// ---------------------------------------------------------------------------
// postProcessRemovedExportsResult
// ---------------------------------------------------------------------------

describe('postProcessRemovedExportsResult', () => {
  it('keeps only verdict:"breaking" entries as real findings, stripping candidateId/verdict', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'breaking', message: 'real bug' })],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe('real bug');
    expect((result.findings[0] as Record<string, unknown>).candidateId).toBeUndefined();
    expect((result.findings[0] as Record<string, unknown>).verdict).toBeUndefined();
  });

  it('drops intentional/internal-only/unverifiable verdicts entirely', () => {
    for (const verdict of ['intentional', 'internal-only', 'unverifiable']) {
      const raw = fakeResult({
        findings: [finding({ candidateId: 'candidate-1', verdict, message: 'not a bug' })],
      });
      const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
      expect(result.findings).toHaveLength(0);
    }
  });

  it('is complete when the single candidate got a recognized verdict', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'intentional' })],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
  });

  it('marks the result incomplete with stopReason "incomplete_verdict" when a candidate id is missing', () => {
    const raw = fakeResult({ findings: [] }); // candidate-1 never got a verdict
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('keeps the ORIGINAL stopReason when the client was already incomplete for a real reason', () => {
    const raw = fakeResult({ findings: [], incomplete: true, stopReason: 'budget' });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('budget');
  });

  it('does not mutate the input result', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'breaking' })],
    });
    postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(raw.findings).toHaveLength(1);
    expect((raw.findings[0] as Record<string, unknown>).candidateId).toBe('candidate-1');
  });

  it('is incomplete when a candidate id is present but its verdict is missing', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: undefined, message: 'no verdict' }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0);
  });

  it('is incomplete when a candidate id is present but its verdict is not a recognized value', () => {
    const raw = fakeResult({
      findings: [
        finding({
          candidateId: 'candidate-1',
          verdict: 'maybe-breaking' as never,
          message: 'bogus',
        }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when the same candidate id is verdicted twice (duplicate, not "covered")', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable', message: 'first' }),
        finding({ candidateId: 'candidate-1', verdict: 'breaking', message: 'second' }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when an entry names a candidate id outside the worklist, and the phantom never leaks through', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({ candidateId: 'candidate-99', verdict: 'breaking', message: 'phantom candidate' }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: deferral is attested, NOT incompleteness
  // -------------------------------------------------------------------------

  it('stamps candidatesDeferred/deferredCandidateIds when the budget capped the worklist', () => {
    const ctx = manyRemovalsContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'internal-only' }),
        finding({ candidateId: 'candidate-2', verdict: 'internal-only' }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, ctx, budget);
    expect(result.candidatesDeferred).toBe(13);
    expect(result.deferredCandidateIds).toHaveLength(10); // capped at MAX_DEFERRED_LABELS
    expect(result.deferredCandidateIds![0]).toBe('sym02');
  });

  it('a capped-but-complete run (every LISTED candidate verdicted) stays incomplete:false — deferral is not incompleteness', () => {
    const ctx = manyRemovalsContext();
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 6_000; // affords 2 of 15
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'internal-only' }),
        finding({ candidateId: 'candidate-2', verdict: 'internal-only' }),
      ],
    });
    const result = postProcessRemovedExportsResult(raw, ctx, budget);
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
    expect(result.candidatesDeferred).toBe(13);
  });

  it('reports candidatesDeferred: 0 and no deferredCandidateIds when nothing was capped (default budget)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'internal-only' })],
    });
    const result = postProcessRemovedExportsResult(raw, breakingOnlyContext());
    expect(result.candidatesDeferred).toBe(0);
    expect(result.deferredCandidateIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeRemovedExportsFindings — loop wins, on same-export identity too
// ---------------------------------------------------------------------------

describe('mergeRemovedExportsFindings', () => {
  it('drops a main-pass finding at the same location and keeps the loop finding', () => {
    const main = [
      finding({ line: 4, ruleId: STRUCTURAL_ANALYSIS_RULE_ID, message: 'main freeform' }),
    ];
    const loop = [finding({ line: 4, message: 'loop with evidence' })];

    const merged = mergeRemovedExportsFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('loop with evidence');
    expect(merged[0].ruleId).toBe(STRUCTURAL_ANALYSIS_RULE_ID);
  });

  it('dedupes a nearby main-pass structural-analysis finding (within ±2 lines) but keeps a distant one', () => {
    const main = [
      finding({ line: 5, ruleId: STRUCTURAL_ANALYSIS_RULE_ID, message: 'near' }),
      finding({ line: 40, ruleId: STRUCTURAL_ANALYSIS_RULE_ID, message: 'far, unrelated symbol' }),
    ];
    const loop = [finding({ line: 4, message: 'loop' })];

    const merged = mergeRemovedExportsFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['far, unrelated symbol', 'loop'].sort());
  });

  it('drops a same-file, DISTANT main-pass finding when symbolName matches (identity beats proximity)', () => {
    const main = [
      finding({
        line: 300,
        ruleId: STRUCTURAL_ANALYSIS_RULE_ID,
        symbolName: 'fetchUser',
        message: 'main, far away but same export',
      }),
    ];
    const loop = [finding({ line: 4, symbolName: 'fetchUser', message: 'loop with evidence' })];

    const merged = mergeRemovedExportsFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('loop with evidence');
  });

  it('does NOT drop a nearby main-pass finding from a DIFFERENT rule (proximity alone is not enough)', () => {
    const main = [finding({ line: 4, ruleId: 'error-swallowing', message: 'unrelated real bug' })];
    const loop = [finding({ line: 4, message: 'loop finding' })];

    const merged = mergeRemovedExportsFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unrelated real bug']);
  });

  it('does NOT drop a nearby main-pass finding with no ruleId at all', () => {
    const main = [finding({ line: 4, ruleId: undefined, message: 'unattributed' })];
    const loop = [finding({ line: 4, message: 'loop finding' })];

    const merged = mergeRemovedExportsFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unattributed']);
  });

  it('forces ruleId to structural-analysis on every loop finding', () => {
    const loop = [finding({ ruleId: undefined, message: 'no-rule' })];
    const merged = mergeRemovedExportsFindings([], loop);
    expect(merged[0].ruleId).toBe(STRUCTURAL_ANALYSIS_RULE_ID);
  });

  it('does not mutate the input arrays', () => {
    const main = [finding({ filepath: 'a.ts', line: 1 })];
    const loop = [finding({ filepath: 'b.ts', line: 1, ruleId: 'x' })];
    mergeRemovedExportsFindings(main, loop);
    expect(loop[0].ruleId).toBe('x');
    expect(main).toHaveLength(1);
  });

  it('appends a loop finding on a distinct file alongside an unrelated main finding', () => {
    const main = [finding({ filepath: 'a.ts', line: 1, message: 'unrelated' })];
    const loop = [finding({ filepath: 'b.ts', line: 1, message: 'loop' })];
    const merged = mergeRemovedExportsFindings(main, loop);
    expect(merged.map(f => f.message).sort()).toEqual(['loop', 'unrelated']);
  });
});

// ---------------------------------------------------------------------------
// mergeRemovedExportsResultState
// ---------------------------------------------------------------------------

describe('mergeRemovedExportsResultState', () => {
  it('marks the merged result incomplete, naming this pass via incompleteFromPass', () => {
    const main = fakeResult();
    main.incomplete = false;
    main.stopReason = 'completed';
    const loop = fakeResult({ incomplete: true, stopReason: 'incomplete_verdict' });

    mergeRemovedExportsResultState(main, loop);

    expect(main.incomplete).toBe(true);
    expect(main.stopReason).toBe('incomplete_verdict');
    expect(main.incompleteFromPass).toBe('removed-exports');
  });

  it('leaves an already-incomplete main pass untouched (no attribution overwrite)', () => {
    const main = fakeResult({ incomplete: true, stopReason: 'max_turns' });
    const loop = fakeResult({ incomplete: true, stopReason: 'budget' });

    mergeRemovedExportsResultState(main, loop);

    expect(main.stopReason).toBe('max_turns');
    expect(main.incompleteFromPass).toBeUndefined();
  });

  it('is a no-op when the loop pass is complete or null', () => {
    const main = fakeResult();
    mergeRemovedExportsResultState(main, fakeResult());
    expect(main.incomplete).toBe(false);

    mergeRemovedExportsResultState(main, null);
    expect(main.incomplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No main-pass override: <removed_exports> always stays in the main pass
// ---------------------------------------------------------------------------

describe('structural-analysis has no main-pass override (hybrid, not full graduation)', () => {
  it('renders <removed_exports> in the main pass regardless of this loop being enabled', () => {
    const ctx = breakingOnlyContext();
    const rules = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    const message = buildInitialMessage(ctx, { blastRadius: null, rules });
    expect(message).toContain('<removed_exports>');
    expect(rules.active.map(r => r.id)).toContain('structural-analysis');
  });
});

// ---------------------------------------------------------------------------
// REMOVED_EXPORTS_PASS_SPEC (the ReviewPassSpec bundle)
// ---------------------------------------------------------------------------

describe('REMOVED_EXPORTS_PASS_SPEC', () => {
  it("wires this module's own pure functions into the ReviewPassSpec contract", () => {
    expect(REMOVED_EXPORTS_PASS_SPEC.name).toBe('removed-exports-loop');
    expect(REMOVED_EXPORTS_PASS_SPEC.skipPlugin).toBe('agent-review:removed-exports-loop');
    expect(REMOVED_EXPORTS_PASS_SPEC.maxTurns).toBe(REMOVED_EXPORTS_PASS_MAX_TURNS);
    expect(REMOVED_EXPORTS_PASS_SPEC.mergeFindings).toBe(mergeRemovedExportsFindings);
    expect(REMOVED_EXPORTS_PASS_SPEC.mergeResultState).toBe(mergeRemovedExportsResultState);
    expect(REMOVED_EXPORTS_PASS_SPEC.postProcessResult).toBe(postProcessRemovedExportsResult);
  });

  it('gateReason is removedExportsSkipReason', () => {
    const ctx = breakingOnlyContext();
    expect(REMOVED_EXPORTS_PASS_SPEC.gateReason(ctx, cfg({ removedExportsPass: true }))).toBeNull();
    expect(REMOVED_EXPORTS_PASS_SPEC.gateReason(ctx, cfg())).toContain('disabled');
  });

  it('buildPrompts delegates to buildRemovedExportsPassPrompts', () => {
    const ctx = breakingOnlyContext();
    expect(REMOVED_EXPORTS_PASS_SPEC.buildPrompts(ctx)).toEqual(
      buildRemovedExportsPassPrompts(ctx),
    );
  });

  it('budget delegates to removedExportsPassBudget', () => {
    const ctx = breakingOnlyContext();
    expect(REMOVED_EXPORTS_PASS_SPEC.budget(100_000, ctx)).toBe(
      removedExportsPassBudget(100_000, ctx),
    );
  });
});
