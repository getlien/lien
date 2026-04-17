import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  BUILTIN_RULES,
  buildTriggerContext,
  globToRegex,
  safeRegex,
  selectRules,
  type TriggerContext,
} from '../src/plugins/agent/rules.js';
import { buildSystemPrompt } from '../src/plugins/agent/system-prompt.js';
import type { ReviewContext } from '../src/plugin-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTriggerContext(overrides: Partial<TriggerContext> = {}): TriggerContext {
  return {
    languages: overrides.languages ?? new Set<string>(),
    changedFiles: overrides.changedFiles ?? [],
    diffText: overrides.diffText ?? '',
  };
}

function makeChunk(language: string, file: string): CodeChunk {
  return {
    content: '',
    metadata: {
      file,
      language,
      symbolName: 'test',
      symbolType: 'function',
      startLine: 1,
      endLine: 10,
    },
  } as CodeChunk;
}

function makeMinimalReviewContext(
  chunks: CodeChunk[] = [],
  patches?: Map<string, string>,
): ReviewContext {
  return {
    chunks,
    changedFiles: chunks.map(c => c.metadata.file),
    complexityReport: {
      files: [],
      violations: [],
      totals: { files: 0, functions: 0, violations: 0 },
    },
    baselineReport: null,
    deltas: null,
    pluginConfigs: {},
    config: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    pr: patches
      ? ({
          patches,
          title: 'test',
          body: '',
          owner: 'test',
          repo: 'test',
          number: 1,
          headSha: 'abc',
          baseSha: 'def',
        } as any)
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// buildTriggerContext
// ---------------------------------------------------------------------------

describe('buildTriggerContext', () => {
  it('extracts languages from chunk metadata', () => {
    const ctx = makeMinimalReviewContext([
      makeChunk('typescript', 'src/a.ts'),
      makeChunk('php', 'app/B.php'),
      makeChunk('typescript', 'src/c.ts'),
    ]);
    const trigger = buildTriggerContext(ctx);
    expect(trigger.languages).toEqual(new Set(['typescript', 'php']));
  });

  it('extracts changed files', () => {
    const ctx = makeMinimalReviewContext([makeChunk('typescript', 'src/a.ts')]);
    const trigger = buildTriggerContext(ctx);
    expect(trigger.changedFiles).toEqual(['src/a.ts']);
  });

  it('concatenates diff patches into diffText', () => {
    const patches = new Map([
      ['a.ts', '+const x = 1;'],
      ['b.php', '+DB::transaction(function () {'],
    ]);
    const ctx = makeMinimalReviewContext([], patches);
    const trigger = buildTriggerContext(ctx);
    expect(trigger.diffText).toContain('DB::transaction');
    expect(trigger.diffText).toContain('const x = 1');
  });

  it('handles missing patches gracefully', () => {
    const ctx = makeMinimalReviewContext([]);
    const trigger = buildTriggerContext(ctx);
    expect(trigger.diffText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// selectRules
// ---------------------------------------------------------------------------

describe('selectRules', () => {
  it('includes always-true rules regardless of context', () => {
    const ctx = makeTriggerContext();
    const result = selectRules(BUILTIN_RULES, ctx);
    const activeIds = result.active.map(r => r.id);
    expect(activeIds).toContain('structural-analysis');
    expect(activeIds).toContain('edge-case-sweep');
  });

  it('includes incomplete-handling for typed languages', () => {
    const ts = makeTriggerContext({ languages: new Set(['typescript']) });
    expect(selectRules(BUILTIN_RULES, ts).active.map(r => r.id)).toContain('incomplete-handling');

    const go = makeTriggerContext({ languages: new Set(['go']) });
    expect(selectRules(BUILTIN_RULES, go).active.map(r => r.id)).toContain('incomplete-handling');
  });

  it('skips incomplete-handling for untyped languages', () => {
    const py = makeTriggerContext({ languages: new Set(['python']) });
    expect(selectRules(BUILTIN_RULES, py).skipped).toContain('incomplete-handling');

    const js = makeTriggerContext({ languages: new Set(['javascript']) });
    expect(selectRules(BUILTIN_RULES, js).skipped).toContain('incomplete-handling');
  });

  it('skips concurrency-race when diff has no concurrency keywords', () => {
    const ctx = makeTriggerContext({ diffText: 'const x = foo + bar;' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.skipped).toContain('concurrency-race');
    expect(result.active.map(r => r.id)).not.toContain('concurrency-race');
  });

  it('includes concurrency-race when diff contains lockForUpdate', () => {
    const ctx = makeTriggerContext({ diffText: '$query->lockForUpdate()->first();' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('concurrency-race');
  });

  it('includes concurrency-race when diff contains DB::transaction', () => {
    const ctx = makeTriggerContext({ diffText: 'DB::transaction(function () {' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('concurrency-race');
  });

  it('includes concurrency-race when diff contains mutex (case-insensitive)', () => {
    const ctx = makeTriggerContext({ diffText: 'const m = new Mutex();' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('concurrency-race');
  });

  it('includes concurrency-race when diff contains sync.Mutex (Go)', () => {
    const ctx = makeTriggerContext({ diffText: 'var mu sync.Mutex' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('concurrency-race');
  });

  it('includes error-swallowing when diff contains catch block', () => {
    const ctx = makeTriggerContext({
      diffText: 'try {\n  doStuff();\n} catch (e) {\n  // ignore\n}',
    });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('error-swallowing');
  });

  it('includes error-swallowing for Go error handling', () => {
    const ctx = makeTriggerContext({ diffText: 'if err != nil {\n  return nil\n}' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('error-swallowing');
  });

  it('includes error-swallowing for Python except', () => {
    const ctx = makeTriggerContext({ diffText: 'except ValueError:\n    pass' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('error-swallowing');
  });

  it('includes error-swallowing for promise .catch()', () => {
    const ctx = makeTriggerContext({ diffText: 'fetch(url).catch(() => {})' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.active.map(r => r.id)).toContain('error-swallowing');
  });

  it('skips error-swallowing when diff has no error handling', () => {
    const ctx = makeTriggerContext({ diffText: 'const x = a + b;\nreturn x;' });
    const result = selectRules(BUILTIN_RULES, ctx);
    expect(result.skipped).toContain('error-swallowing');
  });

  it('fails open for keyword rules when diff is unavailable', () => {
    const ctx = makeTriggerContext({ diffText: '' });
    const result = selectRules(BUILTIN_RULES, ctx);
    // concurrency-race should be included when diff is empty (fail-open)
    expect(result.active.map(r => r.id)).toContain('concurrency-race');
  });

  it('skips ReDoS-prone keyword patterns', () => {
    const rule: ReviewRule = {
      id: 'test-redos',
      name: 'Test',
      description: 'test',
      prompt: 'test',
      triggers: { keywords: ['(a+)+'] },
      severity: 'warning',
      category: 'test',
      enabled: true,
      source: 'custom',
    };
    const ctx = makeTriggerContext({ diffText: 'aaaaaaaaaaaaaaaa' });
    // Should not match (pattern rejected as ReDoS-prone), and should not hang
    expect(selectRules([rule], ctx).skipped).toContain('test-redos');
  });

  it('skips disabled rules regardless of trigger match', () => {
    const disabledRule: ReviewRule = {
      ...BUILTIN_RULES[0],
      id: 'test-disabled',
      enabled: false,
      triggers: { always: true },
    };
    const ctx = makeTriggerContext();
    const result = selectRules([disabledRule], ctx);
    expect(result.skipped).toContain('test-disabled');
    expect(result.active).toHaveLength(0);
  });

  it('matches language triggers', () => {
    const rule: ReviewRule = {
      id: 'test-lang',
      name: 'Test',
      description: 'test',
      prompt: 'test',
      triggers: { languages: ['rust'] },
      severity: 'warning',
      category: 'test',
      enabled: true,
      source: 'builtin',
    };
    const noMatch = makeTriggerContext({ languages: new Set(['typescript']) });
    expect(selectRules([rule], noMatch).skipped).toContain('test-lang');

    const match = makeTriggerContext({ languages: new Set(['rust', 'typescript']) });
    expect(selectRules([rule], match).active.map(r => r.id)).toContain('test-lang');
  });

  it('matches filePatterns triggers', () => {
    const rule: ReviewRule = {
      id: 'test-patterns',
      name: 'Test',
      description: 'test',
      prompt: 'test',
      triggers: { filePatterns: ['src/services/**'] },
      severity: 'warning',
      category: 'test',
      enabled: true,
      source: 'builtin',
    };

    const noMatch = makeTriggerContext({ changedFiles: ['src/utils/helpers.ts'] });
    expect(selectRules([rule], noMatch).skipped).toContain('test-patterns');

    const match = makeTriggerContext({ changedFiles: ['src/services/auth.ts'] });
    expect(selectRules([rule], match).active.map(r => r.id)).toContain('test-patterns');
  });

  it('matches filePatterns with extension globs', () => {
    const rule: ReviewRule = {
      id: 'test-ext',
      name: 'Test',
      description: 'test',
      prompt: 'test',
      triggers: { filePatterns: ['*.php'] },
      severity: 'warning',
      category: 'test',
      enabled: true,
      source: 'builtin',
    };

    const noMatch = makeTriggerContext({ changedFiles: ['src/app.ts'] });
    expect(selectRules([rule], noMatch).skipped).toContain('test-ext');

    const match = makeTriggerContext({ changedFiles: ['app/Models/User.php'] });
    expect(selectRules([rule], match).skipped).toContain('test-ext'); // *.php only matches root-level

    const rootMatch = makeTriggerContext({ changedFiles: ['config.php'] });
    expect(selectRules([rule], rootMatch).active.map(r => r.id)).toContain('test-ext');
  });

  it('matches filePatterns with ** prefix for any depth', () => {
    const rule: ReviewRule = {
      id: 'test-deep',
      name: 'Test',
      description: 'test',
      prompt: 'test',
      triggers: { filePatterns: ['**/*.php'] },
      severity: 'warning',
      category: 'test',
      enabled: true,
      source: 'builtin',
    };

    const match = makeTriggerContext({ changedFiles: ['app/Models/User.php'] });
    expect(selectRules([rule], match).active.map(r => r.id)).toContain('test-deep');

    const noMatch = makeTriggerContext({ changedFiles: ['app/Models/User.ts'] });
    expect(selectRules([rule], noMatch).skipped).toContain('test-deep');
  });
});

// ---------------------------------------------------------------------------
// globToRegex
// ---------------------------------------------------------------------------

describe('globToRegex', () => {
  it('matches * as non-separator wildcard', () => {
    const re = globToRegex('*.ts');
    expect(re.test('index.ts')).toBe(true);
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('src/foo.ts')).toBe(false); // * does not cross /
    expect(re.test('foo.js')).toBe(false);
  });

  it('matches ** as path-crossing wildcard', () => {
    const re = globToRegex('**/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('a/b/c/foo.ts')).toBe(true);
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('foo.js')).toBe(false);
  });

  it('does not produce false positives with **/ separator', () => {
    const re = globToRegex('src/**/foo.ts');
    expect(re.test('src/foo.ts')).toBe(true); // zero dirs
    expect(re.test('src/bar/foo.ts')).toBe(true); // one dir
    expect(re.test('src/a/b/foo.ts')).toBe(true); // nested dirs
    expect(re.test('src/barfoo.ts')).toBe(false); // no separator — must not match
  });

  it('matches ? as single character', () => {
    const re = globToRegex('?.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('ab.ts')).toBe(false);
  });

  it('handles directory prefix globs', () => {
    const re = globToRegex('src/services/**');
    expect(re.test('src/services/auth.ts')).toBe(true);
    expect(re.test('src/services/deep/nested.ts')).toBe(true);
    expect(re.test('src/utils/helpers.ts')).toBe(false);
  });

  it('escapes regex special characters in pattern', () => {
    const re = globToRegex('file.test.ts');
    expect(re.test('file.test.ts')).toBe(true);
    expect(re.test('filextest.ts')).toBe(false); // dot should be literal
  });

  it('matches exact file path', () => {
    const re = globToRegex('src/index.ts');
    expect(re.test('src/index.ts')).toBe(true);
    expect(re.test('lib/src/index.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  const allActiveRules: ResolvedRules = {
    active: BUILTIN_RULES,
    skipped: [],
  };

  it('contains all key phrases when all rules active', () => {
    const prompt = buildSystemPrompt(allActiveRules);

    // Constant sections
    expect(prompt).toContain('You are a senior code reviewer');
    expect(prompt).toContain('<tools>');
    expect(prompt).toContain('get_dependents');
    expect(prompt).toContain('grep_codebase');
    expect(prompt).toContain('Self-Review');
    expect(prompt).toContain('<rules>');
    expect(prompt).toContain('Report ONLY');
    expect(prompt).toContain('Do NOT report');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('"ruleId"');

    // Structural analysis rule
    expect(prompt).toContain('Structural');
    expect(prompt).toContain('get_files_context');
    expect(prompt).toContain('barrel/index file');

    // Edge case sweep rule
    expect(prompt).toContain('Edge Case Sweep');
    expect(prompt).toContain('NaN, Infinity');
    expect(prompt).toContain('null/undefined');
    expect(prompt).toContain('Boundary values');

    // Concurrency rule
    expect(prompt).toContain('TOCTOU');
    expect(prompt).toContain('lockForUpdate');
    expect(prompt).toContain('Lock ordering');

    // Incomplete handling rule
    expect(prompt).toContain('Incomplete Handling');
    expect(prompt).toContain('Unread fields');
    expect(prompt).toContain('Missing cases');

    // Error swallowing rule
    expect(prompt).toContain('Silent Error Swallowing');
    expect(prompt).toContain('Empty catch/except');
    expect(prompt).toContain('Blanket catch');

    // Examples
    expect(prompt).toContain('percentChange');
    expect(prompt).toContain('formatRatio');
    expect(prompt).toContain('refundCredit');
    expect(prompt).toContain('fetchUser');
    expect(prompt).toContain('ruleMatchesTriggers'); // incomplete-handling example
    expect(prompt).toContain('loadConfig'); // error-swallowing example

    // Bad examples (always included)
    expect(prompt).toContain('DO NOT report');
    expect(prompt).toContain('Consider adding JSDoc');
  });

  it('omits concurrency rule prompt and example when concurrency rule is skipped', () => {
    const rules: ResolvedRules = {
      active: BUILTIN_RULES.filter(r => r.id !== 'concurrency-race'),
      skipped: ['concurrency-race'],
    };
    const prompt = buildSystemPrompt(rules);

    // Concurrency rule prompt content should be absent
    expect(prompt).not.toContain('Concurrency Check');
    expect(prompt).not.toContain('lockForUpdate');
    // Concurrency example should be absent
    expect(prompt).not.toContain('refundCredit');

    // Other rules still present
    expect(prompt).toContain('Edge Case Sweep');
    expect(prompt).toContain('Structural');
    expect(prompt).toContain('Self-Review');
  });

  it('always includes tools section', () => {
    const rules: ResolvedRules = { active: [], skipped: [] };
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('<tools>');
    expect(prompt).toContain('get_dependents');
  });

  it('always includes output format with ruleId', () => {
    const rules: ResolvedRules = { active: [], skipped: [] };
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('"ruleId"');
  });

  it('always includes self-review and bad examples', () => {
    const rules: ResolvedRules = { active: [], skipped: [] };
    const prompt = buildSystemPrompt(rules);
    expect(prompt).toContain('Self-Review');
    expect(prompt).toContain('Bad finding');
  });

  it('includes ruleId in example findings', () => {
    const prompt = buildSystemPrompt(allActiveRules);
    // Examples should demonstrate ruleId usage
    expect(prompt).toContain('"ruleId": "structural-analysis"');
    expect(prompt).toContain('"ruleId": "edge-case-sweep"');
    expect(prompt).toContain('"ruleId": "concurrency-race"');
    expect(prompt).toContain('"ruleId": "incomplete-handling"');
    expect(prompt).toContain('"ruleId": "error-swallowing"');
  });
});

// ---------------------------------------------------------------------------
// boundary-change rule + blast-radius gate
// ---------------------------------------------------------------------------

describe('boundary-change rule', () => {
  it('activates on operator shifts in the diff', () => {
    const ctx = makeTriggerContext({
      diffText:
        '-  if (dependentCount > 5) return "medium";\n+  if (dependentCount >= 5) return "medium";',
    });
    const active = selectRules(BUILTIN_RULES, ctx).active.map(r => r.id);
    expect(active).toContain('boundary-change');
  });

  it('activates when the diff contains threshold-related vocabulary', () => {
    const ctx = makeTriggerContext({
      diffText: '+  const threshold = calculateCutoff(x);',
    });
    const active = selectRules(BUILTIN_RULES, ctx).active.map(r => r.id);
    expect(active).toContain('boundary-change');
  });

  it('activates on strict-equality comparisons with numeric literals', () => {
    const ctx = makeTriggerContext({
      diffText: '-  if (status === 0) throw;\n+  if (status !== 0) throw;',
    });
    const active = selectRules(BUILTIN_RULES, ctx).active.map(r => r.id);
    expect(active).toContain('boundary-change');
  });

  it('activates on comparisons against negative and float literals', () => {
    const negCtx = makeTriggerContext({
      diffText: '+  if (temperature > -10) alert();',
    });
    const floatCtx = makeTriggerContext({
      diffText: '+  if (ratio <= 0.95) retry();',
    });
    expect(selectRules(BUILTIN_RULES, negCtx).active.map(r => r.id)).toContain('boundary-change');
    expect(selectRules(BUILTIN_RULES, floatCtx).active.map(r => r.id)).toContain('boundary-change');
  });

  // CodeRabbit (PR #521) flagged false-positive cases these tests pin down:
  // arrow-function returns and bare uses of the word "severity" must not
  // activate the rule.

  it('does not activate on arrow-function returns like `() => 5`', () => {
    const ctx = makeTriggerContext({
      diffText: '+  const items = arr.map(x => 5);\n+  const fn = () => 42;',
    });
    expect(selectRules(BUILTIN_RULES, ctx).skipped).toContain('boundary-change');
  });

  it('does not activate on bare "severity" references in logger/finding code', () => {
    const ctx = makeTriggerContext({
      diffText: '+  logger.info(`severity is ${finding.severity}`);',
    });
    expect(selectRules(BUILTIN_RULES, ctx).skipped).toContain('boundary-change');
  });

  // PR #521 retest false positive: a docs-only PR added an @example JSDoc
  // block, and the patch's context window happened to include the function
  // body containing `classifyLevel(input)`. The old `classify\w*` keyword
  // matched that context line and activated the rule unnecessarily.
  it('does not activate when the only match is in unchanged context (e.g. a nearby "classifyLevel" call)', () => {
    const ctx = makeTriggerContext({
      diffText: [
        '@@ -70,6 +70,20 @@',
        '   return { level: classifyLevel(input), reasoning: buildReasoning(input) };',
        ' }',
        '+ ',
        '+/**',
        '+ * @example',
        '+ * const risk = computeBlastRadiusRisk({ dependentCount: 14 });',
        "+ * // risk.level === 'high'",
        '+ */',
      ].join('\n'),
    });
    expect(selectRules(BUILTIN_RULES, ctx).skipped).toContain('boundary-change');
  });

  it('does activate on severity in assignment/label context', () => {
    const ctx = makeTriggerContext({
      diffText: "+  const newRule = { severity: 'warning' };",
    });
    expect(selectRules(BUILTIN_RULES, ctx).active.map(r => r.id)).toContain('boundary-change');
  });

  it('is skipped on a diff with no operators, digits, or threshold markers', () => {
    const ctx = makeTriggerContext({
      diffText: '-// old comment\n+// new comment describing the function',
    });
    expect(selectRules(BUILTIN_RULES, ctx).skipped).toContain('boundary-change');
  });

  it('carries requiresBlastRadius=true so the agent gate can detect it', () => {
    const ctx = makeTriggerContext({
      diffText: '+  if (dependentCount >= 5) return "medium";',
    });
    const { active } = selectRules(BUILTIN_RULES, ctx);
    expect(active.some(r => r.requiresBlastRadius === true)).toBe(true);
  });

  it('does not cause other existing rules to require blast radius', () => {
    // Sanity check: only boundary-change opts in via requiresBlastRadius.
    const requiring = BUILTIN_RULES.filter(r => r.requiresBlastRadius === true).map(r => r.id);
    expect(requiring).toEqual(['boundary-change']);
  });
});

// ---------------------------------------------------------------------------
// Keyword sanity invariant
//
// Rules use `safeRegex` (which rejects invalid syntax AND ReDoS-prone nested
// quantifier groups) to compile keyword triggers. If a keyword fails to
// compile, it's silently dropped at runtime — the rule stays registered but
// the keyword never matches anything, and there's no diagnostic path. This
// class of bug hit boundary-change during PR #521 iteration when the
// `\d+(\.\d+)?` pattern tripped REDOS_PATTERN.
//
// This invariant catches the same failure at test time, with a message that
// tells the next rule author exactly what went wrong.
// ---------------------------------------------------------------------------

describe('BUILTIN_RULES keyword sanity', () => {
  for (const rule of BUILTIN_RULES) {
    const keywords = rule.triggers.keywords;
    if (!keywords || keywords.length === 0) continue;

    describe(`${rule.id}`, () => {
      for (const kw of keywords) {
        it(`keyword "${kw}" compiles via safeRegex`, () => {
          const compiled = safeRegex(kw);
          if (compiled === null) {
            throw new Error(
              `Keyword ${JSON.stringify(kw)} in rule '${rule.id}' cannot be compiled by safeRegex. ` +
                `It is either invalid regex syntax OR matches the ReDoS heuristic ` +
                `(nested quantifier groups like \\(\\w+\\)+). ` +
                `At runtime this keyword silently fails to match anything. ` +
                `See rules.ts:safeRegex for the rejection rules.`,
            );
          }
          expect(compiled).toBeInstanceOf(RegExp);
        });
      }
    });
  }
});
