import { describe, it, expect } from 'vitest';
import type { ReviewContext } from '../src/plugin-types.js';
import type { BlastRadiusReport } from '../src/blast-radius.js';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  classifyLinePair,
  computeComparisonChanges,
  renderComparisonChangeCandidates,
  renderComparisonChangeSection,
} from '@liendev/parser';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(patches?: Map<string, string>): ReviewContext {
  return {
    pr: patches ? { patches } : undefined,
    chunks: [],
    changedFiles: [],
  } as unknown as ReviewContext;
}

function boundaryChangeRule(): ReviewRule {
  return {
    id: 'boundary-change',
    name: 'Threshold / Boundary Condition Change',
    description: 'test rule',
    prompt: 'test prompt',
    triggers: { always: true },
    severity: 'warning',
    category: 'logic_error',
    enabled: true,
    source: 'builtin',
  };
}

function resolvedRulesWith(...ids: string[]): ResolvedRules {
  return {
    active: ids.map(id => ({ ...boundaryChangeRule(), id })),
    skipped: [],
  };
}

/** A single unified-diff hunk for one file: a `-`/`+` block plus optional surrounding context. */
function patch(hunkHeader: string, ...lines: string[]): Map<string, string> {
  return new Map([['src/example.ts', [hunkHeader, ...lines].join('\n')]]);
}

// ---------------------------------------------------------------------------
// classifyLinePair — the pure heuristic, one positive case per category
// ---------------------------------------------------------------------------

describe('classifyLinePair — operator changes', () => {
  it('flags `<` -> `<=`', () => {
    const r = classifyLinePair('if (a < 5) {', 'if (a <= 5) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('operator');
    expect(r?.oldFragment).toBe('<');
    expect(r?.newFragment).toBe('<=');
  });

  it('flags `>` -> `>=` (the canonical ge-5-threshold-shift shape)', () => {
    const r = classifyLinePair('if (dependentCount > 5) {', 'if (dependentCount >= 5) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('operator');
    expect(r?.oldFragment).toBe('>');
    expect(r?.newFragment).toBe('>=');
  });

  it('flags `==` -> `===`', () => {
    const r = classifyLinePair('if (a == b) {', 'if (a === b) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('operator');
    expect(r?.oldFragment).toBe('==');
    expect(r?.newFragment).toBe('===');
  });

  it('flags `!=` -> `!==`', () => {
    const r = classifyLinePair('if (a != b) {', 'if (a !== b) {');
    expect(r).not.toBeNull();
    expect(r?.oldFragment).toBe('!=');
    expect(r?.newFragment).toBe('!==');
  });

  it('flags `&&` -> `||`', () => {
    const r = classifyLinePair('if (a && b) {', 'if (a || b) {');
    expect(r).not.toBeNull();
    expect(r?.oldFragment).toBe('&&');
    expect(r?.newFragment).toBe('||');
  });

  it('flags a negation added (`isValid(x)` -> `!isValid(x)`)', () => {
    const r = classifyLinePair('if (isValid(x)) {', 'if (!isValid(x)) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('operator');
    expect(r?.newFragment).toBe('!');
    expect(r?.reason).toMatch(/negation.*added/);
  });

  it('flags a negation removed (`!isValid(x)` -> `isValid(x)`)', () => {
    const r = classifyLinePair('if (!isValid(x)) {', 'if (isValid(x)) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('operator');
    expect(r?.oldFragment).toBe('!');
    expect(r?.reason).toMatch(/negation.*removed/);
  });
});

describe('classifyLinePair — numeric literal changes', () => {
  it('flags a literal change inside an `if` condition', () => {
    const r = classifyLinePair('if (x > 5) {', 'if (x > 6) {');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('literal');
    expect(r?.oldFragment).toBe('5');
    expect(r?.newFragment).toBe('6');
  });

  it('flags a literal change inside a `.filter(` predicate', () => {
    const r = classifyLinePair(
      'const big = items.filter(n => n.size > 100);',
      'const big = items.filter(n => n.size > 200);',
    );
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('literal');
    expect(r?.oldFragment).toBe('100');
    expect(r?.newFragment).toBe('200');
  });

  it('does NOT flag a literal change with no conditional/comparison keyword on the line', () => {
    // A config default changing — no `if`/`while`/`?`/comparison operator on
    // this line, so per the module's scope this is out of bounds for (b).
    const r = classifyLinePair(
      'const DEFAULT_TIMEOUT_MS = 500;',
      'const DEFAULT_TIMEOUT_MS = 1000;',
    );
    expect(r).toBeNull();
  });
});

describe('classifyLinePair — index arithmetic', () => {
  it('flags a bare index gaining a `+ 1` delta', () => {
    const r = classifyLinePair('return arr[i];', 'return arr[i + 1];');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('index-arithmetic');
    expect(r?.oldFragment).toBe('i');
    expect(r?.newFragment).toBe('i + 1');
  });

  it('flags `.length` gaining a `- 1` delta', () => {
    const r = classifyLinePair('return arr[arr.length];', 'return arr[arr.length - 1];');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('index-arithmetic');
    expect(r?.oldFragment).toBe('arr.length');
    expect(r?.newFragment).toBe('arr.length - 1');
  });

  it('flags a delta sign flip (`+ 1` -> `- 1`)', () => {
    const r = classifyLinePair('const next = base[i + 1];', 'const next = base[i - 1];');
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('index-arithmetic');
    expect(r?.oldFragment).toBe('i + 1');
    expect(r?.newFragment).toBe('i - 1');
  });
});

describe('classifyLinePair — negative cases', () => {
  it('does not flag a comparison sitting inside a string literal', () => {
    const r = classifyLinePair(
      'const msg = "if (x > 5) return";',
      'const msg = "if (x > 6) return";',
    );
    expect(r).toBeNull();
  });

  it('does not flag a comparison sitting inside a comment', () => {
    const r = classifyLinePair('// if (x > 5) do it', '// if (x > 6) do it');
    expect(r).toBeNull();
  });

  it('does not flag a pure identifier rename with no operator/literal/index change', () => {
    const r = classifyLinePair('if (oldName > 5) {', 'if (newName > 5) {');
    expect(r).toBeNull();
  });

  it('does not flag two structurally unrelated lines', () => {
    const r = classifyLinePair('const timeout = 500;', "import { logger } from './logger';");
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeComparisonChanges — diff + hunk wiring
// ---------------------------------------------------------------------------

describe('computeComparisonChanges', () => {
  it('returns [] when there is no diff', () => {
    expect(computeComparisonChanges(makeContext())).toEqual([]);
  });

  it('pairs a removed/added line within a hunk and reports the new-file line number', () => {
    const patches = patch(
      '@@ -10,3 +10,3 @@',
      ' context line before',
      '-  if (dependentCount > 5) {',
      '+  if (dependentCount >= 5) {',
      ' context line after',
    );
    const candidates = computeComparisonChanges(makeContext(patches));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].file).toBe('src/example.ts');
    expect(candidates[0].kind).toBe('operator');
    expect(candidates[0].line).toBe(11); // the `+` line's new-file line number
  });

  it('does not flag a wholly new (added-only) line — new code, not a boundary CHANGE', () => {
    const patches = patch(
      '@@ -5,0 +6,3 @@',
      '+  if (dependentCount >= 5) {',
      "+    return 'medium';",
      '+  }',
    );
    expect(computeComparisonChanges(makeContext(patches))).toEqual([]);
  });

  it('does not pair two structurally unrelated removed/added lines in the same block', () => {
    const patches = patch(
      '@@ -1,2 +1,2 @@',
      '-const timeout = 500;',
      "+import { logger } from './logger';",
      ' module.exports = {};',
    );
    expect(computeComparisonChanges(makeContext(patches))).toEqual([]);
  });

  it('never pairs a removed line in one hunk with an added line in a different hunk', () => {
    // Same content that WOULD pair within a single hunk, split across two —
    // "same hunk proximity" must be enforced, not just textual similarity.
    const patches = patch(
      '@@ -10,1 +10,1 @@',
      '-  if (dependentCount > 5) {',
      '@@ -50,1 +50,1 @@',
      '+  if (dependentCount >= 5) {',
    );
    expect(computeComparisonChanges(makeContext(patches))).toEqual([]);
  });

  it('handles multiple hunks independently, pairing within each', () => {
    const map = new Map([
      [
        'src/example.ts',
        [
          '@@ -10,1 +10,1 @@',
          '-  if (a > 5) {',
          '+  if (a >= 5) {',
          '@@ -30,1 +30,1 @@',
          '-  if (b < 10) {',
          '+  if (b <= 10) {',
        ].join('\n'),
      ],
    ]);
    const candidates = computeComparisonChanges(makeContext(map));
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.oldFragment).sort()).toEqual(['<', '>']);
  });

  it('skips a test-assertion-noise pair in a test file', () => {
    const map = new Map([
      [
        'src/example.test.ts',
        ['@@ -3,1 +3,1 @@', '-  expect(a > 5).toBe(true);', '+  expect(a > 6).toBe(true);'].join(
          '\n',
        ),
      ],
    ]);
    expect(computeComparisonChanges(makeContext(map))).toEqual([]);
  });

  it('does NOT skip the same shape in a non-test file (proves the filter is scoped)', () => {
    const map = new Map([
      [
        'src/example.ts',
        ['@@ -3,1 +3,1 @@', '-  expect(a > 5).toBe(true);', '+  expect(a > 6).toBe(true);'].join(
          '\n',
        ),
      ],
    ]);
    const candidates = computeComparisonChanges(makeContext(map));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe('literal');
  });
});

// ---------------------------------------------------------------------------
// renderComparisonChangeCandidates — rendering + explicit truncation
// ---------------------------------------------------------------------------

describe('renderComparisonChangeCandidates', () => {
  it('returns empty string for no candidates', () => {
    expect(renderComparisonChangeCandidates([])).toBe('');
  });

  it('renders the block naming file:line, fragments, and kind', () => {
    const rendered = renderComparisonChangeCandidates([
      {
        file: 'src/example.ts',
        line: 11,
        kind: 'operator',
        oldFragment: '>',
        newFragment: '>=',
        reason: 'comparison operator changed from `>` to `>=`',
      },
    ]);
    expect(rendered).toContain('<comparison_change_candidates>');
    expect(rendered).toContain('src/example.ts:11');
    expect(rendered).toContain('`>`');
    expect(rendered).toContain('`>=`');
    expect(rendered).toContain('(operator)');
    expect(rendered).toContain('</comparison_change_candidates>');
  });

  it('caps at MAX_CANDIDATES (10) with an explicit omission note — never truncates silently', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: 10,
      kind: 'operator' as const,
      oldFragment: '>',
      newFragment: '>=',
      reason: 'x',
    }));
    const rendered = renderComparisonChangeCandidates(many);

    for (let i = 0; i < 10; i++) expect(rendered).toContain(`src/f${i}.ts`);
    expect(rendered).toContain('+4 more candidate(s) omitted');
    expect(rendered).not.toContain('src/f13.ts');
  });

  it('omits the truncation note entirely when under the cap', () => {
    const rendered = renderComparisonChangeCandidates([
      {
        file: 'src/a.ts',
        line: 1,
        kind: 'literal',
        oldFragment: '5',
        newFragment: '6',
        reason: 'x',
      },
    ]);
    expect(rendered).not.toContain('omitted');
  });

  // -------------------------------------------------------------------
  // blastRadiusPresent — the header must not tell the agent to consult
  // <blast_radius> when that section isn't actually in the prompt.
  // -------------------------------------------------------------------
  const oneCandidate = [
    {
      file: 'src/example.ts',
      line: 11,
      kind: 'operator' as const,
      oldFragment: '>',
      newFragment: '>=',
      reason: 'x',
    },
  ];

  it('mentions <blast_radius> by default (blastRadiusPresent omitted)', () => {
    expect(renderComparisonChangeCandidates(oneCandidate)).toContain('<blast_radius>');
  });

  it('mentions <blast_radius> when blastRadiusPresent is true', () => {
    expect(renderComparisonChangeCandidates(oneCandidate, true)).toContain('<blast_radius>');
  });

  it('omits any mention of <blast_radius> when blastRadiusPresent is false', () => {
    const rendered = renderComparisonChangeCandidates(oneCandidate, false);
    expect(rendered).not.toContain('<blast_radius>');
    // The rest of the protocol instruction must still be intact.
    expect(rendered).toContain('get_files_context');
  });
});

describe('renderComparisonChangeSection', () => {
  it("returns '' when there is no diff", () => {
    expect(renderComparisonChangeSection(makeContext())).toBe('');
  });

  it('renders candidates found from context', () => {
    const patches = patch('@@ -10,1 +10,1 @@', '-  if (a > 5) {', '+  if (a >= 5) {');
    const rendered = renderComparisonChangeSection(makeContext(patches));
    expect(rendered).toContain('<comparison_change_candidates>');
    expect(rendered).toContain('src/example.ts:10');
  });

  it('forwards blastRadiusPresent to gate the <blast_radius> mention', () => {
    const patches = patch('@@ -10,1 +10,1 @@', '-  if (a > 5) {', '+  if (a >= 5) {');
    const withBlastRadius = renderComparisonChangeSection(makeContext(patches), true);
    const withoutBlastRadius = renderComparisonChangeSection(makeContext(patches), false);
    expect(withBlastRadius).toContain('<blast_radius>');
    expect(withoutBlastRadius).not.toContain('<blast_radius>');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring — gated on the boundary-change rule
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection (rule-gated)', () => {
  const patches = patch('@@ -10,1 +10,1 @@', '-  if (a > 5) {', '+  if (a >= 5) {');

  it('includes the block when boundary-change is active and candidates exist', () => {
    const context = makeContext(patches);
    const message = buildInitialMessage(context, { rules: resolvedRulesWith('boundary-change') });
    expect(message).toContain('<comparison_change_candidates>');
  });

  it('omits the block when rules are not provided at all', () => {
    const context = makeContext(patches);
    const message = buildInitialMessage(context);
    expect(message).not.toContain('<comparison_change_candidates>');
  });

  it('omits the block when boundary-change is not among the active rules', () => {
    const context = makeContext(patches);
    const message = buildInitialMessage(context, {
      rules: resolvedRulesWith('error-swallowing', 'edge-case-sweep'),
    });
    expect(message).not.toContain('<comparison_change_candidates>');
  });

  it('omits the block when the rule is active but no candidates are found', () => {
    const context = makeContext();
    const message = buildInitialMessage(context, { rules: resolvedRulesWith('boundary-change') });
    expect(message).not.toContain('<comparison_change_candidates>');
  });

  // -------------------------------------------------------------------
  // The comparison-change section's own <blast_radius> mention must track
  // whether a <blast_radius> block actually rendered elsewhere in the SAME
  // message — the two sections are otherwise assembled independently, so a
  // caller (e.g. the harness's build-prompts.ts, which hardcodes
  // `blastRadius: null`) must never see an instruction pointing at a tag
  // that isn't present.
  // -------------------------------------------------------------------
  function sampleBlastRadiusReport(): BlastRadiusReport {
    return {
      entries: [
        {
          seed: { filepath: 'src/a.ts', symbolName: 'a', symbolType: 'function', complexity: 1 },
          dependents: [
            {
              filepath: 'src/b.ts',
              symbolName: 'b',
              hops: 1,
              callSiteLine: 3,
              complexity: 2,
              hasTestCoverage: true,
            },
          ],
          risk: { level: 'low', reasoning: ['1 caller'] },
          truncated: false,
        },
      ],
      totalDistinctDependents: 1,
      globalRisk: { level: 'low', reasoning: ['1 caller'] },
      truncated: false,
    };
  }

  it('mentions <blast_radius> in the comparison-change block when a blast-radius report renders', () => {
    const message = buildInitialMessage(makeContext(patches), {
      rules: resolvedRulesWith('boundary-change'),
      blastRadius: sampleBlastRadiusReport(),
    });
    expect(message).toContain('<blast_radius>');
    const comparisonBlock = message.slice(message.indexOf('<comparison_change_candidates>'));
    expect(comparisonBlock).toContain('consult <blast_radius>');
  });

  it('never mentions <blast_radius> in the comparison-change block when no report renders', () => {
    for (const opts of [
      { rules: resolvedRulesWith('boundary-change') },
      { rules: resolvedRulesWith('boundary-change'), blastRadius: null },
      {
        rules: resolvedRulesWith('boundary-change'),
        blastRadius: {
          entries: [],
          totalDistinctDependents: 0,
          globalRisk: { level: 'low' as const, reasoning: [] },
          truncated: false,
        },
      },
    ]) {
      const message = buildInitialMessage(makeContext(patches), opts);
      expect(message).not.toContain('<blast_radius>');
      expect(message).toContain('<comparison_change_candidates>');
      const comparisonBlock = message.slice(message.indexOf('<comparison_change_candidates>'));
      expect(comparisonBlock).not.toContain('blast_radius');
    }
  });
});
