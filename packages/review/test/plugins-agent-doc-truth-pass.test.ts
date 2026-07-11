import { describe, it, expect, afterEach } from 'vitest';

import {
  shouldRunDocTruthPass,
  buildDocTruthPassPrompts,
  buildDocTruthPassInitialMessage,
  mergeDocTruthFindings,
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

function contextWithPatches(entries: Array<[string, string]>): ReviewContext {
  return createTestContext({
    changedFiles: entries.map(([f]) => f),
    allChangedFiles: entries.map(([f]) => f),
    pr: {
      title: 'docs: worktree indexing',
      body: 'Clarify the overlay gate.',
      patches: new Map(entries),
    } as unknown as ReviewContext['pr'],
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
});
