import { describe, it, expect } from 'vitest';
import {
  truncate,
  envDisabled,
  logTurn,
  extractFindingsFromText,
  readVerdict,
  embeddedJsonObject,
  isValidSummary,
  isValidFinding,
  AGENT_LOG_MAX,
} from '../src/plugins/agent/agent-client-shared.js';
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
});
