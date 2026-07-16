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
  isValidSummary,
  isValidFinding,
  AGENT_LOG_MAX,
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
