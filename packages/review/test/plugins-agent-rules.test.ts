import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  BUILTIN_RULES,
  buildTriggerContext,
  globToRegex,
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

    // Examples
    expect(prompt).toContain('percentChange');
    expect(prompt).toContain('formatRatio');
    expect(prompt).toContain('refundCredit');
    expect(prompt).toContain('fetchUser');
    expect(prompt).toContain('ruleMatchesTriggers'); // incomplete-handling example

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
  });
});
