import { describe, it, expect, vi } from 'vitest';
import {
  AgentReviewPlugin,
  partitionByDiffAnchorability,
  buildOutOfDiffReviewBody,
} from '../src/plugins/agent/index.js';
import { silentLogger } from '../src/test-helpers.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';
import type { PRContext } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bug(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: 'src/a.ts',
    line: 10,
    severity: 'warning',
    category: 'logic_error',
    message: 'Something is off here.',
    ...overrides,
  };
}

/** A `summary`-category finding, the shape `appendSummaryFinding` produces. */
function summaryFinding(overrides?: {
  riskLevel?: string;
  overview?: string;
  keyChanges?: string[];
}): ReviewFinding {
  const overview = overrides?.overview ?? 'This PR looks fine overall.';
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'info',
    category: 'summary',
    message: overview,
    metadata: {
      riskLevel: overrides?.riskLevel ?? 'low',
      overview,
      keyChanges: overrides?.keyChanges ?? [],
    },
  };
}

const MARKER = '<!-- lien-plugin:agent-review:';

/** A PresentContext that records every posting call for assertions. */
function recordingContext(overrides?: {
  diffLines?: Map<string, Set<number>>;
  inlineResult?: { posted: number; skipped: number };
}): {
  ctx: PresentContext;
  calls: string[];
  postInlineComments: ReturnType<typeof vi.fn>;
  postReviewComment: ReturnType<typeof vi.fn>;
  minimizeOutdatedComments: ReturnType<typeof vi.fn>;
  appendDescription: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const postInlineComments = vi.fn(async (findings: ReviewFinding[]) => {
    calls.push('postInlineComments');
    return overrides?.inlineResult ?? { posted: findings.length, skipped: 0 };
  });
  const postReviewComment = vi.fn(async () => {
    calls.push('postReviewComment');
  });
  const minimizeOutdatedComments = vi.fn(async () => {
    calls.push('minimizeOutdatedComments');
    return 0;
  });
  const appendDescription = vi.fn();

  const pr = {
    owner: 'o',
    repo: 'r',
    pullNumber: 1,
    title: 't',
    baseSha: 'base',
    headSha: 'head',
    diffLines: overrides?.diffLines,
  } as PRContext;

  const ctx = {
    complexityReport: { files: {}, summary: {} },
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    pr,
    logger: silentLogger,
    addAnnotations: vi.fn(),
    appendSummary: vi.fn(),
    appendDescription,
    postInlineComments,
    postReviewComment,
    minimizeOutdatedComments,
  } as unknown as PresentContext;

  return {
    ctx,
    calls,
    postInlineComments,
    postReviewComment,
    minimizeOutdatedComments,
    appendDescription,
  };
}

// ---------------------------------------------------------------------------
// partitionByDiffAnchorability
// ---------------------------------------------------------------------------

describe('partitionByDiffAnchorability', () => {
  it('anchors a finding whose line is a changed line', () => {
    const diffLines = new Map([['src/a.ts', new Set([10, 11, 12])]]);
    const f = bug({ filepath: 'src/a.ts', line: 11 });
    const { anchorable, unanchorable } = partitionByDiffAnchorability([f], diffLines);
    expect(anchorable).toEqual([f]);
    expect(unanchorable).toEqual([]);
  });

  it('treats a finding in a changed file but on an unchanged line as unanchorable', () => {
    // The exact target case: the file IS in the diff, but the manifestation
    // line (538) is not inside any diff hunk. File-level checks miss this.
    const diffLines = new Map([['src/a.ts', new Set([10, 11, 12])]]);
    const f = bug({ filepath: 'src/a.ts', line: 538 });
    const { anchorable, unanchorable } = partitionByDiffAnchorability([f], diffLines);
    expect(anchorable).toEqual([]);
    expect(unanchorable).toEqual([f]);
  });

  it('treats a finding in an untouched file as unanchorable', () => {
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const f = bug({ filepath: 'src/untouched.ts', line: 5 });
    const { anchorable, unanchorable } = partitionByDiffAnchorability([f], diffLines);
    expect(anchorable).toEqual([]);
    expect(unanchorable).toEqual([f]);
  });

  it('splits a mixed batch correctly', () => {
    const diffLines = new Map([
      ['src/a.ts', new Set([10])],
      ['src/b.ts', new Set([20, 21])],
    ]);
    const inA = bug({ filepath: 'src/a.ts', line: 10 });
    const outA = bug({ filepath: 'src/a.ts', line: 999 });
    const inB = bug({ filepath: 'src/b.ts', line: 21 });
    const { anchorable, unanchorable } = partitionByDiffAnchorability([inA, outA, inB], diffLines);
    expect(anchorable).toEqual([inA, inB]);
    expect(unanchorable).toEqual([outA]);
  });

  it('falls back to all-anchorable when diffLines is undefined', () => {
    const f = bug();
    const { anchorable, unanchorable } = partitionByDiffAnchorability([f], undefined);
    expect(anchorable).toEqual([f]);
    expect(unanchorable).toEqual([]);
  });

  it('falls back to all-anchorable when diffLines is empty', () => {
    const f = bug();
    const { anchorable, unanchorable } = partitionByDiffAnchorability([f], new Map());
    expect(anchorable).toEqual([f]);
    expect(unanchorable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildOutOfDiffReviewBody
// ---------------------------------------------------------------------------

describe('buildOutOfDiffReviewBody', () => {
  it('renders a visible, above-the-fold bullet (no <details> collapse)', () => {
    const body = buildOutOfDiffReviewBody(
      [
        bug({
          filepath: 'packages/parser/src/signals/stale-literal-signals.ts',
          line: 538,
          symbolName: 'renderStaleLiteralSection',
          category: 'logic_error',
          message: 'The timeout flag is discarded, so this function now lies.',
          suggestion: 'Thread the flag through.',
        }),
      ],
      MARKER,
    );

    expect(body).not.toContain('<details>');
    expect(body).toContain('🟡 **logic error**');
    expect(body).toContain('in `renderStaleLiteralSection`');
    expect(body).toContain('`packages/parser/src/signals/stale-literal-signals.ts:538`');
    expect(body).toContain('*(outside this diff)*');
    expect(body).toContain('The timeout flag is discarded');
    expect(body).toContain('💡 *Thread the flag through.*');
  });

  it('embeds the outside-diff dedup marker sharing the plugin prefix', () => {
    const body = buildOutOfDiffReviewBody([bug()], MARKER);
    expect(body.startsWith(`${MARKER}outside-diff -->`)).toBe(true);
    // The minimize call uses the bare prefix; it must substring-match this body.
    expect(body.includes(MARKER)).toBe(true);
  });

  it('uses the error emoji for error findings', () => {
    const body = buildOutOfDiffReviewBody([bug({ severity: 'error' })], MARKER);
    expect(body).toContain('🔴');
  });

  it('pluralizes the headline count', () => {
    expect(buildOutOfDiffReviewBody([bug()], MARKER)).toContain('1 issue relating');
    expect(buildOutOfDiffReviewBody([bug(), bug()], MARKER)).toContain('2 issues relating');
  });

  it('omits the symbol and suggestion fragments when absent', () => {
    const body = buildOutOfDiffReviewBody(
      [bug({ symbolName: undefined, suggestion: undefined })],
      MARKER,
    );
    expect(body).not.toContain(' in `');
    expect(body).not.toContain('💡');
  });
});

// ---------------------------------------------------------------------------
// present() — placement decision & routing
// ---------------------------------------------------------------------------

describe('AgentReviewPlugin.present — out-of-diff promotion', () => {
  const plugin = new AgentReviewPlugin();

  it('anchors in-diff findings inline and promotes out-of-diff findings to the body', async () => {
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const { ctx, postInlineComments, postReviewComment } = recordingContext({ diffLines });

    const inDiff = bug({ filepath: 'src/a.ts', line: 10, message: 'in-diff finding' });
    const outOfDiff = bug({ filepath: 'src/a.ts', line: 538, message: 'out-of-diff finding' });

    await plugin.present([inDiff, outOfDiff], ctx);

    // Inline comments receive ONLY the anchorable finding.
    expect(postInlineComments).toHaveBeenCalledTimes(1);
    const inlineArg = postInlineComments.mock.calls[0][0] as ReviewFinding[];
    expect(inlineArg).toEqual([inDiff]);

    // The promoted body is posted and names the out-of-diff finding.
    expect(postReviewComment).toHaveBeenCalledTimes(1);
    const promoted = postReviewComment.mock.calls[0][0] as string;
    expect(promoted).toContain('`src/a.ts:538`');
    expect(promoted).toContain('out-of-diff finding');
    expect(promoted).not.toContain('<details>');
  });

  it('promotes without posting an inline review when every finding is out-of-diff', async () => {
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const { ctx, postInlineComments, postReviewComment } = recordingContext({ diffLines });

    await plugin.present([bug({ filepath: 'src/a.ts', line: 538 })], ctx);

    expect(postInlineComments).not.toHaveBeenCalled();
    expect(postReviewComment).toHaveBeenCalledTimes(1);
  });

  it('posts no promoted body when every finding is anchorable', async () => {
    const diffLines = new Map([['src/a.ts', new Set([10, 11])]]);
    const { ctx, postInlineComments, postReviewComment } = recordingContext({ diffLines });

    await plugin.present([bug({ line: 10 }), bug({ line: 11 })], ctx);

    expect(postInlineComments).toHaveBeenCalledTimes(1);
    expect(postReviewComment).not.toHaveBeenCalled();
  });

  it('does not count promoted findings as skipped — inline gets only anchorable', async () => {
    // Truthful-counter guarantee: the inline path never sees out-of-diff
    // findings, so its returned `skipped` can only reflect dedup, never
    // promotion.
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const { ctx, postInlineComments } = recordingContext({ diffLines });

    await plugin.present([bug({ line: 10 }), bug({ line: 20 }), bug({ line: 30 })], ctx);

    const inlineArg = postInlineComments.mock.calls[0][0] as ReviewFinding[];
    expect(inlineArg).toHaveLength(1);
    expect(inlineArg[0].line).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Dedup / re-run simulation
// ---------------------------------------------------------------------------

describe('AgentReviewPlugin.present — promoted-body dedup across re-runs', () => {
  const plugin = new AgentReviewPlugin();

  it('minimizes outdated comments before posting, with a marker that matches the promoted body', async () => {
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const { ctx, calls, postReviewComment, minimizeOutdatedComments } = recordingContext({
      diffLines,
    });

    await plugin.present([bug({ filepath: 'src/a.ts', line: 538 })], ctx);

    // Minimize runs first so the previous run's promoted comment collapses.
    expect(calls.indexOf('minimizeOutdatedComments')).toBeLessThan(
      calls.indexOf('postReviewComment'),
    );

    const marker = minimizeOutdatedComments.mock.calls[0][0] as string;
    const promoted = postReviewComment.mock.calls[0][0] as string;
    // The bare prefix passed to minimize substring-matches the promoted body,
    // so GitHub would collapse the prior promoted comment on the next run.
    expect(promoted.includes(marker)).toBe(true);
  });

  it('re-run posts an identical promoted body (stable under minimize+repost)', async () => {
    const diffLines = new Map([['src/a.ts', new Set([10])]]);
    const finding = bug({ filepath: 'src/a.ts', line: 538 });

    const run1 = recordingContext({ diffLines });
    await plugin.present([finding], run1.ctx);

    const run2 = recordingContext({ diffLines });
    await plugin.present([finding], run2.ctx);

    const body1 = run1.postReviewComment.mock.calls[0][0] as string;
    const body2 = run2.postReviewComment.mock.calls[0][0] as string;
    expect(body2).toBe(body1);
    // Each run minimizes before reposting → no double-posting accumulation.
    expect(run2.minimizeOutdatedComments).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PR description — itemized findings (the "narrated, not itemised" bug:
// the header count was already accurate, but the description carried no
// guaranteed rendering of what the counted issues actually were — a real
// finding could sit only in free-form overview prose, or only in a separate
// inline/out-of-diff review comment the description never pointed to).
// ---------------------------------------------------------------------------

describe('AgentReviewPlugin.present — description itemizes bug findings', () => {
  const plugin = new AgentReviewPlugin();

  it('renders a discrete, locatable bullet for each bug finding, matching the header count', async () => {
    const { ctx, appendDescription } = recordingContext();
    const finding = bug({
      filepath: 'packages/cli/src/cli/annotate-cmd.ts',
      line: 70,
      symbolName: 'belowRiskFloor',
      category: 'logic_error',
      message: 'The habituation guard does not clear the floor for dependentAttributionIncomplete.',
      suggestion: 'Add the parameter and return false when true.',
    });

    await plugin.present([finding, summaryFinding()], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('**1 issue found**');
    expect(description).toContain('**Findings (1)**');
    expect(description).toContain('🟡 **logic error** in `belowRiskFloor`');
    expect(description).toContain('`packages/cli/src/cli/annotate-cmd.ts:70`');
    expect(description).toContain(
      'The habituation guard does not clear the floor for dependentAttributionIncomplete.',
    );
    expect(description).toContain('💡 *Add the parameter and return false when true.*');
  });

  it('omits the Findings section entirely on a clean PR — zero reads unambiguously differently from one', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([summaryFinding({ overview: 'Nothing wrong here.' })], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).not.toContain('**Findings');
    expect(description).not.toContain('issue found');
    expect(description).toContain('> [!NOTE]');
  });

  it('surfaces the finding in the description even when the overview prose says nothing is wrong (the #944 shape)', async () => {
    const { ctx, appendDescription } = recordingContext();
    const finding = bug({
      filepath: 'scripts/experiments/dogfood-oss/trial.mjs',
      line: 34,
      category: 'logic_error',
      message: 'trial.mjs still hardcodes the CLI path the sibling script just made configurable.',
    });

    await plugin.present(
      [
        finding,
        summaryFinding({
          overview: 'No callers, exports, or runtime logic are affected.',
          keyChanges: ['mcp-call.mjs now respects LIEN_MCP_CLI'],
        }),
      ],
      ctx,
    );

    const description = appendDescription.mock.calls[0][0] as string;
    // The prose alone never mentions the bug — this was the trap: the count
    // was accurate (1), but nothing in the description said what it was.
    expect(description).toContain('No callers, exports, or runtime logic are affected.');
    expect(description).toContain('**Findings (1)**');
    expect(description).toContain(
      'trial.mjs still hardcodes the CLI path the sibling script just made configurable.',
    );
  });

  it('keeps the header count and the itemized list in lockstep for multiple findings', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present(
      [
        bug({ filepath: 'a.ts', line: 1, message: 'first finding' }),
        bug({ filepath: 'b.ts', line: 2, message: 'second finding' }),
        summaryFinding(),
      ],
      ctx,
    );

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('**2 issues found**');
    expect(description).toContain('**Findings (2)**');
    expect(description).toContain('first finding');
    expect(description).toContain('second finding');
  });

  it('does not conflate descriptive keyChanges bullets with the itemized findings bullets', async () => {
    // The #954/#951 shape: keyChanges bullets describe the diff, not the
    // problem. Both must render, but distinguishably — under separate,
    // clearly labeled sections rather than one flat bullet list.
    const { ctx, appendDescription } = recordingContext();
    const finding = bug({
      filepath: 'packages/cli/src/utils/test-run-matcher.ts',
      line: 143,
      category: 'logic_error',
      message: 'Removing --filter from WORKSPACE_SCOPE_FLAGS regresses pnpm test --filter <pkg>.',
    });

    await plugin.present(
      [
        finding,
        summaryFinding({
          overview: 'This PR fixes a genuine bug in test-run classification.',
          keyChanges: [
            'Name-filtered runs now return {isTestRun: true, broad: false}.',
            'Per-runner-family flag allow-lists avoid collisions.',
          ],
        }),
      ],
      ctx,
    );

    const description = appendDescription.mock.calls[0][0] as string;
    const findingsIdx = description.indexOf('**Findings (1)**');
    const keyChangeIdx = description.indexOf('Name-filtered runs now return');
    expect(findingsIdx).toBeGreaterThan(-1);
    expect(keyChangeIdx).toBeGreaterThan(-1);
    // The keyChanges bullets stay inside the callout blockquote (`>` prefix);
    // the findings section is its own block outside it — never merged into
    // one undifferentiated bullet list.
    expect(description).toContain('> - Name-filtered runs now return');
    expect(description).not.toContain('> - Removing --filter');
  });
});
