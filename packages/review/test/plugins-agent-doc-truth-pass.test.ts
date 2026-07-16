import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  shouldRunDocTruthPass,
  buildDocTruthPassPrompts,
  buildDocTruthPassInitialMessage,
  mergeDocTruthFindings,
  mergeDocPassIntoResult,
  appendDocTruthTurns,
  docTruthPassBudget,
  runDocTruthPass,
  DOC_PASS_MAX_TURNS,
} from '../src/plugins/agent/doc-truth-pass.js';
import { createTestContext, silentLogger } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import type { Logger } from '../src/logger.js';
import type {
  AgentConfig,
  AgentFinding,
  AgentResult,
  AgentTrace,
  TurnTrace,
} from '../src/plugins/agent/types.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/** A doc-surface hunk carrying a state claim ("disabled … when"). */
const DOC_CLAIM_PATCH = `@@ -1,3 +1,4 @@
 # Worktree indexing
+The overlay is disabled when the base checkout has no index.

 Some prose.`;

/** A doc-surface hunk with only plain descriptive prose (no claim shape). */
const DOC_NO_CLAIM_PATCH = `@@ -1,2 +1,3 @@
 # Title
+Just some ordinary descriptive prose about the project layout.`;

/** A code-file hunk whose text happens to look claim-shaped — but it is not a
 *  guidance surface, so the claim scanner must ignore it entirely. */
const CODE_PATCH = `@@ -1,3 +1,4 @@
 export function overlay() {
+  return UNIQUE_CODE_MARKER_XYZ; // disabled when true
 }`;

/**
 * A single-token identifier swap landing inside a comment. Repeated across
 * >= MIN_FILES files with >= MIN_OCCURRENCES total occurrences (see
 * rename-sweep-signals.ts), this trips the rename-sweep detector: same glue,
 * one differing identifier position, above both thresholds.
 */
const RENAME_SWEEP_PATCH = `@@ -1,2 +1,2 @@
-// uses oldSearchToken to look up code
+// uses newSearchToken to look up code`;

/** changedFiles carrying a rename-sweep patch across enough distinct files. */
const RENAME_SWEEP_FILES: Array<[string, string]> = [
  'packages/core/src/file1.ts',
  'packages/core/src/file2.ts',
  'packages/core/src/file3.ts',
  'packages/core/src/file4.ts',
  'packages/core/src/file5.ts',
].map(f => [f, RENAME_SWEEP_PATCH]);

function contextWithPatches(
  entries: Array<[string, string]>,
  extra?: Partial<ReviewContext>,
): ReviewContext {
  return createTestContext({
    changedFiles: entries.map(([f]) => f),
    allChangedFiles: entries.map(([f]) => f),
    pr: {
      title: 'docs: worktree indexing',
      body: 'Clarify the overlay gate.',
      patches: new Map(entries),
    } as unknown as ReviewContext['pr'],
    ...extra,
  });
}

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    filepath: 'a.md',
    line: 1,
    severity: 'warning',
    category: 'bug',
    message: 'msg',
    ...overrides,
  };
}

function fakeResult(findings: AgentFinding[] = [], trace?: AgentTrace): AgentResult {
  return {
    findings,
    summary: { riskLevel: 'low', overview: 'ok', keyChanges: [] },
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.01 },
    turns: 1,
    stopReason: 'completed',
    incomplete: false,
    trace,
  };
}

function turn(turnNumber: number, toolNames: string[] = []): TurnTrace {
  return {
    turnNumber,
    responseText: '',
    toolCalls: toolNames.map(name => ({ name, input: {}, output: 'ok' })),
    finishReason: 'stop',
  };
}

function trace(turns: TurnTrace[]): AgentTrace {
  return { systemPrompt: 's', initialMessage: 'i', model: 'm', turns };
}

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (m: string): void => {
    lines.push(m);
  };
  return { logger: { info: record, warning: record, error: record, debug: record }, lines };
}

afterEach(() => {
  delete process.env.LIEN_REVIEW_DOC_PASS;
});

// ---------------------------------------------------------------------------
// shouldRunDocTruthPass
// ---------------------------------------------------------------------------

describe('shouldRunDocTruthPass', () => {
  it('is true when a touched doc surface carries a claim-shaped line', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    expect(shouldRunDocTruthPass(ctx)).toBe(true);
  });

  it('is false when the touched doc surface has no claim-shaped prose', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_NO_CLAIM_PATCH]]);
    expect(shouldRunDocTruthPass(ctx)).toBe(false);
  });

  it('is false when only non-guidance code files changed (claim scanner skips them)', () => {
    const ctx = contextWithPatches([['packages/core/src/overlay.ts', CODE_PATCH]]);
    expect(shouldRunDocTruthPass(ctx)).toBe(false);
  });

  it('is false when there are no patches', () => {
    expect(shouldRunDocTruthPass(createTestContext())).toBe(false);
  });

  it('is false when the config kill-switch is set, even with claims', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    expect(shouldRunDocTruthPass(ctx, cfg({ docTruthPass: false }))).toBe(false);
  });

  it('is false when the env kill-switch LIEN_REVIEW_DOC_PASS=0 is set', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    process.env.LIEN_REVIEW_DOC_PASS = '0';
    expect(shouldRunDocTruthPass(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('buildDocTruthPassPrompts', () => {
  it('activates ONLY the doc-truth rule in the system prompt', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const { systemPrompt } = buildDocTruthPassPrompts(ctx);

    // The doc-truth strategy and its enumerated (sole) ruleId are present…
    expect(systemPrompt).toContain('Documentation / Guidance Truthfulness Check');
    expect(systemPrompt).toContain('exactly one of: doc-truth');
    // …and no competing rule's investigation strategy leaks in.
    expect(systemPrompt).not.toContain('Edge Case Sweep');
    expect(systemPrompt).not.toContain('Concurrency Check');
    expect(systemPrompt).not.toContain('### Structural Analysis');
  });

  it('builds an initial message with doc_claims + guidance hunks and NO competing signals', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ['packages/core/src/overlay.ts', CODE_PATCH],
    ]);
    const message = buildDocTruthPassInitialMessage(ctx);

    // PR header + the doc-truth signals are present.
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('docs: worktree indexing');
    expect(message).toContain('<doc_claims>');
    expect(message).toContain('<guidance_surface_changes>');
    expect(message).toContain('disabled when the base checkout');

    // The diff carries ONLY doc-surface hunks — the code file's content must not
    // appear (it is neither a guidance surface nor a doc claim).
    expect(message).not.toContain('UNIQUE_CODE_MARKER_XYZ');

    // No blast-radius / complexity / other-rule signal blocks.
    expect(message).not.toContain('<blast_radius>');
    expect(message).not.toContain('<complexity_regressions>');
    expect(message).not.toContain('<stale_literal_candidates>');
    expect(message).not.toContain('<untrusted_input_sites>');
    // No rename-sweep in THIS fixture — it carries no mechanical rename.
    expect(message).not.toContain('<rename_sweep>');
  });

  // Regression coverage: the doc-truth rule text (rules.ts) explicitly tells
  // the model to "check for a <rename_sweep> block" as a supplementary
  // claim-verification worklist, but the block was never rendered into this
  // pass's initial message — the rule promised a block that never arrived.
  it('includes the <rename_sweep> block when the diff carries a mechanical rename sweep', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    const message = buildDocTruthPassInitialMessage(ctx);

    expect(message).toContain('<rename_sweep>');
    expect(message).toContain('`oldSearchToken` → `newSearchToken`');
    expect(message).toContain('</rename_sweep>');

    // Positioned after <doc_claims> (a supplementary worklist), before the
    // guidance-surface hunks.
    const docClaimsIdx = message.indexOf('<doc_claims>');
    const renameSweepIdx = message.indexOf('<rename_sweep>');
    const guidanceIdx = message.indexOf('<guidance_surface_changes>');
    expect(docClaimsIdx).toBeGreaterThan(-1);
    expect(docClaimsIdx).toBeLessThan(renameSweepIdx);
    expect(renameSweepIdx).toBeLessThan(guidanceIdx);
  });

  it('omits the <rename_sweep> block when the diff has no mechanical rename sweep', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ['packages/core/src/overlay.ts', CODE_PATCH],
    ]);
    const message = buildDocTruthPassInitialMessage(ctx);
    expect(message).not.toContain('<rename_sweep>');
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('docTruthPassBudget', () => {
  it('is ~40% of the base budget, rounded to an integer', () => {
    expect(docTruthPassBudget(100_000)).toBe(40_000);
    expect(docTruthPassBudget(50_001)).toBe(20_000); // round(20000.4)
  });
});

// ---------------------------------------------------------------------------
// mergeDocTruthFindings
// ---------------------------------------------------------------------------

describe('mergeDocTruthFindings', () => {
  it('keeps the main-pass finding and drops the doc-pass dup at the same line', () => {
    const main = [
      finding({ filepath: 'a.md', line: 10, ruleId: 'edge-case-sweep', message: 'main' }),
    ];
    const doc = [finding({ filepath: 'a.md', line: 10, message: 'dup' })];

    const merged = mergeDocTruthFindings(main, doc);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('main');
    expect(merged[0].ruleId).toBe('edge-case-sweep');
  });

  it('dedupes a nearby doc finding (within ±2 lines) but appends a distant one', () => {
    const main = [finding({ filepath: 'a.md', line: 10, message: 'main' })];
    const doc = [
      finding({ filepath: 'a.md', line: 12, message: 'near' }), // distance 2 → deduped
      finding({ filepath: 'a.md', line: 13, message: 'far' }), // distance 3 → appended
    ];

    const merged = mergeDocTruthFindings(main, doc);

    expect(merged.map(f => f.message)).toEqual(['main', 'far']);
  });

  it('appends a finding on a distinct file and forces its ruleId to doc-truth', () => {
    const main = [finding({ filepath: 'a.md', line: 10, ruleId: 'edge-case-sweep' })];
    const doc = [
      finding({ filepath: 'b.md', line: 1, ruleId: undefined, message: 'no-rule' }),
      finding({ filepath: 'c.md', line: 5, ruleId: 'stale-duplicate', message: 'wrong-rule' }),
    ];

    const merged = mergeDocTruthFindings(main, doc);

    expect(merged).toHaveLength(3);
    const byMsg = Object.fromEntries(merged.map(f => [f.message, f.ruleId]));
    expect(byMsg['no-rule']).toBe('doc-truth');
    expect(byMsg['wrong-rule']).toBe('doc-truth'); // forced, overriding the emitted id
  });

  it('does not mutate the input arrays', () => {
    const main = [finding({ filepath: 'a.md', line: 10 })];
    const doc = [finding({ filepath: 'b.md', line: 1, ruleId: 'x' })];
    mergeDocTruthFindings(main, doc);
    expect(doc[0].ruleId).toBe('x'); // original untouched
    expect(main).toHaveLength(1);
  });

  it('keeps a doc-pass ERROR that overlaps a main-pass WARNING (severity-aware dedupe)', () => {
    const main = [finding({ filepath: 'a.md', line: 10, severity: 'warning', message: 'main' })];
    const doc = [finding({ filepath: 'a.md', line: 10, severity: 'error', message: 'doc-error' })];

    const merged = mergeDocTruthFindings(main, doc);

    expect(merged.map(f => f.message)).toEqual(['main', 'doc-error']);
  });

  it('still drops a doc-pass warning that overlaps a main-pass error', () => {
    const main = [finding({ filepath: 'a.md', line: 10, severity: 'error', message: 'main' })];
    const doc = [finding({ filepath: 'a.md', line: 11, severity: 'warning', message: 'doc' })];

    expect(mergeDocTruthFindings(main, doc)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeDocPassIntoResult
// ---------------------------------------------------------------------------

describe('mergeDocPassIntoResult', () => {
  it('marks the merged result incomplete when only the doc pass died', () => {
    const main = fakeResult();
    main.incomplete = false;
    main.stopReason = 'completed';
    const doc = fakeResult();
    doc.incomplete = true;
    doc.stopReason = 'budget';

    mergeDocPassIntoResult(main, doc, []);

    expect(main.incomplete).toBe(true);
    expect(main.stopReason).toBe('budget');
    expect(main.incompleteFromDocPass).toBe(true);
  });

  it('leaves a main-pass incomplete untouched (no doc-pass attribution)', () => {
    const main = fakeResult();
    main.incomplete = true;
    main.stopReason = 'max_turns';
    const doc = fakeResult();
    doc.incomplete = true;
    doc.stopReason = 'budget';

    mergeDocPassIntoResult(main, doc, []);

    expect(main.stopReason).toBe('max_turns');
    expect(main.incompleteFromDocPass).toBeUndefined();
  });

  it('lifts a low risk level to medium and notes contradictions when the doc pass found errors', () => {
    const main = fakeResult();
    main.summary = { riskLevel: 'low', overview: 'Fine.', keyChanges: [] };
    const merged = [finding({ ruleId: 'doc-truth', severity: 'error' })];

    mergeDocPassIntoResult(main, fakeResult(), merged);

    expect(main.summary.riskLevel).toBe('medium');
    expect(main.summary.overview).toContain('documentation-truthfulness pass found 1');
  });

  it('does not lower an already-elevated risk level', () => {
    const main = fakeResult();
    main.summary = { riskLevel: 'critical', overview: 'Bad.', keyChanges: [] };
    const merged = [finding({ ruleId: 'doc-truth', severity: 'error' })];

    mergeDocPassIntoResult(main, fakeResult(), merged);

    expect(main.summary.riskLevel).toBe('critical');
  });

  it('is a no-op for doc-truth warnings only or a null doc result', () => {
    const main = fakeResult();
    main.summary = { riskLevel: 'low', overview: 'Fine.', keyChanges: [] };

    mergeDocPassIntoResult(main, fakeResult(), [finding({ ruleId: 'doc-truth' })]);
    expect(main.summary.riskLevel).toBe('low');

    mergeDocPassIntoResult(main, null, [finding({ ruleId: 'doc-truth', severity: 'error' })]);
    expect(main.summary.riskLevel).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// appendDocTruthTurns
// ---------------------------------------------------------------------------

describe('appendDocTruthTurns', () => {
  it('appends renumbered, phase-labeled doc turns so both passes stay in one trace', () => {
    const mainTrace = trace([turn(1, ['grep_codebase']), turn(2)]);
    const docTrace = trace([turn(1, ['get_files_context']), turn(2)]);

    appendDocTruthTurns(mainTrace, docTrace);

    expect(mainTrace.turns).toHaveLength(4);
    expect(mainTrace.turns[2].turnNumber).toBe(3);
    expect(mainTrace.turns[2].phase).toBe('doc-truth');
    expect(mainTrace.turns[3].turnNumber).toBe(4);
    // Tool calls from BOTH passes are now flattenable (keeps expectToolCalled
    // working for main-pass assertions AND surfaces the doc pass's tools).
    const toolNames = mainTrace.turns.flatMap(t => t.toolCalls.map(c => c.name));
    expect(toolNames).toContain('grep_codebase');
    expect(toolNames).toContain('get_files_context');
  });

  it('is a no-op when either trace is absent', () => {
    const mainTrace = trace([turn(1)]);
    expect(() => appendDocTruthTurns(undefined, trace([turn(1)]))).not.toThrow();
    appendDocTruthTurns(mainTrace, undefined);
    expect(mainTrace.turns).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runDocTruthPass (client injected — zero LLM)
// ---------------------------------------------------------------------------

describe('runDocTruthPass', () => {
  it('does not invoke the client and returns null when the pass is gated off', async () => {
    const ctx = contextWithPatches([['packages/core/src/overlay.ts', CODE_PATCH]]); // no claims
    let called = false;
    const res = await runDocTruthPass(ctx, cfg(), silentLogger, async () => {
      called = true;
      return fakeResult();
    });
    expect(res).toBeNull();
    expect(called).toBe(false);
  });

  it('runs the client with the doc-pass budget/turns and returns its result', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const captured: { sys?: string; init?: string; budget?: number; maxTurns?: number } = {};
    const res = await runDocTruthPass(
      ctx,
      cfg({ maxTokenBudget: 100_000 }),
      silentLogger,
      async (sys, init, budget, maxTurns) => {
        Object.assign(captured, { sys, init, budget, maxTurns });
        return fakeResult([finding({ filepath: 'docs/architecture/worktree.md', line: 2 })]);
      },
    );

    expect(res).not.toBeNull();
    expect(res!.findings).toHaveLength(1);
    expect(captured.budget).toBe(40_000);
    expect(captured.maxTurns).toBe(DOC_PASS_MAX_TURNS);
    expect(captured.sys).toContain('doc-truth');
    expect(captured.init).toContain('<doc_claims>');
  });

  it('isolates a pass failure: a throwing client yields null and a logged warning', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const { logger, lines } = capturingLogger();
    const res = await runDocTruthPass(ctx, cfg(), logger, async () => {
      throw new Error('boom');
    });
    expect(res).toBeNull();
    expect(lines.some(l => l.includes('doc-truth pass failed') && l.includes('boom'))).toBe(true);
  });

  // Regression coverage for the CodeRabbit #768 finding: reportDocTruthPassSkip
  // used to report a generic "no doc claims" reason for every gated-off case,
  // and a thrown pass-2 error vanished from the attestation entirely (neither
  // "ran" nor "skipped"). `runDocTruthPass` now reports its own precise reason
  // for both the gate and the failure, straight from the one place that knows it.
  it('reports the CONFIG-disabled reason, not the generic "no doc claims" one', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const reportSkip = vi.fn();
    await runDocTruthPass(
      { ...ctx, reportSkip },
      cfg({ docTruthPass: false }),
      silentLogger,
      async () => fakeResult(),
    );
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:doc-truth',
      reason: expect.stringContaining('config'),
    });
  });

  it('reports the ENV-disabled reason', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    process.env.LIEN_REVIEW_DOC_PASS = '0';
    const reportSkip = vi.fn();
    await runDocTruthPass({ ...ctx, reportSkip }, cfg(), silentLogger, async () => fakeResult());
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:doc-truth',
      reason: expect.stringContaining('LIEN_REVIEW_DOC_PASS'),
    });
  });

  it('reports "no doc claims" only when that is the actual reason', async () => {
    const ctx = contextWithPatches([['packages/core/src/overlay.ts', CODE_PATCH]]); // no claims
    const reportSkip = vi.fn();
    await runDocTruthPass({ ...ctx, reportSkip }, cfg(), silentLogger, async () => fakeResult());
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:doc-truth',
      reason: expect.stringContaining('no doc claims'),
    });
  });

  it('reports a FAILED outcome (not silence) when the client throws', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const reportSkip = vi.fn();
    await runDocTruthPass({ ...ctx, reportSkip }, cfg(), silentLogger, async () => {
      throw new Error('boom');
    });
    expect(reportSkip).toHaveBeenCalledWith({
      plugin: 'agent-review:doc-truth',
      reason: expect.stringContaining('failed: boom'),
    });
  });

  it('does not report anything when the pass runs to completion', async () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const reportSkip = vi.fn();
    await runDocTruthPass({ ...ctx, reportSkip }, cfg(), silentLogger, async () => fakeResult());
    expect(reportSkip).not.toHaveBeenCalled();
  });
});
