import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import {
  incompleteHandlingSkipReason,
  shouldRunIncompleteHandlingPass,
  computeIncompleteHandlingCandidates,
  computeIncompleteHandlingWorklist,
  buildIncompleteHandlingPassPrompts,
  buildIncompleteHandlingPassInitialMessage,
  incompleteHandlingPassBudget,
  postProcessIncompleteHandlingResult,
  mergeIncompleteHandlingFindings,
  mergeIncompleteHandlingResultState,
  isIncompleteHandlingMainDisabled,
  applyIncompleteHandlingMainOverride,
  INCOMPLETE_HANDLING_PASS_SPEC,
  INCOMPLETE_PASS_MAX_TURNS,
} from '../src/plugins/agent/incomplete-handling-pass.js';
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
      language: file.endsWith('.php') ? 'php' : 'typescript',
    },
  } as unknown as CodeChunk;
}

// ---- variant-sweep shape (mirrors variant-sweep-signals.test.ts's Color enum) ----

const COLOR_ENUM = ['export enum Color {', '  Red,', '  Blue,', '  Green,', '}'].join('\n');
const COLOR_ENUM_PATCH = [
  '@@ -1,4 +1,5 @@',
  ' export enum Color {',
  '   Red,',
  '   Blue,',
  '+  Green,',
  ' }',
].join('\n');

function colorSwitchConsumer(): string {
  return [
    'function label(c: Color): string {',
    '  switch (c) {',
    '    case Color.Red:',
    "      return 'red';",
    '    case Color.Blue:',
    "      return 'blue';",
    '    default:',
    "      return 'unknown';",
    '  }',
    '}',
  ].join('\n');
}

// ---- sibling-surface shape (mirrors sibling-surface-signals.test.ts's guzzle #3740 shape) ----

const CURL_HANDLER_PATCH = `@@ -1,7 +1,14 @@
 <?php
 class CurlHandler {
     public function handle($options) {
         $this->validateOptions($options);
+        if (isset($options['on_trailers'])) {
+            $this->assertOnTrailersCallable($options);
+        }
     }
+
+    private function assertOnTrailersCallable($options) {
+        if (!is_callable($options['on_trailers'])) {
+            throw new InvalidArgumentException('on_trailers must be callable');
+        }
+    }
 }`;

const CURL_HANDLER_CONTENT = [
  '<?php',
  'class CurlHandler {',
  '    public function handle($options) {',
  '        $this->validateOptions($options);',
  "        if (isset(\$options['on_trailers'])) {",
  '            $this->assertOnTrailersCallable($options);',
  '        }',
  '    }',
  '',
  '    private function assertOnTrailersCallable($options) {',
  "        if (!is_callable(\$options['on_trailers'])) {",
  "            throw new InvalidArgumentException('on_trailers must be callable');",
  '        }',
  '    }',
  '}',
].join('\n');

const STREAM_HANDLER_CONTENT = [
  '<?php',
  'class StreamHandler {',
  '    public function handle($options) {',
  '        $this->validateOptions($options);',
  '    }',
  '}',
].join('\n');

// ---- unread-field shape (mirrors unread-field-signals.test.ts's brand-new interface) ----

const OPTIONS_INTERFACE = ['export interface Options {', '  timeout: number;', '}'].join('\n');
const OPTIONS_PATCH = [
  '@@ -0,0 +1,3 @@',
  '+export interface Options {',
  '+  timeout: number;',
  '+}',
].join('\n');

// ---------------------------------------------------------------------------
// Single-shape eligible contexts
// ---------------------------------------------------------------------------

function variantOnlyContext(): ReviewContext {
  const patches = new Map([['src/color.ts', COLOR_ENUM_PATCH]]);
  const chunks = [makeChunk('src/color.ts', 1, COLOR_ENUM)];
  const repoChunks = [...chunks, makeChunk('src/consumer.ts', 1, colorSwitchConsumer())];
  return createTestContext({
    changedFiles: ['src/color.ts'],
    chunks,
    repoChunks,
    pr: { title: 'Add Green variant', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

function siblingOnlyContext(): ReviewContext {
  const patches = new Map([['src/Handler/CurlHandler.php', CURL_HANDLER_PATCH]]);
  const repoChunks = [
    makeChunk('src/Handler/CurlHandler.php', 1, CURL_HANDLER_CONTENT),
    makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
  ];
  return createTestContext({
    changedFiles: ['src/Handler/CurlHandler.php'],
    chunks: [],
    repoChunks,
    pr: { title: 'Add on_trailers', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

function unreadFieldOnlyContext(): ReviewContext {
  const patches = new Map([['src/options.ts', OPTIONS_PATCH]]);
  const chunks = [makeChunk('src/options.ts', 1, OPTIONS_INTERFACE)];
  return createTestContext({
    changedFiles: ['src/options.ts'],
    chunks,
    repoChunks: chunks,
    pr: { title: 'Add Options.timeout', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

/** Combines all three single-shape fixtures into one context — every shape fires. */
function mixedContext(): ReviewContext {
  const patches = new Map([
    ['src/color.ts', COLOR_ENUM_PATCH],
    ['src/Handler/CurlHandler.php', CURL_HANDLER_PATCH],
    ['src/options.ts', OPTIONS_PATCH],
  ]);
  const chunks = [
    makeChunk('src/color.ts', 1, COLOR_ENUM),
    makeChunk('src/options.ts', 1, OPTIONS_INTERFACE),
  ];
  const repoChunks = [
    ...chunks,
    makeChunk('src/consumer.ts', 1, colorSwitchConsumer()),
    makeChunk('src/Handler/CurlHandler.php', 1, CURL_HANDLER_CONTENT),
    makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
  ];
  return createTestContext({
    changedFiles: ['src/color.ts', 'src/Handler/CurlHandler.php', 'src/options.ts'],
    chunks,
    repoChunks,
    pr: { title: 'Mixed omission shapes', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

/** No signal fires at all — an ordinary PR with no omission-shaped diff. */
function noCandidateContext(): ReviewContext {
  const patches = new Map([['src/plain.ts', '@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;']]);
  return createTestContext({
    changedFiles: ['src/plain.ts'],
    chunks: [],
    repoChunks: [],
    pr: { title: 'Trivial change', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

/** `n` independent unread-field candidates (one interface, `n` never-read fields) — the same
 *  shape the "caps a single shape's own contribution" test above uses, parametrized for
 *  rank-and-cap overflow testing. `n` should stay <= UNREAD_FIELD_CAP (10) so every requested
 *  field actually becomes a candidate (this helper does not exercise that per-shape cap itself). */
function manyUnreadFieldsContext(n: number): ReviewContext {
  const fieldLines = Array.from({ length: n }, (_, i) => `  field${i}: number;`);
  const content = ['export interface Big {', ...fieldLines, '}'].join('\n');
  const patchLines = [
    '@@ -0,0 +1,27 @@',
    '+export interface Big {',
    ...fieldLines.map(l => `+${l}`),
    '+}',
  ];
  const patches = new Map([['src/big.ts', patchLines.join('\n')]]);
  const chunks = [makeChunk('src/big.ts', 1, content)];
  return createTestContext({
    changedFiles: ['src/big.ts'],
    chunks,
    repoChunks: chunks,
    pr: { title: 'Add many fields', body: '', patches } as unknown as ReviewContext['pr'],
  });
}

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'm', maxTurns: 15, maxTokenBudget: 100_000, ...overrides };
}

function finding(overrides: Record<string, unknown> = {}): AgentFinding {
  return {
    filepath: 'src/consumer.ts',
    line: 3,
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

// Restore caller state rather than unconditionally deleting — a preconfigured
// value in the surrounding environment must survive this file's tests intact
// (CodeRabbit finding on this PR).
let previousIncompletePass: string | undefined;
let previousIncompleteMain: string | undefined;

beforeEach(() => {
  previousIncompletePass = process.env.LIEN_INCOMPLETE_PASS;
  previousIncompleteMain = process.env.LIEN_INCOMPLETE_MAIN;
  delete process.env.LIEN_INCOMPLETE_PASS;
  delete process.env.LIEN_INCOMPLETE_MAIN;
});

afterEach(() => {
  if (previousIncompletePass === undefined) delete process.env.LIEN_INCOMPLETE_PASS;
  else process.env.LIEN_INCOMPLETE_PASS = previousIncompletePass;

  if (previousIncompleteMain === undefined) delete process.env.LIEN_INCOMPLETE_MAIN;
  else process.env.LIEN_INCOMPLETE_MAIN = previousIncompleteMain;
});

// ---------------------------------------------------------------------------
// Loop eligibility gate
// ---------------------------------------------------------------------------

describe('incompleteHandlingSkipReason / shouldRunIncompleteHandlingPass', () => {
  it('is false (disabled) by default, even with an eligible candidate — ships dark', () => {
    const ctx = siblingOnlyContext();
    expect(shouldRunIncompleteHandlingPass(ctx, cfg())).toBe(false);
    expect(incompleteHandlingSkipReason(ctx, cfg())).toContain('disabled');
  });

  it('is true when opted in via config AND a sibling-surface candidate exists', () => {
    const ctx = siblingOnlyContext();
    expect(shouldRunIncompleteHandlingPass(ctx, cfg({ incompleteHandlingPass: true }))).toBe(true);
  });

  it('is true when opted in via config AND a variant-sweep candidate exists', () => {
    const ctx = variantOnlyContext();
    expect(shouldRunIncompleteHandlingPass(ctx, cfg({ incompleteHandlingPass: true }))).toBe(true);
  });

  it('is true when opted in via config AND an unread-field candidate exists', () => {
    const ctx = unreadFieldOnlyContext();
    expect(shouldRunIncompleteHandlingPass(ctx, cfg({ incompleteHandlingPass: true }))).toBe(true);
  });

  it('is true when opted in via LIEN_INCOMPLETE_PASS=on (no config flag)', () => {
    process.env.LIEN_INCOMPLETE_PASS = 'on';
    const ctx = siblingOnlyContext();
    expect(shouldRunIncompleteHandlingPass(ctx, cfg())).toBe(true);
  });

  it('is false when opted in but no candidate exists in any of the three shapes', () => {
    const ctx = noCandidateContext();
    const reason = incompleteHandlingSkipReason(ctx, cfg({ incompleteHandlingPass: true }));
    expect(reason).toContain('no variant-sweep, sibling-surface, or unread-field candidate found');
  });

  it('is false when there are no patches at all, even when opted in', () => {
    expect(
      shouldRunIncompleteHandlingPass(createTestContext(), cfg({ incompleteHandlingPass: true })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unified worklist building
// ---------------------------------------------------------------------------

describe('computeIncompleteHandlingCandidates', () => {
  it('builds a single variant-sweep candidate from a variant-only context', () => {
    const candidates = computeIncompleteHandlingCandidates(variantOnlyContext());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].shape).toBe('variant-sweep');
    if (candidates[0].shape === 'variant-sweep') {
      expect(candidates[0].variant.typeName).toBe('Color');
      expect(candidates[0].variant.variant).toBe('Green');
    }
  });

  it('builds sibling-surface candidate(s) from a sibling-only context', () => {
    const candidates = computeIncompleteHandlingCandidates(siblingOnlyContext());
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => c.shape === 'sibling-surface')).toBe(true);
    const onTrailers = candidates.find(
      c => c.shape === 'sibling-surface' && c.sibling.display.includes('on_trailers'),
    );
    expect(onTrailers).toBeDefined();
  });

  it('builds a single unread-field candidate from an unread-field-only context', () => {
    const candidates = computeIncompleteHandlingCandidates(unreadFieldOnlyContext());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].shape).toBe('unread-field');
    if (candidates[0].shape === 'unread-field') {
      expect(candidates[0].unreadField.typeName).toBe('Options');
      expect(candidates[0].unreadField.field).toBe('timeout');
    }
  });

  it('returns [] for a context with no signal in any shape', () => {
    expect(computeIncompleteHandlingCandidates(noCandidateContext())).toEqual([]);
  });

  it('combines all three shapes in a mixed context, in variant/sibling/unread order', () => {
    const candidates = computeIncompleteHandlingCandidates(mixedContext());
    const shapes = candidates.map(c => c.shape);
    expect(shapes).toContain('variant-sweep');
    expect(shapes).toContain('sibling-surface');
    expect(shapes).toContain('unread-field');
    // Fixed ordering: every variant-sweep entry precedes every sibling-surface
    // entry, which precedes every unread-field entry — candidate ids must
    // stay stable across runs on the same PR.
    const firstSibling = shapes.indexOf('sibling-surface');
    const firstUnread = shapes.indexOf('unread-field');
    const lastVariant = shapes.lastIndexOf('variant-sweep');
    const lastSibling = shapes.lastIndexOf('sibling-surface');
    expect(lastVariant).toBeLessThan(firstSibling);
    expect(lastSibling).toBeLessThan(firstUnread);
  });

  it("caps a single shape's own contribution (unread-field) at its own per-shape cap (10)", () => {
    // 25 brand-new interface fields, none read anywhere — far more than any
    // single real PR, but exercises the per-shape cap path deterministically.
    const fieldLines = Array.from({ length: 25 }, (_, i) => `  field${i}: number;`);
    const content = ['export interface Big {', ...fieldLines, '}'].join('\n');
    const patchLines = [
      '@@ -0,0 +1,27 @@',
      '+export interface Big {',
      ...fieldLines.map(l => `+${l}`),
      '+}',
    ];
    const patches = new Map([['src/big.ts', patchLines.join('\n')]]);
    const chunks = [makeChunk('src/big.ts', 1, content)];
    const ctx = createTestContext({
      changedFiles: ['src/big.ts'],
      chunks,
      repoChunks: chunks,
      pr: { title: 'Add many fields', body: '', patches } as unknown as ReviewContext['pr'],
    });
    const candidates = computeIncompleteHandlingCandidates(ctx);
    expect(candidates).toHaveLength(10);
    expect(candidates.every(c => c.shape === 'unread-field')).toBe(true);
  });

  it('caps the COMBINED worklist at MAX_TOTAL_CANDIDATES (20) once two shapes together exceed it', () => {
    // 2 pre-existing enum members + 12 newly-added ones, all left unhandled by
    // a consumer that only enumerates the 2 pre-existing members — 12
    // variant-sweep candidates (the per-shape cap for that signal). Combined
    // with the 25-field (capped to 10) unread-field fixture above, that's
    // 22 raw candidates — over MAX_TOTAL_CANDIDATES (20).
    const addedMembers = Array.from({ length: 12 }, (_, i) => `Add${i + 1}`);
    const enumContent = [
      'export enum Color {',
      '  Legacy1,',
      '  Legacy2,',
      ...addedMembers.map(m => `  ${m},`),
      '}',
    ].join('\n');
    const enumPatch = [
      '@@ -1,4 +1,16 @@',
      ' export enum Color {',
      '   Legacy1,',
      '   Legacy2,',
      ...addedMembers.map(m => `+  ${m},`),
      ' }',
    ].join('\n');
    const consumerContent = [
      'function label(c: Color): string {',
      '  switch (c) {',
      '    case Color.Legacy1:',
      "      return 'a';",
      '    case Color.Legacy2:',
      "      return 'b';",
      '    default:',
      "      return 'unknown';",
      '  }',
      '}',
    ].join('\n');

    const fieldLines = Array.from({ length: 25 }, (_, i) => `  field${i}: number;`);
    const fieldContent = ['export interface Big {', ...fieldLines, '}'].join('\n');
    const fieldPatch = [
      '@@ -0,0 +1,27 @@',
      '+export interface Big {',
      ...fieldLines.map(l => `+${l}`),
      '+}',
    ].join('\n');

    const patches = new Map([
      ['src/color.ts', enumPatch],
      ['src/big.ts', fieldPatch],
    ]);
    const chunks = [
      makeChunk('src/color.ts', 1, enumContent),
      makeChunk('src/big.ts', 1, fieldContent),
    ];
    const repoChunks = [...chunks, makeChunk('src/consumer.ts', 1, consumerContent)];
    const ctx = createTestContext({
      changedFiles: ['src/color.ts', 'src/big.ts'],
      chunks,
      repoChunks,
      pr: {
        title: 'Add many variants and fields',
        body: '',
        patches,
      } as unknown as ReviewContext['pr'],
    });

    const candidates = computeIncompleteHandlingCandidates(ctx);
    expect(candidates).toHaveLength(20);
    expect(candidates.filter(c => c.shape === 'variant-sweep')).toHaveLength(12);
    expect(candidates.filter(c => c.shape === 'unread-field')).toHaveLength(8); // 10 capped, then trimmed to fit 20
  });
});

// ---------------------------------------------------------------------------
// computeIncompleteHandlingWorklist — candidate-overflow rank-and-cap
// ---------------------------------------------------------------------------

describe('computeIncompleteHandlingWorklist', () => {
  it('defaults to unlimited budget — defers nothing (byte-identical to before this feature existed)', () => {
    const { candidates, deferredCount, deferredIds } = computeIncompleteHandlingWorklist(
      manyUnreadFieldsContext(6),
    );
    expect(candidates).toHaveLength(6);
    expect(deferredCount).toBe(0);
    expect(deferredIds).toEqual([]);
  });

  it("caps to the ceiling and defers the remainder, preserving the signal's own (fixed-shape) order", () => {
    const ctx = manyUnreadFieldsContext(6);
    // reserve + 2*INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE(12000) leaves room for exactly 2
    // read-heavy candidates.
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 12_000;
    const { candidates, deferredCount, deferredIds } = computeIncompleteHandlingWorklist(
      ctx,
      budget,
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => (c.shape === 'unread-field' ? c.unreadField.field : null))).toEqual([
      'field0',
      'field1',
    ]);
    expect(deferredCount).toBe(4);
    expect(deferredIds).toEqual(['Big.field2', 'Big.field3', 'Big.field4', 'Big.field5']);
  });

  it('reproduces the #820 shape: a 10-candidate run still defers most of them, now at a bounded MAX_BUDGET', () => {
    // 10 unread-field candidates — #820's real production shape (YAML chunking PR, 16 files
    // touched): incompleteHandlingPassBudget scales to 5,000 + 12,000*10 = 125,000, clamped to
    // MAX_BUDGET (65,000). Even at the new, empirically-derived per-candidate rate, funding all
    // 10 outright would cost more than this pass is worth — rank-and-cap honestly defers the
    // rest instead of silently starving (#820's real run: 89,120 spent against an old 11,500
    // budget, never completing).
    const ctx = manyUnreadFieldsContext(10);
    const budget = incompleteHandlingPassBudget(100_000, ctx);
    expect(budget).toBe(65_000);
    const { candidates, deferredCount } = computeIncompleteHandlingWorklist(ctx, budget);
    expect(candidates).toHaveLength(5);
    expect(deferredCount).toBe(5);
  });

  it("a small (1-2 candidate) run is never capped at this pass's own real (floor) budget", () => {
    const ctx = variantOnlyContext();
    const budget = incompleteHandlingPassBudget(100_000, ctx);
    const { candidates, deferredCount } = computeIncompleteHandlingWorklist(ctx, budget);
    expect(candidates).toHaveLength(1);
    expect(deferredCount).toBe(0);
  });

  // Byte-diff census: a realistic (low-candidate) real-PR shape at its ACTUAL
  // production budget must produce prompt output byte-identical to the
  // pre-feature default call — overflow handling changes nothing on the
  // common case.
  it('byte-diff census: the ordinary single-candidate real-PR shape is unaffected at the real budget', () => {
    const ctx = variantOnlyContext();
    const realBudget = incompleteHandlingPassBudget(100_000, ctx);
    expect(buildIncompleteHandlingPassPrompts(ctx, realBudget)).toEqual(
      buildIncompleteHandlingPassPrompts(ctx),
    );
  });
});

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

describe('buildIncompleteHandlingPassPrompts', () => {
  it('hard-cuts the tool list to read_file + get_files_context + grep_codebase', () => {
    const { systemPrompt } = buildIncompleteHandlingPassPrompts(mixedContext());
    expect(systemPrompt).toContain('read_file');
    expect(systemPrompt).toContain('get_files_context');
    expect(systemPrompt).toContain('grep_codebase');
    expect(systemPrompt).not.toContain('get_dependents');
    expect(systemPrompt).not.toContain('list_functions');
    expect(systemPrompt).not.toContain('get_complexity');
  });

  it('includes the incomplete-handling rule strategy and example, scoped to this pass only', () => {
    const { systemPrompt } = buildIncompleteHandlingPassPrompts(mixedContext());
    expect(systemPrompt).toContain('Incomplete Handling Check');
    expect(systemPrompt).toContain('RuleTriggers.filePatterns');
    expect(systemPrompt).not.toContain('Stale Duplicate Literal Check');
    expect(systemPrompt).not.toContain('### Structural Analysis');
  });

  it('includes the false-positive guard against test-double/mock/fixture data', () => {
    const { systemPrompt } = buildIncompleteHandlingPassPrompts(mixedContext());
    expect(systemPrompt).toContain('FALSE-POSITIVE GUARD');
    expect(systemPrompt).toContain('test-double');
  });

  it('requires one findings-array entry per candidate id with the four-value verdict vocabulary', () => {
    const { systemPrompt } = buildIncompleteHandlingPassPrompts(mixedContext());
    expect(systemPrompt).toContain('candidateId');
    expect(systemPrompt).toContain('incomplete | handled | intentional | unverifiable');
    expect(systemPrompt).toContain('candidate-1');
  });

  // Regression for the #814 doc-truth-v2 screen: a real captured vote had the model omit
  // `category` from every per-claim verdict entry, silently dropping them all at
  // `isValidFinding` (which requires `category`) — because the contract's "EVERY entry
  // requires ..." sentence didn't name it, even though the example JSON above it does. This
  // pass's contract shares the identical sentence shape, so it carried the same latent gap.
  it('names category among the required fields, not just in the illustrative example', () => {
    const { systemPrompt } = buildIncompleteHandlingPassPrompts(mixedContext());
    const requiredFieldsSentence = systemPrompt
      .split('\n')
      .find(line => line.startsWith('EVERY entry requires'));
    expect(requiredFieldsSentence).toBeDefined();
    expect(requiredFieldsSentence).toContain('category');
  });

  it('builds an initial message with the worklist tagged by shape', () => {
    const message = buildIncompleteHandlingPassInitialMessage(mixedContext());
    expect(message).toContain('<pr_metadata>');
    expect(message).toContain('<incomplete_handling_candidates>');
    expect(message).toContain('shape="variant-sweep"');
    expect(message).toContain('shape="sibling-surface"');
    expect(message).toContain('shape="unread-field"');
    expect(message).toContain('Color.Green');
    expect(message).toContain('Options.timeout');
  });

  it('does not include competing signal blocks (blast radius, doc claims, stale literal, etc.)', () => {
    const message = buildIncompleteHandlingPassInitialMessage(mixedContext());
    expect(message).not.toContain('<blast_radius>');
    expect(message).not.toContain('<doc_claims>');
    expect(message).not.toContain('<removed_exports>');
    expect(message).not.toContain('<stale_literal_candidates>');
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: contract text differs ONLY when the worklist was capped
  // -------------------------------------------------------------------------

  it('is byte-identical to before this feature existed when the budget is not passed (default unlimited)', () => {
    const ctx = manyUnreadFieldsContext(6);
    const withBudget = buildIncompleteHandlingPassPrompts(ctx, Number.POSITIVE_INFINITY);
    const withoutBudget = buildIncompleteHandlingPassPrompts(ctx);
    expect(withoutBudget).toEqual(withBudget);
    expect(withoutBudget.initialMessage).not.toContain('CANDIDATE OVERFLOW');
  });

  it('lists only the affordable candidates and appends the overflow note when the budget caps the worklist', () => {
    const ctx = manyUnreadFieldsContext(6);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 12_000; // affords 2 of 6
    const { systemPrompt, initialMessage } = buildIncompleteHandlingPassPrompts(ctx, budget);
    expect(systemPrompt).toContain('candidate-1');
    expect(systemPrompt).toContain('candidate-2');
    expect(systemPrompt).not.toContain('candidate-3');
    expect(initialMessage).toContain('field0');
    expect(initialMessage).toContain('field1');
    expect(initialMessage).not.toContain('field2');
    expect(initialMessage).toContain('CANDIDATE OVERFLOW');
    expect(initialMessage).toContain('4 additional eligible candidate(s)');
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('incompleteHandlingPassBudget', () => {
  it('scales with combined candidate count at its own empirically-derived per-candidate rate', () => {
    const budget = incompleteHandlingPassBudget(100_000, variantOnlyContext());
    // 1 candidate: VERDICT_EMISSION_RESERVE_TOKENS(5,000) + 12,000*1 = 17,000 — above the
    // 11,000 shared floor, which no longer binds at this pass's own (higher) rate.
    expect(budget).toBe(17_000);
  });

  it('is independent of the main pass base budget (candidate-count driven, not a fraction)', () => {
    const low = incompleteHandlingPassBudget(10_000, mixedContext());
    const high = incompleteHandlingPassBudget(500_000, mixedContext());
    expect(low).toBe(high);
  });

  it('turn cap is exported and equals INCOMPLETE_PASS_MAX_TURNS', () => {
    expect(INCOMPLETE_HANDLING_PASS_SPEC.maxTurns).toBe(INCOMPLETE_PASS_MAX_TURNS);
  });

  // -------------------------------------------------------------------------
  // The 6 production firings (PR #813/#814/#816/#819/#820/#822) — cap and
  // budget now agree by construction (see INCOMPLETE_HANDLING_TOKENS_PER_CANDIDATE's
  // and BASE_OVERHEAD_TOKENS's doc comments). See the PR body's sanity table
  // for the full before/after per-firing accounting.
  // -------------------------------------------------------------------------

  describe('production firing shapes', () => {
    it('#814/#816 shape (3 candidates): fully funded, nothing deferred', () => {
      const ctx = manyUnreadFieldsContext(3);
      const budget = incompleteHandlingPassBudget(100_000, ctx);
      // 5,000 + 12,000*3 = 41,000 — comfortably above #814's real observed spend (35,191) for
      // this exact candidate count, the one directly-validated data point in the PR body.
      expect(budget).toBe(41_000);
      const { candidates, deferredCount } = computeIncompleteHandlingWorklist(ctx, budget);
      expect(candidates).toHaveLength(3);
      expect(deferredCount).toBe(0);
    });

    it('#820 shape (10 candidates): clamped to MAX_BUDGET, half the worklist honestly deferred', () => {
      const ctx = manyUnreadFieldsContext(10);
      const budget = incompleteHandlingPassBudget(100_000, ctx);
      expect(budget).toBe(65_000);
      const { candidates, deferredCount } = computeIncompleteHandlingWorklist(ctx, budget);
      expect(candidates).toHaveLength(5);
      expect(deferredCount).toBe(5);
    });

    it('#813/#819/#822 shape (15 candidates): clamped to MAX_BUDGET, 10 honestly deferred', () => {
      // 5 variant-sweep + 10 unread-field = 15, mirroring the combined-worklist test above.
      const addedMembers = Array.from({ length: 5 }, (_, i) => `Add${i + 1}`);
      const enumContent = [
        'export enum Color {',
        '  Legacy1,',
        '  Legacy2,',
        ...addedMembers.map(m => `  ${m},`),
        '}',
      ].join('\n');
      const enumPatch = [
        '@@ -1,4 +1,9 @@',
        ' export enum Color {',
        '   Legacy1,',
        '   Legacy2,',
        ...addedMembers.map(m => `+  ${m},`),
        ' }',
      ].join('\n');
      const consumerContent = [
        'function label(c: Color): string {',
        '  switch (c) {',
        '    case Color.Legacy1:',
        "      return 'a';",
        '    case Color.Legacy2:',
        "      return 'b';",
        '    default:',
        "      return 'unknown';",
        '  }',
        '}',
      ].join('\n');
      const fieldLines = Array.from({ length: 10 }, (_, i) => `  field${i}: number;`);
      const fieldContent = ['export interface Big {', ...fieldLines, '}'].join('\n');
      const fieldPatch = [
        '@@ -0,0 +1,12 @@',
        '+export interface Big {',
        ...fieldLines.map(l => `+${l}`),
        '+}',
      ].join('\n');
      const patches = new Map([
        ['src/color.ts', enumPatch],
        ['src/big.ts', fieldPatch],
      ]);
      const chunks = [
        makeChunk('src/color.ts', 1, enumContent),
        makeChunk('src/big.ts', 1, fieldContent),
      ];
      const repoChunks = [...chunks, makeChunk('src/consumer.ts', 1, consumerContent)];
      const ctx = createTestContext({
        changedFiles: ['src/color.ts', 'src/big.ts'],
        chunks,
        repoChunks,
        pr: {
          title: 'Add many variants and fields',
          body: '',
          patches,
        } as unknown as ReviewContext['pr'],
      });
      expect(computeIncompleteHandlingCandidates(ctx)).toHaveLength(15);

      const budget = incompleteHandlingPassBudget(100_000, ctx);
      expect(budget).toBe(65_000);
      const { candidates, deferredCount } = computeIncompleteHandlingWorklist(ctx, budget);
      expect(candidates).toHaveLength(5);
      expect(deferredCount).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// postProcessIncompleteHandlingResult
// ---------------------------------------------------------------------------

describe('postProcessIncompleteHandlingResult', () => {
  it('keeps only verdict:"incomplete" entries as real findings, stripping candidateId/verdict', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'incomplete', message: 'real bug' }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toBe('real bug');
    expect((result.findings[0] as Record<string, unknown>).candidateId).toBeUndefined();
    expect((result.findings[0] as Record<string, unknown>).verdict).toBeUndefined();
  });

  it('drops handled/intentional/unverifiable verdicts entirely', () => {
    for (const verdict of ['handled', 'intentional', 'unverifiable']) {
      const raw = fakeResult({
        findings: [finding({ candidateId: 'candidate-1', verdict, message: 'not a bug' })],
      });
      const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
      expect(result.findings).toHaveLength(0);
    }
  });

  it('is complete when every candidate id got a recognized verdict (single-candidate fixture)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'handled' })],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
  });

  it('marks the result incomplete with stopReason "incomplete_verdict" when a candidate id is missing', () => {
    const raw = fakeResult({ findings: [] }); // candidate-1 never got a verdict
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('keeps the ORIGINAL stopReason when the client was already incomplete for a real reason', () => {
    const raw = fakeResult({ findings: [], incomplete: true, stopReason: 'budget' });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('budget');
  });

  it('does not mutate the input result', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'incomplete' })],
    });
    postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(raw.findings).toHaveLength(1);
    expect((raw.findings[0] as Record<string, unknown>).candidateId).toBe('candidate-1');
  });

  it('is incomplete when a candidate id is present but its verdict is missing', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: undefined, message: 'no verdict' }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    expect(result.findings).toHaveLength(0);
  });

  it('is incomplete when a candidate id is present but its verdict is not a recognized value', () => {
    const raw = fakeResult({
      findings: [
        finding({
          candidateId: 'candidate-1',
          verdict: 'maybe-incomplete' as never,
          message: 'bogus',
        }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when the same candidate id is verdicted twice (duplicate, not "covered")', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable', message: 'first' }),
        finding({ candidateId: 'candidate-1', verdict: 'incomplete', message: 'second' }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
  });

  it('is incomplete when an entry names a candidate id outside the worklist', () => {
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'unverifiable' }),
        finding({
          candidateId: 'candidate-99',
          verdict: 'incomplete',
          message: 'phantom candidate',
        }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    // The phantom out-of-worklist entry must never leak through as a real
    // finding despite carrying verdict:"incomplete" (CodeRabbit finding on
    // this PR: the honesty flag alone doesn't prove it was discarded).
    expect(result.findings).toHaveLength(0);
  });

  it('requires a verdict per id across a mixed (3-shape) worklist', () => {
    const candidates = computeIncompleteHandlingCandidates(mixedContext());
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    // Only the first candidate gets a verdict — the rest are missing.
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'incomplete' })],
    });
    const result = postProcessIncompleteHandlingResult(raw, mixedContext());
    expect(result.incomplete).toBe(true);
    expect(result.stopReason).toBe('incomplete_verdict');
    // The one verdicted candidate still becomes a finding despite the honesty flag.
    expect(result.findings).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Candidate-overflow: deferral is attested, NOT incompleteness
  // -------------------------------------------------------------------------

  it('stamps candidatesDeferred/deferredCandidateIds when the budget capped the worklist', () => {
    const ctx = manyUnreadFieldsContext(6);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 12_000; // affords 2 of 6
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'intentional' }),
        finding({ candidateId: 'candidate-2', verdict: 'intentional' }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, ctx, budget);
    expect(result.candidatesDeferred).toBe(4);
    expect(result.deferredCandidateIds).toEqual([
      'Big.field2',
      'Big.field3',
      'Big.field4',
      'Big.field5',
    ]);
  });

  it('a capped-but-complete run (every LISTED candidate verdicted) stays incomplete:false — deferral is not incompleteness', () => {
    const ctx = manyUnreadFieldsContext(6);
    const budget = VERDICT_EMISSION_RESERVE_TOKENS + 2 * 12_000; // affords 2 of 6
    const raw = fakeResult({
      findings: [
        finding({ candidateId: 'candidate-1', verdict: 'intentional' }),
        finding({ candidateId: 'candidate-2', verdict: 'intentional' }),
      ],
    });
    const result = postProcessIncompleteHandlingResult(raw, ctx, budget);
    expect(result.incomplete).toBe(false);
    expect(result.stopReason).toBe('completed');
    expect(result.candidatesDeferred).toBe(4);
  });

  it('reports candidatesDeferred: 0 and no deferredCandidateIds when nothing was capped (default budget)', () => {
    const raw = fakeResult({
      findings: [finding({ candidateId: 'candidate-1', verdict: 'intentional' })],
    });
    const result = postProcessIncompleteHandlingResult(raw, variantOnlyContext());
    expect(result.candidatesDeferred).toBe(0);
    expect(result.deferredCandidateIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeIncompleteHandlingFindings — loop wins (opposite of doc-truth's dedupe)
// ---------------------------------------------------------------------------

describe('mergeIncompleteHandlingFindings', () => {
  it('drops a main-pass finding at the same location and keeps the loop finding', () => {
    const main = [finding({ line: 20, ruleId: 'incomplete-handling', message: 'main freeform' })];
    const loop = [finding({ line: 20, message: 'loop with evidence' })];

    const merged = mergeIncompleteHandlingFindings(main, loop);

    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe('loop with evidence');
    expect(merged[0].ruleId).toBe('incomplete-handling');
  });

  it('dedupes a nearby main-pass incomplete-handling finding (within ±2 lines) but keeps a distant one', () => {
    const main = [
      finding({ line: 21, ruleId: 'incomplete-handling', message: 'near' }),
      finding({ line: 30, ruleId: 'incomplete-handling', message: 'far' }),
    ];
    const loop = [finding({ line: 20, message: 'loop' })];

    const merged = mergeIncompleteHandlingFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['far', 'loop'].sort());
  });

  it('does NOT drop a nearby main-pass finding from a DIFFERENT rule (proximity alone is not enough)', () => {
    const main = [finding({ line: 20, ruleId: 'error-swallowing', message: 'unrelated real bug' })];
    const loop = [finding({ line: 20, message: 'loop finding' })];

    const merged = mergeIncompleteHandlingFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unrelated real bug']);
  });

  it('does NOT drop a nearby main-pass finding with no ruleId at all', () => {
    const main = [finding({ line: 20, ruleId: undefined, message: 'unattributed' })];
    const loop = [finding({ line: 20, message: 'loop finding' })];

    const merged = mergeIncompleteHandlingFindings(main, loop);

    expect(merged.map(f => f.message).sort()).toEqual(['loop finding', 'unattributed']);
  });

  it('forces ruleId to incomplete-handling on every loop finding', () => {
    const loop = [finding({ ruleId: undefined, message: 'no-rule' })];
    const merged = mergeIncompleteHandlingFindings([], loop);
    expect(merged[0].ruleId).toBe('incomplete-handling');
  });

  it('does not mutate the input arrays', () => {
    const main = [finding({ filepath: 'a.ts', line: 1 })];
    const loop = [finding({ filepath: 'b.ts', line: 1, ruleId: 'x' })];
    mergeIncompleteHandlingFindings(main, loop);
    expect(loop[0].ruleId).toBe('x');
    expect(main).toHaveLength(1);
  });

  it('appends a loop finding on a distinct file alongside an unrelated main finding', () => {
    const main = [finding({ filepath: 'a.ts', line: 1, message: 'unrelated' })];
    const loop = [finding({ filepath: 'b.ts', line: 1, message: 'loop' })];
    const merged = mergeIncompleteHandlingFindings(main, loop);
    expect(merged.map(f => f.message).sort()).toEqual(['loop', 'unrelated']);
  });
});

// ---------------------------------------------------------------------------
// mergeIncompleteHandlingResultState
// ---------------------------------------------------------------------------

describe('mergeIncompleteHandlingResultState', () => {
  it('marks the merged result incomplete, naming this pass via incompleteFromPass', () => {
    const main = fakeResult();
    main.incomplete = false;
    main.stopReason = 'completed';
    const loop = fakeResult({ incomplete: true, stopReason: 'incomplete_verdict' });

    mergeIncompleteHandlingResultState(main, loop);

    expect(main.incomplete).toBe(true);
    expect(main.stopReason).toBe('incomplete_verdict');
    expect(main.incompleteFromPass).toBe('incomplete-handling');
  });

  it('leaves an already-incomplete main pass untouched (no attribution overwrite)', () => {
    const main = fakeResult({ incomplete: true, stopReason: 'max_turns' });
    const loop = fakeResult({ incomplete: true, stopReason: 'budget' });

    mergeIncompleteHandlingResultState(main, loop);

    expect(main.stopReason).toBe('max_turns');
    expect(main.incompleteFromPass).toBeUndefined();
  });

  it('is a no-op when the loop pass is complete or null', () => {
    const main = fakeResult();
    mergeIncompleteHandlingResultState(main, fakeResult());
    expect(main.incomplete).toBe(false);

    mergeIncompleteHandlingResultState(main, null);
    expect(main.incomplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Main-pass interaction override (LIEN_INCOMPLETE_MAIN)
// ---------------------------------------------------------------------------

describe('applyIncompleteHandlingMainOverride / isIncompleteHandlingMainDisabled', () => {
  it('is unchanged by default (flag unset)', () => {
    expect(isIncompleteHandlingMainDisabled()).toBe(false);
    const ctx = variantOnlyContext();
    const rules = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    const result = applyIncompleteHandlingMainOverride(rules);
    expect(result).toBe(rules); // same reference — true no-op
  });

  it('strips incomplete-handling from active and records it as skipped when LIEN_INCOMPLETE_MAIN=off', () => {
    process.env.LIEN_INCOMPLETE_MAIN = 'off';
    expect(isIncompleteHandlingMainDisabled()).toBe(true);
    const ctx = variantOnlyContext();
    const rules = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    expect(rules.active.map(r => r.id)).toContain('incomplete-handling');
    const result = applyIncompleteHandlingMainOverride(rules);
    expect(result.active.map(r => r.id)).not.toContain('incomplete-handling');
    expect(result.skipped.some(s => s.includes('incomplete-handling'))).toBe(true);
  });

  it('is unaffected by an unrelated env value', () => {
    process.env.LIEN_INCOMPLETE_MAIN = 'on';
    expect(isIncompleteHandlingMainDisabled()).toBe(false);
  });

  it('removes all three main-pass signal blocks end-to-end when the override strips the rule', () => {
    const ctx = mixedContext();
    const rulesOn = selectRules(BUILTIN_RULES, buildTriggerContext(ctx));
    const messageOn = buildInitialMessage(ctx, { blastRadius: null, rules: rulesOn });
    expect(messageOn).toContain('<variant_sweep_candidates>');
    expect(messageOn).toContain('<sibling_surfaces>');
    expect(messageOn).toContain('<unread_field_candidates>');

    process.env.LIEN_INCOMPLETE_MAIN = 'off';
    const rulesOff = applyIncompleteHandlingMainOverride(
      selectRules(BUILTIN_RULES, buildTriggerContext(ctx)),
    );
    const messageOff = buildInitialMessage(ctx, { blastRadius: null, rules: rulesOff });
    expect(messageOff).not.toContain('<variant_sweep_candidates>');
    expect(messageOff).not.toContain('<sibling_surfaces>');
    expect(messageOff).not.toContain('<unread_field_candidates>');
  });
});

// ---------------------------------------------------------------------------
// INCOMPLETE_HANDLING_PASS_SPEC (the ReviewPassSpec bundle)
// ---------------------------------------------------------------------------

describe('INCOMPLETE_HANDLING_PASS_SPEC', () => {
  it("wires this module's own pure functions into the ReviewPassSpec contract", () => {
    expect(INCOMPLETE_HANDLING_PASS_SPEC.name).toBe('incomplete-handling-loop');
    expect(INCOMPLETE_HANDLING_PASS_SPEC.skipPlugin).toBe('agent-review:incomplete-handling-loop');
    expect(INCOMPLETE_HANDLING_PASS_SPEC.maxTurns).toBe(INCOMPLETE_PASS_MAX_TURNS);
    expect(INCOMPLETE_HANDLING_PASS_SPEC.mergeFindings).toBe(mergeIncompleteHandlingFindings);
    expect(INCOMPLETE_HANDLING_PASS_SPEC.mergeResultState).toBe(mergeIncompleteHandlingResultState);
    expect(INCOMPLETE_HANDLING_PASS_SPEC.postProcessResult).toBe(
      postProcessIncompleteHandlingResult,
    );
  });

  it('gateReason is incompleteHandlingSkipReason', () => {
    const ctx = variantOnlyContext();
    expect(
      INCOMPLETE_HANDLING_PASS_SPEC.gateReason(ctx, cfg({ incompleteHandlingPass: true })),
    ).toBeNull();
    expect(INCOMPLETE_HANDLING_PASS_SPEC.gateReason(ctx, cfg())).toContain('disabled');
  });

  it('buildPrompts delegates to buildIncompleteHandlingPassPrompts', () => {
    const ctx = mixedContext();
    expect(INCOMPLETE_HANDLING_PASS_SPEC.buildPrompts(ctx)).toEqual(
      buildIncompleteHandlingPassPrompts(ctx),
    );
  });

  it('budget delegates to incompleteHandlingPassBudget', () => {
    const ctx = mixedContext();
    expect(INCOMPLETE_HANDLING_PASS_SPEC.budget(100_000, ctx)).toBe(
      incompleteHandlingPassBudget(100_000, ctx),
    );
  });
});
