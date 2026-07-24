/**
 * Wiring-level coverage for the issue #846 citation gate: `ReviewEngine.present()`
 * → `postInlineComments` must consult the CURRENT file content (via octokit)
 * before posting, and drop only findings whose quoted citation demonstrably
 * contradicts it. Pure extraction/verdict logic is covered in
 * `citation-gate.test.ts`; this file proves the gate is actually wired into
 * the delivery path end to end, including the fail-open behavior when the
 * file fetch itself fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReviewEngine } from '../src/engine.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';
import type {
  ReviewPlugin,
  ReviewFinding,
  AdapterContext,
  PresentContext,
} from '../src/plugin-types.js';

function createTestPlugin(overrides?: Partial<ReviewPlugin>): ReviewPlugin {
  return {
    id: 'test',
    name: 'Test Plugin',
    description: 'A test plugin',
    shouldActivate: () => true,
    analyze: () => [],
    ...overrides,
  };
}

function createAdapterContext(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    complexityReport: createTestReport(),
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
    ...overrides,
  };
}

const mockPR = {
  owner: 'test-owner',
  repo: 'test-repo',
  pullNumber: 1,
  title: 'Test PR',
  baseSha: 'abc',
  headSha: 'def',
};

function finding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'test',
    filepath: 'src/a.ts',
    line: 5,
    severity: 'warning',
    category: 'logic_error',
    message: 'Something is off.',
    ...overrides,
  };
}

/** Async iterator over a single page — enough to satisfy `octokit.paginate.iterator`. */
function onePage(data: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { data };
    },
  };
}

/** Build a minimal octokit mock: one file in the diff, no existing PR comments,
 *  a successful review post, and a stubbed `repos.getContent` for the given
 *  file content (or a rejection, to simulate a fetch failure). */
function mockOctokit(opts: { fileContent?: string; getContentFails?: boolean }) {
  const patch = '@@ -1,2 +5,3 @@\n+line5\n+line6\n+line7';
  const octokit = {
    paginate: {
      iterator: vi.fn((fn: unknown) => {
        if (fn === octokit.pulls.listFiles) {
          return onePage([{ filename: 'src/a.ts', patch }]);
        }
        return onePage([]); // listReviewComments — no existing comments
      }),
    },
    pulls: {
      listFiles: vi.fn(),
      listReviewComments: vi.fn(),
      createReview: vi.fn().mockResolvedValue({}),
    },
    repos: {
      getContent: opts.getContentFails
        ? vi.fn().mockRejectedValue(new Error('network error'))
        : vi.fn().mockResolvedValue({
            data: { content: Buffer.from(opts.fileContent ?? '').toString('base64') },
          }),
    },
  };
  return octokit;
}

describe('citation gate wiring (issue #846)', () => {
  it('drops a finding whose quoted citation is absent from the current file, and reports it as citationGated', async () => {
    const octokit = mockOctokit({ fileContent: 'const totallyDifferentCode = 1;' });
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!(
            [finding({ message: 'This hardcodes `paths[0:3]` inline.' })],
            'summary body',
          );
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 1,
      posted: 0,
      dropped: 0,
      deduped: 0,
      citationGated: 1,
    });
    expect(octokit.pulls.createReview).not.toHaveBeenCalled();
  });

  it('delivers a finding whose quoted citation still matches the current file', async () => {
    const octokit = mockOctokit({ fileContent: 'display=${paths[0:3]}\n' });
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!(
            [finding({ message: 'This hardcodes `paths[0:3]` inline.' })],
            'summary body',
          );
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 1,
      posted: 1,
      dropped: 0,
      deduped: 0,
      citationGated: 0,
    });
    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
  });

  it('delivers a finding with no quoted citation at all, untouched', async () => {
    const octokit = mockOctokit({ fileContent: 'irrelevant' });
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!([finding()], 'summary body');
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 1,
      posted: 1,
      dropped: 0,
      deduped: 0,
      citationGated: 0,
    });
  });

  it('fails open when the current-file fetch itself fails — delivers rather than gates', async () => {
    const octokit = mockOctokit({ getContentFails: true });
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!(
            [finding({ message: 'Cites `someRemovedThing()` which is gone.' })],
            'summary body',
          );
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 1,
      posted: 1,
      dropped: 0,
      deduped: 0,
      citationGated: 0,
    });
  });

  it('gates only the stale-citation finding when a real one lands on the same changed file', async () => {
    const octokit = mockOctokit({ fileContent: 'function real() { return stillHere(); }' });
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!(
            [
              finding({ line: 5, message: 'Stale premise citing `longGoneHelper()`.' }),
              finding({
                line: 6,
                message: 'Real finding.',
                evidence: 'Consumer calls `stillHere()` unguarded.',
              }),
            ],
            'summary body',
          );
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 2,
      posted: 1,
      dropped: 0,
      deduped: 0,
      citationGated: 1,
    });
  });
});
