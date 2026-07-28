import { describe, it, expect } from 'vitest';
import {
  truncate,
  envDisabled,
  logTurn,
  extractFindingsFromText,
  extractFindingsWithReasoningFallback,
  readVerdict,
  embeddedJsonObject,
  firstBalancedJsonObject,
  allBalancedJsonObjects,
  isValidSummary,
  isValidFinding,
  AGENT_LOG_MAX,
  computeWrapUpReason,
  logWrapUpReason,
  NEAR_BUDGET_FRACTION,
  MAX_BALANCED_OBJECTS_SCANNED,
  SLIM_RETRY_CONTEXT_MAX_CHARS,
  lastTurnFindingsText,
  buildSlimRetryPrompt,
} from '../src/plugins/agent/agent-client-shared.js';
import { silentLogger } from '../src/test-helpers.js';
import type { Logger } from '../src/logger.js';
import type { TurnTrace } from '../src/plugins/agent/types.js';

// ---------------------------------------------------------------------------
// These helpers were extracted verbatim from anthropic-client.ts /
// openai-client.ts, where they were byte-identical duplicates. The suite
// pins the behavior both clients relied on — especially the fence-priority
// verdict recovery that guards against the #552/#553 silent-bailout incidents.
// ---------------------------------------------------------------------------

const summary = { riskLevel: 'low', overview: 'ok', keyChanges: [] };
const finding = {
  filepath: 'src/x.ts',
  line: 10,
  severity: 'warning',
  category: 'logic_error',
  message: 'off-by-one',
};
const fence = (obj: unknown) => '```json\n' + JSON.stringify(obj) + '\n```';

describe('truncate', () => {
  it('leaves a string at or under the cap unchanged', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('truncates over the cap with a byte-count suffix', () => {
    const out = truncate('abcdef', 3);
    expect(out).toBe('abc\n…[truncated 3 chars]');
  });
});

describe('envDisabled (LIEN_REVIEW_LOG_AGENT parsing)', () => {
  it('disables only for 0/false (case-insensitive)', () => {
    expect(envDisabled('0')).toBe(true);
    expect(envDisabled('false')).toBe(true);
    expect(envDisabled('FALSE')).toBe(true);
    expect(envDisabled('  False  ')).toBe(true);
  });

  it('stays enabled for everything else, incl. unset', () => {
    expect(envDisabled('1')).toBe(false);
    expect(envDisabled('true')).toBe(false);
    expect(envDisabled('')).toBe(false);
    expect(envDisabled(undefined)).toBe(false);
  });
});

describe('logTurn', () => {
  function capturingLogger(): { logger: Logger; lines: string[] } {
    const lines: string[] = [];
    const record = (m: string) => lines.push(m);
    return { logger: { info: record, warning: record, error: record, debug: record }, lines };
  }

  it('is a no-op for an undefined turn', () => {
    const { logger, lines } = capturingLogger();
    logTurn(logger, undefined);
    expect(lines).toHaveLength(0);
  });

  it('prints reasoning and output, tagging with the label', () => {
    const { logger, lines } = capturingLogger();
    const turn: TurnTrace = {
      turnNumber: 3,
      responseText: 'the output',
      reasoning: 'the reasoning',
      toolCalls: [],
      inputTokens: 1,
      outputTokens: 2,
    };
    logTurn(logger, turn, 'last turn before bail');
    expect(lines.some(l => l.includes('Turn 3 reasoning (last turn before bail)'))).toBe(true);
    expect(lines.some(l => l.includes('the reasoning'))).toBe(true);
    expect(lines.some(l => l.includes('Turn 3 output (last turn before bail)'))).toBe(true);
    expect(lines.some(l => l.includes('the output'))).toBe(true);
  });

  it('skips whitespace-only reasoning/output (no blank "output:" line)', () => {
    const { logger, lines } = capturingLogger();
    const turn: TurnTrace = {
      turnNumber: 1,
      responseText: '   ',
      reasoning: undefined,
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
    };
    logTurn(logger, turn);
    expect(lines).toHaveLength(0);
  });

  it('truncates very long reasoning to the log cap', () => {
    const { logger, lines } = capturingLogger();
    const turn: TurnTrace = {
      turnNumber: 1,
      responseText: '',
      reasoning: 'x'.repeat(AGENT_LOG_MAX + 500),
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
    };
    logTurn(logger, turn);
    expect(lines.some(l => l.includes('…[truncated'))).toBe(true);
  });
});

describe('isValidFinding', () => {
  it('accepts a well-formed finding', () => {
    expect(isValidFinding(finding)).toBe(true);
    expect(isValidFinding({ ...finding, severity: 'error' })).toBe(true);
  });

  it('rejects malformed findings', () => {
    expect(isValidFinding(null)).toBe(false);
    expect(isValidFinding('nope')).toBe(false);
    expect(isValidFinding({ ...finding, line: '10' })).toBe(false); // line must be number
    expect(isValidFinding({ ...finding, severity: 'info' })).toBe(false); // bad severity
    expect(isValidFinding({ ...finding, filepath: undefined })).toBe(false);
  });

  /**
   * Regression for the #814 doc-truth-v2 screen: a real captured vote (doc-truth v2, pr658
   * fixture) had the model emit every one of its 48 per-claim verdict entries WITHOUT `category`
   * — including the entry for the Finding B claim (`augment-explore-task.sh:64`,
   * "meaning-based discovery") — while its two ad hoc findings beyond the worklist (not governed
   * by the per-claim contract) both carried `category` normally. Root cause: the v2/stale-
   * duplicate/incomplete-handling output contracts' "EVERY entry requires ..." sentence never
   * named `category`, even though their own example JSON includes it — the model followed the
   * explicit list literally and dropped exactly the one field missing from it. Since this
   * validator silently filters any finding missing `category` (readVerdict's
   * `.filter(isValidFinding)`), that vote lost every per-claim finding, including Finding B,
   * before doc-truth's own verdict-coverage check ever saw them. Fixed by naming `category` in
   * all three contracts' required-field sentences (doc-truth-pass.ts, stale-duplicate-pass.ts,
   * incomplete-handling-pass.ts) rather than relaxing this validator — `category` is load-bearing
   * for every OTHER consumer (engine.ts's dedupe key and rendering, sarif.ts's ruleId, index.ts's
   * architectural/summary partitioning), so making it optional here would push `undefined`
   * through call sites that assume it's always a string.
   */
  it('rejects a real captured per-claim verdict entry missing category (#814)', () => {
    const capturedClaimFourFinding = {
      claimId: 'claim-4',
      verdict: 'contradicted',
      filepath: 'plugins/claude/hooks/augment-explore-task.sh',
      line: 64,
      severity: 'warning',
      // no `category` — this is the exact shape the model emitted for every claim in the
      // affected vote, not a hypothetical.
      message:
        "The hook calls search_code 'REQUIRED for meaning-based discovery', but the tool is " +
        "lexical full-text (BM25) keyword search with no embeddings; 'meaning-based' mislabels " +
        'the mechanism.',
    };
    expect(isValidFinding(capturedClaimFourFinding)).toBe(false);
    // Restoring the field the fixed prompt now explicitly requires is enough to pass.
    expect(isValidFinding({ ...capturedClaimFourFinding, category: 'bug' })).toBe(true);
  });
});

describe('isValidSummary', () => {
  it('accepts a well-formed summary', () => {
    expect(isValidSummary(summary)).toBe(true);
  });

  it('rejects malformed summaries', () => {
    expect(isValidSummary(null)).toBe(false);
    expect(isValidSummary({ riskLevel: 'low', overview: 'ok' })).toBe(false); // no keyChanges
    expect(isValidSummary({ riskLevel: 1, overview: 'ok', keyChanges: [] })).toBe(false);
    expect(isValidSummary({ riskLevel: 'low', overview: 'ok', keyChanges: 'x' })).toBe(false);
  });
});

describe('embeddedJsonObject', () => {
  it('slices the first { to the last } out of prose', () => {
    expect(embeddedJsonObject('before {"a":1} after')).toBe('{"a":1}');
  });

  it('spans nested braces to the outermost close', () => {
    expect(embeddedJsonObject('x {"a":{"b":2}} y')).toBe('{"a":{"b":2}}');
  });

  it('returns undefined when there is no object', () => {
    expect(embeddedJsonObject('no braces here')).toBeUndefined();
    expect(embeddedJsonObject('}{')).toBeUndefined(); // close precedes open
  });
});

describe('firstBalancedJsonObject', () => {
  it('finds a simple object with nothing around it', () => {
    expect(firstBalancedJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('stops at the first balanced close, ignoring trailing content — even more braces', () => {
    // The exact failure mode #792's incomplete-handling canary hit: naive
    // first-{-to-last-} slicing (embeddedJsonObject) overshoots past the real
    // verdict into trailing prose that has its own braces.
    const text = '{"a":1} then some prose with a distractor {not json} in it';
    expect(firstBalancedJsonObject(text)).toBe('{"a":1}');
    expect(embeddedJsonObject(text)).toBe('{"a":1} then some prose with a distractor {not json}');
  });

  it('respects braces inside string literals (does not close early)', () => {
    expect(firstBalancedJsonObject('{"a":"{ not a real close }"}')).toBe(
      '{"a":"{ not a real close }"}',
    );
  });

  it('respects escaped quotes inside strings', () => {
    expect(firstBalancedJsonObject('{"a":"she said \\"hi\\""}')).toBe('{"a":"she said \\"hi\\""}');
  });

  it('handles nested objects, closing at the outermost brace', () => {
    expect(firstBalancedJsonObject('{"a":{"b":2}} trailing junk')).toBe('{"a":{"b":2}}');
  });

  it('returns undefined when there is no opening brace', () => {
    expect(firstBalancedJsonObject('no braces here')).toBeUndefined();
  });

  it('returns undefined when the braces never balance (truncated response)', () => {
    expect(firstBalancedJsonObject('{"a": {"b": 1')).toBeUndefined();
  });
});

describe('allBalancedJsonObjects', () => {
  it('returns a single-element list for one object (matches firstBalancedJsonObject)', () => {
    expect(allBalancedJsonObjects('{"a":1}')).toEqual(['{"a":1}']);
  });

  it('returns an empty list when there is no opening brace', () => {
    expect(allBalancedJsonObjects('no braces here')).toEqual([]);
  });

  it('returns an empty list when the (only) braces never balance', () => {
    expect(allBalancedJsonObjects('{"a": {"b": 1')).toEqual([]);
  });

  it('finds every top-level object in sequence, resuming after each close', () => {
    const text = '{"a":1} between {"b":2} and {"c":3}';
    expect(allBalancedJsonObjects(text)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('stops scanning once a later `{` never balances, keeping the earlier complete ones', () => {
    const text = '{"a":1} then {"b": unbalanced';
    expect(allBalancedJsonObjects(text)).toEqual(['{"a":1}']);
  });

  it('bounds the scan against a pathological run of tiny objects (no hang, no crash)', () => {
    const text = '{}'.repeat(10_000);
    const objects = allBalancedJsonObjects(text);
    expect(objects.length).toBeLessThanOrEqual(MAX_BALANCED_OBJECTS_SCANNED);
    expect(objects.every(o => o === '{}')).toBe(true);
  });

  // Issue #829's residual 25-object-cap gap: a verdict positioned 26th+ in
  // JSON-dense prose was invisible to the old cap. Raising the cap (see
  // MAX_BALANCED_OBJECTS_SCANNED's doc comment for why a higher ceiling is
  // now safe) must actually recover it.
  it('recovers a verdict positioned as the 26th top-level object (#829 residual cap gap)', () => {
    const decoys = Array.from({ length: 25 }, (_, i) => `{"noise":${i}}`).join(' ');
    const verdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: '26th object', keyChanges: [] },
    });
    const text = `${decoys} ${verdict}`;
    const objects = allBalancedJsonObjects(text);
    expect(objects).toHaveLength(26);
    expect(objects[25]).toBe(verdict);
  });

  it('still respects MAX_BALANCED_OBJECTS_SCANNED as a hard ceiling on a huge decoy run', () => {
    const decoys = Array.from(
      { length: MAX_BALANCED_OBJECTS_SCANNED + 50 },
      (_, i) => `{"n":${i}}`,
    ).join(' ');
    const objects = allBalancedJsonObjects(decoys);
    expect(objects).toHaveLength(MAX_BALANCED_OBJECTS_SCANNED);
  });

  // ---------------------------------------------------------------------------
  // Adversarial-review finding F1 on the first cut of this fix: hoisting the
  // string-literal mask to run ONCE over the whole text (instead of fresh per
  // candidate object) was NOT behavior-preserving. An odd number of stray,
  // unescaped double-quote characters ANYWHERE earlier in the text shifts the
  // regex's global quote-pairing and can mask straight over a later verdict's
  // own opening brace, losing it entirely. A truncated `finishReason:'length'`
  // turn naturally ends mid-string-literal — an odd, unterminated quote is
  // the TARGET failure class this whole fix exists for, not an edge case.
  // Per-object re-masking (restored — see `nextBalancedObjectRange`'s doc
  // comment) is immune to this: these must all recover regardless of the
  // stray-quote count/parity earlier in the text.
  // ---------------------------------------------------------------------------
  it('case B: a single stray, unterminated quote in prose before the verdict does not hide it', () => {
    const verdict = JSON.stringify({ findings: [finding], summary });
    const text = `The user's config had a "weird value here.\nHere is my actual verdict:\n${verdict}`;
    expect(allBalancedJsonObjects(text)).toContain(verdict);
  });

  it('case C: the #829 26th-object decoy shape with an added stray quote still recovers the verdict', () => {
    const decoys = Array.from({ length: 25 }, (_, i) => `{"noise":${i}}`).join(' ');
    const verdict = JSON.stringify({
      findings: [],
      summary: { riskLevel: 'low', overview: '26th object with stray quote', keyChanges: [] },
    });
    const text = `${decoys} some "unterminated prose here ${verdict}`;
    expect(allBalancedJsonObjects(text)).toContain(verdict);
  });

  it.each([0, 1, 2, 3, 4])(
    'stray-quote parity sweep: recovers the verdict with %i stray quote(s) earlier in the text',
    count => {
      const verdict = JSON.stringify({
        findings: [],
        summary: { riskLevel: 'low', overview: 'ok', keyChanges: [] },
      });
      const strayQuotes = '"'.repeat(count);
      const text = `Some prose with ${strayQuotes} stray quotes in it.\n${verdict}`;
      expect(allBalancedJsonObjects(text)).toContain(verdict);
    },
  );
});

describe('allBalancedJsonObjects — performance with per-object re-masking restored (#829 F1 correctness fix)', () => {
  // Correctness (F1) requires re-masking each candidate's own remaining
  // suffix instead of sharing one whole-text mask — genuinely
  // O(objects × text length) again. These pin that it stays cheap in
  // ABSOLUTE terms at the 200 cap, per the adversarial-review decision
  // (measured locally: ~26ms/~70ms; generous multiples here to avoid CI
  // flakiness while still catching a real regression) — see
  // `MAX_BALANCED_OBJECTS_SCANNED`'s doc comment for the full benchmark.
  it('stays fast on ~500K chars of realistic decoy density (200 objects)', () => {
    const filler = 'x'.repeat(2000);
    const text = Array.from(
      { length: MAX_BALANCED_OBJECTS_SCANNED },
      (_, i) => `{"n":${i}}${filler}`,
    ).join(' ');

    const start = performance.now();
    const objects = allBalancedJsonObjects(text);
    const elapsed = performance.now() - start;

    expect(objects).toHaveLength(MAX_BALANCED_OBJECTS_SCANNED);
    expect(elapsed).toBeLessThan(500);
  });

  it('stays cheap on the TRUE worst case: 200 decoys clustered up front + a huge brace-free tail', () => {
    const decoysFront = Array.from(
      { length: MAX_BALANCED_OBJECTS_SCANNED },
      (_, i) => `{"n":${i}}`,
    ).join(' ');
    // ~920K chars, no braces at all — every one of the 200 calls re-masks
    // nearly this whole tail, the algorithm's genuine worst case.
    const hugeTail = 'the quick brown fox jumps over the lazy dog. '.repeat(20_000);
    const text = `${decoysFront} ${hugeTail}`;

    const start = performance.now();
    const objects = allBalancedJsonObjects(text);
    const elapsed = performance.now() - start;

    expect(objects).toHaveLength(MAX_BALANCED_OBJECTS_SCANNED);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('readVerdict', () => {
  it('reads a {findings, summary} object', () => {
    const { findings, summary: s } = readVerdict({ findings: [finding], summary });
    expect(findings).toHaveLength(1);
    expect(s).toEqual(summary);
  });

  it('treats a bare array as findings with no summary', () => {
    const { findings, summary: s } = readVerdict([finding, finding]);
    expect(findings).toHaveLength(2);
    expect(s).toBeUndefined();
  });

  it('filters out invalid findings', () => {
    const { findings } = readVerdict({ findings: [finding, { bogus: true }] });
    expect(findings).toHaveLength(1);
  });

  it('drops an invalid summary but keeps findings', () => {
    const { findings, summary: s } = readVerdict({
      findings: [finding],
      summary: { riskLevel: 'low' },
    });
    expect(findings).toHaveLength(1);
    expect(s).toBeUndefined();
  });

  // Kimi emitted `{":  ": [...], "summary": {...}}` on a real calibration run
  // (untrusted-input-validation vote-5, 2026-07-10): findings intact, key
  // mangled. The valid summary made the run look complete, so the findings
  // were silently discarded.
  it('recovers findings under a corrupted key when no findings array exists', () => {
    const { findings, summary: s } = readVerdict({ ':  ': [finding, finding], summary });
    expect(findings).toHaveLength(2);
    expect(s).toEqual(summary);
  });

  it('does not recover from a corrupted key holding anything but pure findings', () => {
    const { findings } = readVerdict({ ':  ': [finding, { bogus: true }], summary });
    expect(findings).toHaveLength(0);
  });

  it('does not second-guess a present findings array (empty means clean review)', () => {
    const { findings } = readVerdict({ findings: [], ':  ': [finding], summary });
    expect(findings).toHaveLength(0);
  });

  it('ignores non-array and empty-array corrupted candidates', () => {
    expect(readVerdict({ oops: 'text', other: [], summary }).findings).toHaveLength(0);
  });

  // Live incident: Lien Review run on PR #772 (2026-07-15, prod Kimi model).
  // findings was a VALID empty array (a genuine clean review) but the summary
  // landed under a leaked chat-template fragment as the key. readVerdict read
  // obj.summary by exact key only, so the run was reported as incomplete
  // ("did not finish, re-run") even though it had actually completed clean.
  // This is the verbatim payload from the log.
  it('recovers a summary emitted under a corrupted key (the PR #772 incident)', () => {
    const parsed = JSON.parse(
      '{"findings":[],":<parameter name=":{"riskLevel":"low","overview":"This PR adds a plan-time complexity nudge.","keyChanges":["added nudge"]}}',
    );
    const { findings, summary: s } = readVerdict(parsed);
    expect(findings).toHaveLength(0);
    expect(s).toEqual({
      riskLevel: 'low',
      overview: 'This PR adds a plan-time complexity nudge.',
      keyChanges: ['added nudge'],
    });
  });

  it('logs a warning naming the corrupted key when the summary is recovered', () => {
    const warnings: string[] = [];
    const logger = { ...silentLogger, warning: (m: string) => void warnings.push(m) };
    readVerdict({ findings: [], corruptKey: summary }, logger);
    expect(warnings.some(m => m.includes('corruptKey'))).toBe(true);
  });

  // Mirror sanity: the pre-existing findings-under-corrupted-key recovery
  // (#723) must be unaffected by adding the summary-side recovery.
  it('still recovers findings under a corrupted key when the summary is valid (no regression)', () => {
    const { findings, summary: s } = readVerdict({ ':  ': [finding, finding], summary });
    expect(findings).toHaveLength(2);
    expect(s).toEqual(summary);
  });

  it('leaves a verdict with both fields valid untouched', () => {
    const { findings, summary: s } = readVerdict({ findings: [finding], summary });
    expect(findings).toHaveLength(1);
    expect(s).toEqual(summary);
  });

  it('stays incomplete when summary is missing and no candidate is summary-shaped', () => {
    const { summary: s } = readVerdict({ findings: [finding], oops: 'text', other: [1, 2, 3] });
    expect(s).toBeUndefined();
  });

  it('stays incomplete when two candidate keys are both summary-shaped (never guess)', () => {
    const candidateA = { riskLevel: 'low', overview: 'A', keyChanges: [] };
    const candidateB = { riskLevel: 'high', overview: 'B', keyChanges: [] };
    const { summary: s } = readVerdict({ findings: [finding], keyA: candidateA, keyB: candidateB });
    expect(s).toBeUndefined();
  });

  // Deliberate precedence: findings-side and summary-side recovery act on
  // disjoint value shapes (arrays vs. summary-shaped objects) and are
  // independent — an invalid/absent findings array does not block summary
  // recovery, and vice versa (each is judged solely on its own key).
  it('recovers the summary even when findings has no valid recovery candidate', () => {
    const { findings, summary: s } = readVerdict({
      oops: [{ bogus: true }], // not a valid findings array — findings recovery fails
      corruptKey: summary, // still a single, unambiguous summary candidate
    });
    expect(findings).toHaveLength(0);
    expect(s).toEqual(summary);
  });
});

describe('extractFindingsFromText (fence-priority verdict recovery)', () => {
  it('parses a single json fence carrying a summary', () => {
    const out = extractFindingsFromText(`Here it is:\n${fence({ findings: [], summary })}`);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(0);
  });

  it('prefers the LAST fence — the real verdict beats an earlier example', () => {
    const example = fence({ findings: [finding], summary: { ...summary, overview: 'EXAMPLE' } });
    const real = fence({ findings: [], summary: { ...summary, overview: 'REAL' } });
    const out = extractFindingsFromText(`Format:\n${example}\n\nMy review:\n${real}`);
    expect(out.summary?.overview).toBe('REAL');
    expect(out.findings).toHaveLength(0);
  });

  it('prefers a summary-bearing candidate over a findings-only one tried first', () => {
    // Candidates are tried last-fence-first. Here the first-tried fence has
    // findings but no summary (sets the fallback); the second-tried fence is the
    // real verdict. The summary marker must override the earlier fallback.
    const findingsOnly = fence({ findings: [finding] });
    const verdict = fence({ findings: [], summary });
    const out = extractFindingsFromText(`${verdict}\n${findingsOnly}`);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(0);
  });

  it('parses a raw JSON body with no fence (forced-verdict turn)', () => {
    const out = extractFindingsFromText(JSON.stringify({ findings: [finding], summary }));
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  it('recovers a JSON object embedded in surrounding prose', () => {
    const verdict = JSON.stringify({ findings: [], summary });
    const out = extractFindingsFromText(`Here is my analysis.\n${verdict}\nThat's everything.`);
    expect(out.summary).toEqual(summary);
  });

  it('falls back to a findings-only verdict when nothing carries a summary', () => {
    const out = extractFindingsFromText(fence({ findings: [finding] }));
    expect(out.summary).toBeUndefined();
    expect(out.findings).toHaveLength(1);
  });

  // End-to-end through the raw-body candidate path with the verbatim #772
  // incident payload (not pre-parsed), proving the recovery reaches a real
  // model response, not just the readVerdict unit.
  it('recovers the verbatim PR #772 incident payload as a complete verdict', () => {
    const raw =
      '{"findings":[],":<parameter name=":{"riskLevel":"low","overview":"This PR adds a plan-time complexity nudge.","keyChanges":["added nudge"]}}';
    const out = extractFindingsFromText(raw);
    expect(out.findings).toHaveLength(0);
    expect(out.summary).toEqual({
      riskLevel: 'low',
      overview: 'This PR adds a plan-time complexity nudge.',
      keyChanges: ['added nudge'],
    });
  });

  it('returns an empty verdict for unparseable / summary-less prose', () => {
    expect(extractFindingsFromText('just some prose, no JSON at all')).toEqual({ findings: [] });
    expect(extractFindingsFromText('')).toEqual({ findings: [] });
  });

  it('skips an unparseable fence (tried first) and recovers from a valid one', () => {
    // The broken fence is placed LAST so it is tried FIRST (fences run in
    // reverse); JSON.parse throws, the loop must continue to the good fence.
    const broken = '```json\n{not valid json,,,}\n```';
    const good = fence({ findings: [], summary });
    const out = extractFindingsFromText(`${good}\n${broken}`);
    expect(out.summary).toEqual(summary);
  });

  // ---------------------------------------------------------------------
  // #792's 3-vote screen surfaced two natural-stop verdict corruption
  // shapes neither #723 nor #775's corrupted-key recovery covers. Both
  // reproduced here from the real captured traces
  // (.wip/traces/2026-07-16T08-4[68]-*, shallow-canary-screen worktree).
  // ---------------------------------------------------------------------

  it('shape A (#792 incomplete-handling): recovers a complete verdict followed by trailing prose with its own braces', () => {
    // Verbatim shape from the real retry-turn capture: a complete, valid
    // verdict, then a stray "```" fence marker, then "Wait, I need to
    // double-check…" prose that goes on to mention another (revised) verdict
    // — i.e. more `{`/`}` characters AFTER the real one. The old
    // embeddedJsonObject slice (first `{` … last `}`) spans across all of it
    // and fails to parse; firstBalancedJsonObject stops at the first close.
    const verdict = JSON.stringify({ findings: [finding], summary });
    const text =
      `\n${verdict}\n` +
      '```\n\n' +
      'Wait, I need to double-check the `requireAdmin` issue. Is it possible that ' +
      'the intent is to keep email-based admin checks alongside roles? Let me ' +
      'reconsider and produce a revised verdict: ' +
      JSON.stringify({ findings: [], summary: { ...summary, overview: 'REVISED' } });
    const out = extractFindingsFromText(text);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  // Issue #829: on a JSON-dense diff, the model's own investigative prose can
  // quote an incidental JSON-shaped fragment (e.g. discussing a literal from
  // the diff) BEFORE its real verdict, unfenced. The single-object scan used
  // to stop at that first (non-verdict) object and never look further;
  // `allBalancedJsonObjects` now tries every one in order, so the real
  // verdict — still the first candidate that carries `summary` — is
  // recovered instead of being shadowed by the earlier fragment.
  it('#829: recovers a verdict that is not the first balanced object in unfenced text', () => {
    const verdict = JSON.stringify({ findings: [finding], summary });
    const text =
      'Issue 7: JSON.stringify({x: NaN}) produces `{"x":null}`. Not a real verdict.\n' +
      `Here is my actual verdict:\n${verdict}`;
    const out = extractFindingsFromText(text);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  // #829's residual cap gap, end to end through the full extraction pipeline
  // (not just `allBalancedJsonObjects` directly, above): a verdict quoted
  // 26th in a JSON-dense investigation used to be invisible under the old
  // 25-object cap — `extractFindingsFromText` returned no summary at all.
  it('#829: recovers a verdict positioned 26th in JSON-dense prose (was invisible under the old 25-object cap)', () => {
    const decoys = Array.from(
      { length: 25 },
      (_, i) => `Issue ${i + 1}: found a JSON-shaped fragment {"n":${i}} while investigating.`,
    ).join('\n');
    const verdict = JSON.stringify({ findings: [finding], summary });
    const text = `${decoys}\nHere is my actual verdict:\n${verdict}`;
    const out = extractFindingsFromText(text);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  // The mirror-image case is a genuine, stated limitation, not a regression:
  // if the EARLIER object also fully mimics the verdict shape (a leaked
  // `<output_format>` contract example carrying its own dummy summary), a
  // purely positional/shape-based scan cannot tell it apart from a real
  // verdict without risking shape A's "trust the original, not a
  // self-revision" behavior above. First-with-summary-wins is the documented
  // trade-off (see `allBalancedJsonObjects`'s doc comment).
  it('shape B (#792 stale-duplicate): a wholesale-corrupted stop-turn stays unrecovered', () => {
    // Verbatim 28-char corrupted payload from both stale-duplicate screen
    // runs. It happens to be syntactically valid JSON (all the punctuation
    // lands inside quoted strings), so it parses — but `findings` is a
    // string, not an array, and no other key is summary-shaped, so
    // readVerdict's validation correctly rejects it. Content recovery here
    // is genuinely impossible; this must stay a `{findings: []}` non-verdict
    // so the caller's retry path (see openai/anthropic-client tests) fires.
    const corrupted = '{"findings":":[{",": ":", "}';
    expect(extractFindingsFromText(corrupted)).toEqual({ findings: [] });
  });

  it('non-regression: still recovers a bare embedded object with no distractor braces (#775 path)', () => {
    // Guards the pre-existing embeddedJsonObject-only path: when the trailing
    // content has no extra braces, firstBalancedJsonObject and
    // embeddedJsonObject agree, and the verdict is recovered either way.
    const verdict = JSON.stringify({ findings: [], summary });
    const out = extractFindingsFromText(`Here is my analysis.\n${verdict}\nThat's everything.`);
    expect(out.summary).toEqual(summary);
  });

  it('logs a warning naming the balanced-object recovery (mirroring #775 style)', () => {
    const warnings: string[] = [];
    const logger = { ...silentLogger, warning: (m: string) => void warnings.push(m) };
    const verdict = JSON.stringify({ findings: [finding], summary });
    const text = `${verdict}\nWait, I need to double-check {this distractor}.`;
    extractFindingsFromText(text, logger);
    expect(warnings.some(m => m.includes('balanced-object extraction'))).toBe(true);
  });

  it('does not log a recovery warning for the plain raw-body / fence paths (no false positives)', () => {
    const warnings: string[] = [];
    const logger = { ...silentLogger, warning: (m: string) => void warnings.push(m) };
    extractFindingsFromText(JSON.stringify({ findings: [finding], summary }), logger);
    extractFindingsFromText(fence({ findings: [], summary }), logger);
    expect(warnings).toHaveLength(0);
  });
});

describe('extractFindingsWithReasoningFallback (reasoning-channel verdict recovery)', () => {
  it('content wins when it carries a verdict, even if reasoning has one too', () => {
    const contentVerdict = fence({ findings: [], summary: { ...summary, overview: 'CONTENT' } });
    const reasoningVerdict = fence({
      findings: [],
      summary: { ...summary, overview: 'REASONING' },
    });
    const out = extractFindingsWithReasoningFallback(contentVerdict, reasoningVerdict);
    expect(out.summary?.overview).toBe('CONTENT');
  });

  it('content wins with findings-only output (content stays authoritative)', () => {
    const contentFindings = fence({ findings: [finding] });
    const reasoningVerdict = fence({ findings: [], summary });
    const out = extractFindingsWithReasoningFallback(contentFindings, reasoningVerdict);
    expect(out.findings).toHaveLength(1);
    expect(out.summary).toBeUndefined();
  });

  it('recovers a fenced verdict from reasoning when content is null', () => {
    const out = extractFindingsWithReasoningFallback(null, fence({ findings: [finding], summary }));
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  it('recovers a raw JSON verdict embedded in reasoning prose (the PR #668 incident shape)', () => {
    const reasoning =
      'We need output findings JSON now. We have already read key files. ' +
      JSON.stringify({ findings: [finding], summary });
    const out = extractFindingsWithReasoningFallback('', reasoning);
    expect(out.summary).toEqual(summary);
    expect(out.findings).toHaveLength(1);
  });

  it('returns empty when neither channel has a verdict', () => {
    const out = extractFindingsWithReasoningFallback('just prose', 'more prose');
    expect(out.findings).toHaveLength(0);
    expect(out.summary).toBeUndefined();
  });

  it('returns empty when both channels are absent', () => {
    const out = extractFindingsWithReasoningFallback(null, undefined);
    expect(out.findings).toHaveLength(0);
  });

  it('logs the recovery when falling back to reasoning', () => {
    const infos: string[] = [];
    const logger = { ...silentLogger, info: (m: string) => void infos.push(m) };
    extractFindingsWithReasoningFallback(null, fence({ findings: [], summary }), logger);
    expect(infos.some(m => m.includes('recovered from the reasoning channel'))).toBe(true);
  });
});

describe('computeWrapUpReason (issue #839 — multi-turn budget accumulation)', () => {
  const base = { totalTokens: 0, turnInputTokens: 0, maxTokenBudget: 20_000, turn: 1, maxTurns: 8 };

  it('returns null when nothing warrants wrapping up', () => {
    expect(computeWrapUpReason({ ...base, totalTokens: 2_000, turnInputTokens: 1_500 })).toBeNull();
  });

  it('reports near-budget once cumulative spend crosses NEAR_BUDGET_FRACTION of the whole budget', () => {
    expect(NEAR_BUDGET_FRACTION).toBe(0.6);
    // 12,000/20,000 = exactly 0.6 — the boundary itself counts.
    expect(computeWrapUpReason({ ...base, totalTokens: 12_000, turnInputTokens: 1_000 })).toBe(
      'near-budget',
    );
    expect(
      computeWrapUpReason({ ...base, totalTokens: 11_999, turnInputTokens: 1_000 }),
    ).toBeNull();
  });

  it('reports last-turn on the final turn the loop allows, even with budget to spare', () => {
    expect(
      computeWrapUpReason({ ...base, totalTokens: 100, turnInputTokens: 50, turn: 7, maxTurns: 8 }),
    ).toBe('last-turn');
    expect(
      computeWrapUpReason({ ...base, totalTokens: 100, turnInputTokens: 50, turn: 6, maxTurns: 8 }),
    ).toBeNull();
  });

  it("reports input-growth when THIS turn's own input already meets/exceeds what's left of the budget, even though cumulative spend is still well under the near-budget fraction (the #839 fix)", () => {
    // 20,000 budget: after this turn, totalTokens=11,500 (< 12,000 near-budget
    // threshold) — the coarse fraction check would NOT yet fire. But this
    // turn's own input (11,500) already meets what's left (8,500): another
    // investigative turn's input can only be as large or larger (history only
    // grows), so it can't possibly fit — the fix forces the wrap-up NOW.
    const result = computeWrapUpReason({
      ...base,
      totalTokens: 11_500,
      turnInputTokens: 11_500,
    });
    expect(result).toBe('input-growth');
  });

  it('input-growth is checked before near-budget/last-turn (priority when multiple would fire)', () => {
    // Cumulative spend is ALSO past the near-budget fraction here, but the
    // more specific input-growth reason wins so logs name the real cause.
    const result = computeWrapUpReason({
      ...base,
      totalTokens: 19_000,
      turnInputTokens: 19_000,
      turn: 7,
      maxTurns: 8,
    });
    expect(result).toBe('input-growth');
  });

  it("does not trigger merely because a turn's input is large in absolute terms, when remaining budget covers it comfortably", () => {
    // A big first turn (10,000 input) on a huge 200,000-token main-pass budget
    // leaves plenty of room (190,000) — must not force wrap-up prematurely.
    expect(
      computeWrapUpReason({
        totalTokens: 10_500,
        turnInputTokens: 10_000,
        maxTokenBudget: 200_000,
        turn: 1,
        maxTurns: 20,
      }),
    ).toBeNull();
  });

  it('reproduces the real doc-truth receipt shape (20,869 allocated / 56,430 spent, issue #839 census) without regressing the existing near-budget classification', () => {
    // Turn 1: input 9,000 (cumulative 9,000) — neither near-budget (< 12,000)
    // nor input-growth (remaining 11,000 > 9,000) fires yet.
    expect(computeWrapUpReason({ ...base, totalTokens: 9_000, turnInputTokens: 9_000 })).toBeNull();
    // Turn 2: input 4,000 (cumulative 13,000) — crosses near-budget (>= 12,000);
    // input-growth alone would NOT have fired here (remaining 7,000 > 4,000) —
    // near-budget is still the reason this specific real-shaped case catches,
    // exactly as it did before this fix (no regression).
    expect(
      computeWrapUpReason({ ...base, totalTokens: 13_000, turnInputTokens: 4_000, turn: 2 }),
    ).toBe('near-budget');
  });
});

describe('logWrapUpReason', () => {
  function capturingLogger(): { logger: Logger; lines: string[] } {
    const lines: string[] = [];
    const record = (m: string) => lines.push(m);
    return { logger: { info: record, warning: record, error: record, debug: record }, lines };
  }

  it('logs an info line naming turn, own-input, and remaining budget for input-growth', () => {
    const { logger, lines } = capturingLogger();
    logWrapUpReason(logger, 'input-growth', 3, 11_500, 8_500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Turn 3');
    expect(lines[0]).toContain('11500');
    expect(lines[0]).toContain('8500');
    expect(lines[0]).toContain('#839');
  });

  it('is a no-op for near-budget/last-turn/null (unchanged, silent pre-#839 behavior)', () => {
    const { logger, lines } = capturingLogger();
    logWrapUpReason(logger, 'near-budget', 2, 1, 1);
    logWrapUpReason(logger, 'last-turn', 7, 1, 1);
    logWrapUpReason(logger, null, 1, 1, 1);
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #829's OTHER remainder (post-#895's require_parameters fix): even a
// compliant, forced-JSON provider can truncate a summary-retry under its own
// token cap, because the pre-fix retry re-sent the FULL accumulated
// conversation (system prompt + every prior turn's tool calls/tool results)
// as its own input. These pin the deterministic, zero-LLM construction of the
// SLIM replacement — see each client's `runSummaryRetry` for how the wire
// format is built from these.
// ---------------------------------------------------------------------------
describe('lastTurnFindingsText', () => {
  it('returns an empty string for an empty turn history', () => {
    expect(lastTurnFindingsText([])).toBe('');
  });

  it('prefers responseText over reasoning when both are present on the last turn', () => {
    expect(
      lastTurnFindingsText([{ responseText: 'the content', reasoning: 'the reasoning' }]),
    ).toBe('the content');
  });

  it('falls back to reasoning when the last turn responseText is empty/whitespace-only', () => {
    expect(lastTurnFindingsText([{ responseText: '   ', reasoning: 'the reasoning' }])).toBe(
      'the reasoning',
    );
    expect(lastTurnFindingsText([{ reasoning: 'the reasoning' }])).toBe('the reasoning');
  });

  it('returns an empty string when every turn has nothing on either channel', () => {
    expect(lastTurnFindingsText([{}])).toBe('');
    expect(lastTurnFindingsText([{ responseText: '', reasoning: '' }])).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(lastTurnFindingsText([{ responseText: '  padded text  ' }])).toBe('padded text');
  });

  // Adversarial-review finding F3 on the first cut of this fix: the LAST turn
  // alone can be a pure tool_calls turn with empty content AND no reasoning
  // (a forced-finish/max-turns bail right after tool-calling, no closing
  // prose) — reading only that one turn returned '', turning the retry into
  // a bare instruction with zero real context (a false-clean risk: the model
  // can fabricate a plausible empty verdict when given nothing to summarize).
  it('falls back to an earlier turn when the LAST turn is empty on both channels (#829 F3 false-clean floor)', () => {
    const turns = [
      { responseText: 'Issue 1: a real concern about null handling.' },
      { responseText: '', toolCalls: [] }, // pure tool_calls turn, no prose
    ];
    expect(lastTurnFindingsText(turns)).toContain('Issue 1: a real concern about null handling.');
  });

  it('walks arbitrarily far back through empty turns to find real content', () => {
    const turns = [
      { responseText: 'the real investigative notes' },
      { responseText: '' },
      { responseText: '' },
      { responseText: '', reasoning: '' },
    ];
    expect(lastTurnFindingsText(turns)).toBe('the real investigative notes');
  });

  it('returns an empty string when EVERY turn in history is empty (nothing to fall back to)', () => {
    const turns = [{ responseText: '' }, { responseText: '', reasoning: '' }, {}];
    expect(lastTurnFindingsText(turns)).toBe('');
  });

  it('concatenates multiple recent non-empty turns, newest first, while under budget', () => {
    const turns = [
      { responseText: 'older investigative notes' },
      { responseText: 'newest investigative notes' },
    ];
    const result = lastTurnFindingsText(turns);
    expect(result.indexOf('newest investigative notes')).toBeLessThan(
      result.indexOf('older investigative notes'),
    );
  });

  it('stops accumulating once the newest turn alone already fills the budget', () => {
    const huge = 'X'.repeat(SLIM_RETRY_CONTEXT_MAX_CHARS + 1);
    const turns = [{ responseText: 'should not appear' }, { responseText: huge }];
    const result = lastTurnFindingsText(turns);
    expect(result).not.toContain('should not appear');
  });
});

describe('buildSlimRetryPrompt', () => {
  const instruction = 'Output ONLY the JSON verdict now.';

  it('wraps the findings text with a label and the instruction', () => {
    const prompt = buildSlimRetryPrompt('Issue 1: something looks off.', instruction);
    expect(prompt).toContain('Issue 1: something looks off.');
    expect(prompt).toContain(instruction);
    // The findings text comes before the instruction — the model reads its
    // own prior analysis, THEN the hard instruction to convert it to JSON.
    expect(prompt.indexOf('Issue 1:')).toBeLessThan(prompt.indexOf(instruction));
  });

  it('falls back to the bare instruction when there is no findings text', () => {
    expect(buildSlimRetryPrompt('', instruction)).toBe(instruction);
    expect(buildSlimRetryPrompt('   ', instruction)).toBe(instruction);
  });

  it('bounds the replayed findings text to SLIM_RETRY_CONTEXT_MAX_CHARS', () => {
    // Mirrors both #829 incidents' own derailed turn: ~227K-262K tokens of
    // "Issue 1: … Issue 21: …" prose — a slim retry built from it must still
    // stay small, not just avoid the OLD full-history problem.
    const huge = 'X'.repeat(SLIM_RETRY_CONTEXT_MAX_CHARS + 5_000);
    const prompt = buildSlimRetryPrompt(huge, instruction);
    expect(prompt.length).toBeLessThan(huge.length);
    expect(prompt).toContain('…[truncated');
    expect(prompt).toContain(instruction);
  });

  it('is deterministic (same inputs, same output — no hidden randomness/state)', () => {
    const a = buildSlimRetryPrompt('some findings', instruction);
    const b = buildSlimRetryPrompt('some findings', instruction);
    expect(a).toBe(b);
  });
});
