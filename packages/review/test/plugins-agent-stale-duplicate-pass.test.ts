import { describe, it, expect, afterEach } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import {
  staleDuplicateSkipReason,
  shouldRunStaleDuplicatePass,
  buildStaleDuplicatePassPrompts,
  buildStaleDuplicatePassInitialMessage,
  staleDuplicatePassBudget,
  postProcessStaleDuplicateResult,
  mergeStaleDuplicateFindings,
  mergeStaleDuplicateResultState,
  isStaleDuplicateMainDisabled,
  applyStaleDuplicateMainOverride,
  STALE_DUPLICATE_PASS_SPEC,
  STALE_DUP_PASS_MAX_TURNS,
} from '../src/plugins/agent/stale-duplicate-pass.js';
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

  it('builds an initial message with the worklist, changed-site hunk, and surviving sites', () => {
    const message = buildStaleDuplicatePassInitialMessage(eligibleContext());
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('<stale_duplicate_candidates>');
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
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('staleDuplicatePassBudget', () => {
  it('scales with candidate count, clamped to the floor for a single candidate', () => {
    const budget = staleDuplicatePassBudget(100_000, eligibleContext());
    // 1 candidate: 2000 + 800*1 = 2800, clamped up to the 4000 floor.
    expect(budget).toBe(4_000);
  });

  it('is independent of the main pass base budget (candidate-count driven, not a fraction)', () => {
    const low = staleDuplicatePassBudget(10_000, eligibleContext());
    const high = staleDuplicatePassBudget(500_000, eligibleContext());
    expect(low).toBe(high);
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

  it('dedupes a nearby main finding (within ±2 lines) but keeps a distant one', () => {
    const main = [
      finding({ line: 21, message: 'near' }), // distance 1 from the loop finding at line 20 → dropped
      finding({ line: 30, message: 'far' }), // distance 10 → kept
    ];
    const loop = [finding({ line: 20, message: 'loop' })];

    const merged = mergeStaleDuplicateFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['far', 'loop'].sort());
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
