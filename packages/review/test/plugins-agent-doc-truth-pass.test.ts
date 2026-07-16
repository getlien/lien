import { describe, it, expect, afterEach } from 'vitest';

import {
  shouldRunDocTruthPass,
  buildDocTruthPassPrompts,
  buildDocTruthPassInitialMessage,
  buildDocTruthPassInitialMessageV2,
  mergeDocTruthFindings,
  mergeDocPassIntoResult,
  docTruthPassBudget,
  isDocTruthV2Enabled,
  buildClaimWorklist,
  allClaimIds,
  postProcessDocTruthResult,
  DOC_TRUTH_PASS_SPEC,
  DOC_PASS_MAX_TURNS,
} from '../src/plugins/agent/doc-truth-pass.js';
import { buildSystemPrompt } from '../src/plugins/agent/system-prompt.js';
import { DOC_TRUTH } from '../src/plugins/agent/rules.js';
import { createTestContext } from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';
import type { AgentConfig, AgentFinding, AgentResult } from '../src/plugins/agent/types.js';

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

afterEach(() => {
  delete process.env.LIEN_REVIEW_DOC_PASS;
  delete process.env.LIEN_DOC_TRUTH_V2;
});

/** A raw v2 verdict/finding entry — extends the plain `finding()` helper with the v2-only
 *  `claimId`/`verdict` fields, mirroring stale-duplicate-pass.test.ts's `finding()` pattern. */
function verdictFinding(overrides: Record<string, unknown> = {}): AgentFinding {
  return {
    filepath: 'docs/architecture/worktree.md',
    line: 1,
    severity: 'warning',
    category: 'bug',
    message: 'msg',
    ...overrides,
  } as AgentFinding;
}

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
// DOC_TRUTH_PASS_SPEC (the ReviewPassSpec doc-truth plugs into the generic
// executor with — see review-pass.ts for the gate/run/failure-isolation/
// trace-append tests that used to live here as runDocTruthPass/
// appendDocTruthTurns, now generalized and tested against synthetic specs)
// ---------------------------------------------------------------------------

describe('DOC_TRUTH_PASS_SPEC', () => {
  it('wires this module’s own pure functions into the ReviewPassSpec contract', () => {
    expect(DOC_TRUTH_PASS_SPEC.name).toBe('doc-truth');
    expect(DOC_TRUTH_PASS_SPEC.skipPlugin).toBe('agent-review:doc-truth');
    expect(DOC_TRUTH_PASS_SPEC.maxTurns).toBe(DOC_PASS_MAX_TURNS);
    expect(DOC_TRUTH_PASS_SPEC.budget(100_000)).toBe(docTruthPassBudget(100_000));
    expect(DOC_TRUTH_PASS_SPEC.mergeFindings).toBe(mergeDocTruthFindings);
    expect(DOC_TRUTH_PASS_SPEC.mergeResultState).toBe(mergeDocPassIntoResult);
  });

  it('gateReason is docTruthSkipReason — null (should run) when claims are present', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    expect(DOC_TRUTH_PASS_SPEC.gateReason(ctx, cfg())).toBeNull();
  });

  it('gateReason names the real reason when gated off (not a generic boolean)', () => {
    const ctx = contextWithPatches([['packages/core/src/overlay.ts', CODE_PATCH]]); // no claims
    expect(DOC_TRUTH_PASS_SPEC.gateReason(ctx, cfg())).toContain('no doc claims');
  });

  it('buildPrompts delegates to buildDocTruthPassPrompts', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    expect(DOC_TRUTH_PASS_SPEC.buildPrompts(ctx)).toEqual(buildDocTruthPassPrompts(ctx));
  });

  it('postProcessResult is postProcessDocTruthResult', () => {
    expect(DOC_TRUTH_PASS_SPEC.postProcessResult).toBe(postProcessDocTruthResult);
  });
});

// ---------------------------------------------------------------------------
// v2 — per-claim verdict contract (flag-gated; LIEN_DOC_TRUTH_V2)
// ---------------------------------------------------------------------------

describe('isDocTruthV2Enabled', () => {
  it('is false by default (env unset)', () => {
    expect(isDocTruthV2Enabled()).toBe(false);
  });

  it.each(['on', '1', 'true', 'ON', 'TRUE'])('is true for LIEN_DOC_TRUTH_V2=%s', value => {
    process.env.LIEN_DOC_TRUTH_V2 = value;
    expect(isDocTruthV2Enabled()).toBe(true);
  });

  it.each(['off', '0', 'false', 'nonsense'])('is false for LIEN_DOC_TRUTH_V2=%s', value => {
    process.env.LIEN_DOC_TRUTH_V2 = value;
    expect(isDocTruthV2Enabled()).toBe(false);
  });
});

describe('buildClaimWorklist / allClaimIds — id assignment stability', () => {
  it('assigns one sequential id per doc claim, none for rename items when there are none', () => {
    const ctx = contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);
    const worklist = buildClaimWorklist(ctx);
    expect(worklist.docClaimIds).toEqual(['claim-1']);
    expect(worklist.renameSignals).toEqual([]);
    expect(worklist.overflowClaims).toBe(0);
    expect(allClaimIds(worklist)).toEqual(['claim-1']);
  });

  it('assigns ids across doc claims THEN rename-sweep items, prose before survivors, in one sequential namespace', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    const worklist = buildClaimWorklist(ctx);

    expect(worklist.docClaimIds).toEqual(['claim-1']);
    expect(worklist.renameSignals).toHaveLength(1);
    const { proseIds, survivorIds, signal } = worklist.renameSignals[0];
    expect(signal.mapping.from).toBe('oldSearchToken');
    expect(signal.mapping.to).toBe('newSearchToken');
    expect(proseIds).toEqual(['claim-2', 'claim-3', 'claim-4', 'claim-5', 'claim-6']);
    expect(survivorIds).toEqual([]); // this fixture's rename fully replaced the token — no survivors

    expect(allClaimIds(worklist)).toEqual([
      'claim-1',
      'claim-2',
      'claim-3',
      'claim-4',
      'claim-5',
      'claim-6',
    ]);
  });

  it('is stable across repeated calls on the same context (same ids, same order)', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    expect(allClaimIds(buildClaimWorklist(ctx))).toEqual(allClaimIds(buildClaimWorklist(ctx)));
  });

  it('caps doc claims at DOC_TRUTH_V2_MAX_CLAIMS (20) with an overflow count, no ids beyond the cap', () => {
    // 25 distinct single-line claim patches on 25 distinct doc files — each trips the
    // 'requirement' claim shape ("requires") independently.
    const entries: Array<[string, string]> = Array.from({ length: 25 }, (_, i) => [
      `docs/architecture/doc${i}.md`,
      `@@ -1,1 +1,2 @@\n # Title\n+This step ${i} requires a fresh checkout.`,
    ]);
    const ctx = contextWithPatches(entries);
    const worklist = buildClaimWorklist(ctx);
    expect(worklist.docClaimIds).toHaveLength(20);
    expect(worklist.overflowClaims).toBe(5);
    expect(allClaimIds(worklist)).toHaveLength(20);
  });
});

describe('buildDocTruthPassPrompts / buildDocTruthPassInitialMessageV2 — v2 contract rendering', () => {
  it('is byte-identical to the pre-v2 prompts when the flag is off', () => {
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    const { systemPrompt, initialMessage } = buildDocTruthPassPrompts(ctx);
    expect(systemPrompt).toBe(buildSystemPrompt({ active: [DOC_TRUTH], skipped: [] }));
    expect(initialMessage).toBe(buildDocTruthPassInitialMessage(ctx));
    expect(systemPrompt).not.toContain('output_format_v2_override');
    expect(initialMessage).not.toContain('PER-CLAIM VERDICT CONTRACT');
    expect(initialMessage).not.toContain('[claim-1]');
  });

  it('appends the v2 output-contract override to the system prompt, enumerating every claim id', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    const { systemPrompt } = buildDocTruthPassPrompts(ctx);

    expect(systemPrompt).toContain('<output_format_v2_override>');
    expect(systemPrompt).toContain('SUPERSEDES the <output_format> section above');
    expect(systemPrompt).toContain('claim-1, claim-2, claim-3, claim-4, claim-5, claim-6');
    // The v1 output_format section is still present (appended AFTER, not replaced) — the
    // supersession is a prompt-reading convention, not a text removal.
    expect(systemPrompt).toContain('<output_format>');
    // Full doc-truth tool access is unchanged (unlike stale-duplicate's hard tool cut).
    expect(systemPrompt).toContain('get_dependents');
    expect(systemPrompt).toContain('get_complexity');
  });

  it('renders <doc_claims> and <rename_sweep> with [claim-N] ids and the contract note', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const ctx = contextWithPatches([
      ['docs/architecture/worktree.md', DOC_CLAIM_PATCH],
      ...RENAME_SWEEP_FILES,
    ]);
    const { initialMessage } = buildDocTruthPassPrompts(ctx);

    expect(initialMessage).toContain('PER-CLAIM VERDICT CONTRACT');
    expect(initialMessage).toContain('<doc_claims>');
    expect(initialMessage).toContain('[claim-1] docs/architecture/worktree.md:');
    expect(initialMessage).toContain('<rename_sweep>');
    expect(initialMessage).toContain('[claim-2]');
    expect(initialMessage).toContain('`oldSearchToken` → `newSearchToken`');
    // Exactly one actual <doc_claims>/<rename_sweep> BLOCK renders (closing tags are a clean
    // signal — DOC_PASS_INTRO's own prose mentions the opening tag name by name for guidance).
    expect((initialMessage.match(/<\/doc_claims>/g) ?? []).length).toBe(1);
    expect((initialMessage.match(/<\/rename_sweep>/g) ?? []).length).toBe(1);
  });

  it('buildDocTruthPassInitialMessageV2 omits <doc_claims>/<rename_sweep> entirely when the worklist is empty', () => {
    const ctx = contextWithPatches([['packages/core/src/overlay.ts', CODE_PATCH]]);
    const message = buildDocTruthPassInitialMessageV2(ctx, buildClaimWorklist(ctx));
    // DOC_PASS_INTRO's own prose still names "<doc_claims>" for guidance even when the block is
    // absent (matching v1's intro wording); the closing tag is the reliable "block rendered" signal.
    expect(message).not.toContain('</doc_claims>');
    expect(message).not.toContain('</rename_sweep>');
    expect(message).toContain('PER-CLAIM VERDICT CONTRACT');
  });
});

describe('postProcessDocTruthResult', () => {
  const singleClaimCtx = () =>
    contextWithPatches([['docs/architecture/worktree.md', DOC_CLAIM_PATCH]]);

  it('is the identity (same reference) when the flag is off', () => {
    const result = fakeResult([verdictFinding({ claimId: 'claim-1', verdict: 'contradicted' })]);
    expect(postProcessDocTruthResult(result, singleClaimCtx())).toBe(result);
  });

  it('drops an "accurate" verdict entirely (stays silent when confirmed)', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'accurate', message: 'confirmed' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.findings).toHaveLength(0);
    expect(processed.incomplete).toBe(false);
  });

  it('keeps a "contradicted" verdict as a real finding, stripped of claimId/verdict', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'contradicted', message: 'stale claim' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.findings).toHaveLength(1);
    expect(processed.findings[0].message).toBe('stale claim');
    expect((processed.findings[0] as Record<string, unknown>).claimId).toBeUndefined();
    expect((processed.findings[0] as Record<string, unknown>).verdict).toBeUndefined();
    expect(processed.incomplete).toBe(false);
  });

  it('keeps an "unverifiable" verdict as a real (warning) finding', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'unverifiable', message: 'could not locate' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.findings).toHaveLength(1);
    expect(processed.findings[0].message).toBe('could not locate');
    expect(processed.incomplete).toBe(false);
  });

  it('passes an ad hoc finding (no claimId) through unchanged, alongside a required verdict', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'accurate' }),
      verdictFinding({ filepath: 'other.md', line: 9, message: 'spotted myself', ruleId: 'x' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.findings).toHaveLength(1);
    expect(processed.findings[0].message).toBe('spotted myself');
    expect(processed.incomplete).toBe(false);
  });

  it('marks the result incomplete with stopReason "incomplete_verdict" when the id is missing entirely', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([]); // claim-1 never got a verdict
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when a claimId is present but its verdict is missing/invalid', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([verdictFinding({ claimId: 'claim-1', verdict: undefined })]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('incomplete_verdict');
    expect(processed.findings).toHaveLength(0); // never guess-promoted either
  });

  it('is incomplete when a claimId is present but its verdict is not a recognized value', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'maybe' as never, message: 'bogus' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when the same claimId is verdicted twice (duplicate)', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'accurate', message: 'first' }),
      verdictFinding({ claimId: 'claim-1', verdict: 'contradicted', message: 'second' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when an entry names a claimId outside the worklist', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([
      verdictFinding({ claimId: 'claim-1', verdict: 'accurate' }),
      verdictFinding({ claimId: 'claim-99', verdict: 'contradicted', message: 'phantom' }),
    ]);
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('incomplete_verdict');
  });

  it('keeps the ORIGINAL stopReason when the client was already incomplete for a real reason', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([], undefined);
    result.incomplete = true;
    result.stopReason = 'budget';
    const processed = postProcessDocTruthResult(result, singleClaimCtx());
    expect(processed.incomplete).toBe(true);
    expect(processed.stopReason).toBe('budget'); // NOT overwritten to incomplete_verdict
  });

  it('does not mutate the input result', () => {
    process.env.LIEN_DOC_TRUTH_V2 = 'on';
    const result = fakeResult([verdictFinding({ claimId: 'claim-1', verdict: 'contradicted' })]);
    postProcessDocTruthResult(result, singleClaimCtx());
    expect(result.findings).toHaveLength(1);
    expect((result.findings[0] as Record<string, unknown>).claimId).toBe('claim-1');
  });
});
