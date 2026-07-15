import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  classifyCatchBody,
  computeUndiscriminatedCatches,
  renderUndiscriminatedCatchCandidates,
  renderUndiscriminatedCatchSection,
} from '../src/catch-discrimination-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(file: string, startLine: number, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'function',
      language: 'typescript',
    },
  };
}

function makeContext(opts: {
  patches?: Map<string, string>;
  chunks?: CodeChunk[];
  diffLines?: Map<string, Set<number>>;
}): ReviewContext {
  const pr =
    opts.patches || opts.diffLines
      ? { patches: opts.patches, diffLines: opts.diffLines }
      : undefined;
  return { pr, chunks: opts.chunks ?? [], changedFiles: [] } as unknown as ReviewContext;
}

function errorSwallowingRule(): ReviewRule {
  return {
    id: 'error-swallowing',
    name: 'Silent Error Swallowing',
    description: 'test rule',
    prompt: 'test prompt',
    triggers: { always: true },
    severity: 'error',
    category: 'error_handling',
    enabled: true,
    source: 'builtin',
  };
}

function resolvedRulesWith(...ids: string[]): ResolvedRules {
  return {
    active: ids.map(id => ({ ...errorSwallowingRule(), id })),
    skipped: [],
  };
}

/** All-added unified diff hunk header for a brand-new N-line file. */
function addedHunk(lineCount: number): string {
  return `@@ -0,0 +1,${lineCount} @@`;
}

function asAddedPatch(content: string): string {
  const lines = content.split('\n').map(l => `+${l}`);
  return [addedHunk(lines.length), ...lines].join('\n');
}

// The canonical PR #752 shape: a batch catch that only rethrows when
// comments.length === 0, and otherwise unconditionally falls back to
// postBodyThenRetryCommentsIndividually — regardless of WHY createReview
// failed (auth, rate-limit, 5xx, network all take the same path as a 422).
const PR752_FUNCTION = [
  'export async function postPRReview(octokit, prContext, comments, summaryBody, logger, event) {',
  '  try {',
  '    await octokit.pulls.createReview(reviewParams);',
  '    return { posted: comments.length, dropped: [] };',
  '  } catch (error) {',
  '    if (comments.length === 0) {',
  '      throw error;',
  '    }',
  '    logger.warning(`Failed to post line comments as a batch: ${error}`);',
  '    return postBodyThenRetryCommentsIndividually(',
  '      octokit,',
  '      prContext,',
  '      comments,',
  '      summaryBody,',
  '      logger,',
  '      event,',
  '    );',
  '  }',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// classifyCatchBody — the pure heuristic
// ---------------------------------------------------------------------------

describe('classifyCatchBody', () => {
  it('flags the PR #752 shape: guard-rethrow on an unrelated condition, degrade otherwise', () => {
    const body = [
      '    if (comments.length === 0) {',
      '      throw error;',
      '    }',
      '    logger.warning(`batch failed: ${error}`);',
      '    return postBodyThenRetryCommentsIndividually(octokit, prContext, comments);',
    ].join('\n');
    const reason = classifyCatchBody('error', body);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/every error class alike/);
  });

  it('does not flag a catch that discriminates via instanceof, even with no rethrow', () => {
    const body = [
      '    if (err instanceof ValidationError) {',
      '      return degrade();',
      '    }',
      '    return fallback();',
    ].join('\n');
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not flag a catch that discriminates via a status check on the caught binding', () => {
    const body = [
      '    if (err.status === 422) {',
      '      return degrade();',
      '    }',
      '    return fallback();',
    ].join('\n');
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not flag a catch that unconditionally rethrows at the end', () => {
    const body = ['    logger.error(err);', '    throw err;'].join('\n');
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not flag a catch that only logs (no degrade action)', () => {
    const body = "    logger.error('failed', err);";
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not flag a catch that logs and returns nothing (bare return)', () => {
    const body = ['    logger.error(err);', '    return;'].join('\n');
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not flag a bindingless catch, even one that degrades — no reference to discriminate on', () => {
    // The common "best-effort probe, safe default on ANY failure" idiom
    // (e.g. worktree.ts's `catch { return standalone; }`) — legitimately
    // correct, and there is no binding to check .status/.code/instanceof
    // against even in principle. Found over-firing on this exact shape via
    // the byte-diff census against this repo's own fixtures.
    const body = '    return fallbackResult();';
    expect(classifyCatchBody(null, body)).toBeNull();
  });

  it('flags a catch that degrades via an object-literal return value (real #752 return shape)', () => {
    // Found missed by an earlier version: the brace-depth tracker treated
    // the object literal's own `{}` as a hidden nested block, stripping its
    // content and defeating the value-returning-return check regardless of
    // the trailing semicolon. Caught by Lien Review's own CI pass on this PR.
    const body = [
      '    logger.warning(`batch failed: ${error}`);',
      '    return { posted: 0, dropped: comments };',
    ].join('\n');
    expect(classifyCatchBody('error', body)).not.toBeNull();
  });

  it('flags a degrading return with no trailing semicolon (ASI)', () => {
    const body = '    return fallbackResult()';
    expect(classifyCatchBody('error', body)).not.toBeNull();
  });

  it('does not flag a catch that rethrows with no trailing semicolon (ASI)', () => {
    const body = ['    logger.error(err)', '    throw err'].join('\n');
    expect(classifyCatchBody('err', body)).toBeNull();
  });

  it('does not let a comment fake a discrimination check', () => {
    // Found missed by an earlier version: hasDiscrimination scanned the raw
    // (unmasked) body, so a comment merely mentioning `err.status` or
    // `instanceof` exempted a catch that never actually inspects the error
    // at runtime. Caught by Lien Review's own CI pass on this PR.
    const body = [
      '    // check err.status / instanceof before degrading, but we never do',
      '    return fallback();',
    ].join('\n');
    expect(classifyCatchBody('err', body)).not.toBeNull();
  });

  it('does not flag a rethrow whose call argument is an object literal', () => {
    // Regression: fixing the object-literal-return visibility (see above)
    // made `{}` characters appear in topLevelText for value literals, which
    // broke TRAILING_THROW_RE's original `[^;{}]*` exclusion — a real
    // rethrow like `throw wrapError(err, 'msg', { dbPath });` (found via
    // this module's own byte-diff census against overlay-backend.ts) was
    // no longer recognized as ending in a throw once braces became visible.
    const body = "    throw wrapError(err, 'Failed to initialize', { dbPath: this.dbPath });";
    expect(classifyCatchBody('err', body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeUndiscriminatedCatches — diff + chunk wiring
// ---------------------------------------------------------------------------

describe('computeUndiscriminatedCatches', () => {
  it('returns [] when there is no diff', () => {
    const context = makeContext({ chunks: [makeChunk('src/a.ts', 1, PR752_FUNCTION)] });
    expect(computeUndiscriminatedCatches(context)).toEqual([]);
  });

  it('returns [] when there are no chunks', () => {
    const patches = new Map([['src/a.ts', asAddedPatch(PR752_FUNCTION)]]);
    expect(computeUndiscriminatedCatches(makeContext({ patches }))).toEqual([]);
  });

  it('flags the PR #752 shape when the whole function is added by the diff', () => {
    const patches = new Map([['src/github-api.ts', asAddedPatch(PR752_FUNCTION)]]);
    const chunks = [makeChunk('src/github-api.ts', 1, PR752_FUNCTION)];
    const candidates = computeUndiscriminatedCatches(makeContext({ patches, chunks }));

    expect(candidates).toHaveLength(1);
    expect(candidates[0].file).toBe('src/github-api.ts');
    expect(candidates[0].binding).toBe('error');
    expect(candidates[0].line).toBe(5); // the `} catch (error) {` line
  });

  it('does not flag a catch whose lines the diff never touches', () => {
    // Diff only touches the function signature line (line 1); the catch
    // block (lines 5-18) is pre-existing, unchanged code.
    const patch = [
      '@@ -1,1 +1,1 @@',
      '-export async function postPRReview(octokit, prContext, comments, summaryBody, logger) {',
      '+export async function postPRReview(octokit, prContext, comments, summaryBody, logger, event) {',
    ].join('\n');
    const patches = new Map([['src/github-api.ts', patch]]);
    const chunks = [makeChunk('src/github-api.ts', 1, PR752_FUNCTION)];
    expect(computeUndiscriminatedCatches(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('ignores non-TS/JS files (v1 scope)', () => {
    const patches = new Map([['src/lib.rs', asAddedPatch(PR752_FUNCTION)]]);
    const chunks = [makeChunk('src/lib.rs', 1, PR752_FUNCTION)];
    expect(computeUndiscriminatedCatches(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('does not flag catch-shaped text inside a comment/docstring (not real code)', () => {
    // This exact shape was found over-firing against this repo's own
    // .assertions.ts fixtures, whose docstrings narrate a PR's bug by
    // quoting its code, e.g. "wrapped in try { ... } catch { return false; }".
    const source = [
      '/**',
      ' * PR #411 — PaymentService::charge wrapped in try { ... } catch { return',
      ' * false; }. Throws are silently converted to a `false` result.',
      ' */',
      'export function real() {',
      '  try {',
      '    doThing();',
      '  } catch (err) {',
      '    if (err instanceof ValidationError) return null;',
      '    throw err;',
      '  }',
      '}',
    ].join('\n');
    const patches = new Map([['src/annotated.ts', asAddedPatch(source)]]);
    const chunks = [makeChunk('src/annotated.ts', 1, source)];
    // The only REAL catch clause discriminates + rethrows -> no candidates,
    // and specifically none anchored inside the docstring's line range.
    expect(computeUndiscriminatedCatches(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('handles multiple catch clauses independently: one flagged, one exempt', () => {
    const source = [
      'export function a() {',
      '  try {',
      '    doA();',
      '  } catch (err) {',
      '    if (err instanceof ValidationError) {',
      '      return null;',
      '    }',
      '    throw err;',
      '  }',
      '}',
      '',
      'export function b() {',
      '  try {',
      '    doB();',
      '  } catch (err) {',
      '    return fallback();',
      '  }',
      '}',
    ].join('\n');
    const patches = new Map([['src/two.ts', asAddedPatch(source)]]);
    const chunks = [makeChunk('src/two.ts', 1, source)];
    const candidates = computeUndiscriminatedCatches(makeContext({ patches, chunks }));

    expect(candidates).toHaveLength(1);
    expect(candidates[0].line).toBe(15); // the second function's catch
  });

  it('dedupes when overlapping chunks cover the same catch clause', () => {
    const patches = new Map([['src/github-api.ts', asAddedPatch(PR752_FUNCTION)]]);
    // Two chunks both containing the full function (e.g. an enclosing +
    // nested chunk) must not produce two candidates for the same catch.
    const chunks = [
      makeChunk('src/github-api.ts', 1, PR752_FUNCTION),
      makeChunk('src/github-api.ts', 1, PR752_FUNCTION),
    ];
    const candidates = computeUndiscriminatedCatches(makeContext({ patches, chunks }));
    expect(candidates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// renderUndiscriminatedCatchCandidates — rendering + explicit truncation
// ---------------------------------------------------------------------------

describe('renderUndiscriminatedCatchCandidates', () => {
  it('returns empty string for no candidates', () => {
    expect(renderUndiscriminatedCatchCandidates([])).toBe('');
  });

  it('renders the block naming file:line and the caught binding', () => {
    const rendered = renderUndiscriminatedCatchCandidates([
      {
        file: 'src/github-api.ts',
        line: 5,
        endLine: 18,
        binding: 'error',
        reason: 'treats every error class alike and degrades via a fallback instead of rethrowing',
      },
    ]);
    expect(rendered).toContain('<undiscriminated_catch_candidates>');
    expect(rendered).toContain('src/github-api.ts:5-18');
    expect(rendered).toContain('`error`');
    expect(rendered).toContain('</undiscriminated_catch_candidates>');
  });

  it('caps at MAX_CANDIDATES with an explicit omission note — never truncates silently', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: 10,
      endLine: 20,
      binding: 'err',
      reason: 'treats every error class alike and degrades via a fallback instead of rethrowing',
    }));
    const rendered = renderUndiscriminatedCatchCandidates(many);

    const shownCount = many.slice(0, 10).length;
    for (let i = 0; i < shownCount; i++) expect(rendered).toContain(`src/f${i}.ts`);
    expect(rendered).toContain('+4 more candidate(s) omitted');
    expect(rendered).not.toContain('src/f13.ts');
  });

  it('omits the truncation note entirely when under the cap', () => {
    const rendered = renderUndiscriminatedCatchCandidates([
      { file: 'src/a.ts', line: 1, endLine: 5, binding: 'err', reason: 'x' },
    ]);
    expect(rendered).not.toContain('omitted');
  });
});

describe('renderUndiscriminatedCatchSection', () => {
  it("returns '' when there is no diff or no chunks", () => {
    expect(renderUndiscriminatedCatchSection(makeContext({}))).toBe('');
  });

  it('renders candidates found from context', () => {
    const patches = new Map([['src/github-api.ts', asAddedPatch(PR752_FUNCTION)]]);
    const chunks = [makeChunk('src/github-api.ts', 1, PR752_FUNCTION)];
    const rendered = renderUndiscriminatedCatchSection(makeContext({ patches, chunks }));
    expect(rendered).toContain('<undiscriminated_catch_candidates>');
    expect(rendered).toContain('src/github-api.ts:5-18');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring — gated on the error-swallowing rule
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection (rule-gated)', () => {
  const patches = new Map([['src/github-api.ts', asAddedPatch(PR752_FUNCTION)]]);
  const chunks = [makeChunk('src/github-api.ts', 1, PR752_FUNCTION)];

  it('includes the block when error-swallowing is active and candidates exist', () => {
    const context = makeContext({ patches, chunks });
    const message = buildInitialMessage(context, { rules: resolvedRulesWith('error-swallowing') });
    expect(message).toContain('<undiscriminated_catch_candidates>');
  });

  it('omits the block when rules are not provided at all', () => {
    const context = makeContext({ patches, chunks });
    const message = buildInitialMessage(context);
    expect(message).not.toContain('<undiscriminated_catch_candidates>');
  });

  it('omits the block when error-swallowing is not among the active rules', () => {
    const context = makeContext({ patches, chunks });
    const message = buildInitialMessage(context, {
      rules: resolvedRulesWith('boundary-change', 'edge-case-sweep'),
    });
    expect(message).not.toContain('<undiscriminated_catch_candidates>');
  });

  it('omits the block when the rule is active but no candidates are found', () => {
    const context = makeContext({ chunks: [] });
    const message = buildInitialMessage(context, { rules: resolvedRulesWith('error-swallowing') });
    expect(message).not.toContain('<undiscriminated_catch_candidates>');
  });
});
