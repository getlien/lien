/**
 * Delivery-truth tests: `present()`'s returned `delivery` counts (and the
 * `postReviewComment` outcome) must reflect what `postPRReview` ACTUALLY did
 * — the real `PostReviewResult` — not the size of the batch a plugin asked
 * to post. Regression coverage for the discard-point bug the delivery
 * attestation design identified (see `.wip/attestation-design.md` §1).
 */
import { describe, it, expect, vi } from 'vitest';
import { ReviewEngine, EMPTY_DELIVERY } from '../src/engine.js';
import { computeVerdict } from '../src/attestation.js';
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

describe('ReviewEngine.present() delivery truth', () => {
  it('inlineComments.{posted,dropped} reflect PostReviewResult, not the attempted count', async () => {
    // Two findings, both anchorable (lines 5 and 6 are in the diff). The batch
    // createReview 422s (a bad-anchor rejection), so the engine falls back to
    // posting the body alone (succeeds) then each comment individually: the
    // first succeeds, the second fails — 1 posted, 1 dropped, of 2 attempted.
    const patch = '@@ -1,2 +5,3 @@\n+line5\n+line6\n+line7';
    const octokit = {
      paginate: {
        iterator: vi.fn((fn: unknown, _params: unknown) => {
          if (fn === octokit.pulls.listFiles) {
            return onePage([{ filename: 'src/a.ts', patch }]);
          }
          return onePage([]); // listReviewComments — no existing comments
        }),
      },
      pulls: {
        listFiles: vi.fn(),
        listReviewComments: vi.fn(),
        createReview: vi
          .fn()
          .mockRejectedValueOnce({ status: 422 }) // batch attempt: bad anchor
          .mockResolvedValueOnce({}), // body-only retry: succeeds
        createReviewComment: vi
          .fn()
          .mockResolvedValueOnce({}) // comment 1: posted
          .mockRejectedValueOnce(new Error('422 Unprocessable')), // comment 2: dropped
      },
    };

    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          await ctx.postInlineComments!(
            [finding({ line: 5 }), finding({ line: 6 })],
            'summary body',
          );
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(result.delivery.inlineComments).toEqual({
      attempted: 2,
      posted: 1,
      dropped: 1,
      deduped: 0,
    });
  });

  it('outOfDiffReviewPosted is true on a successful out-of-diff review comment', async () => {
    const octokit = {
      pulls: { createReview: vi.fn().mockResolvedValue({}) },
    };
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          const outcome = await ctx.postReviewComment!('out of diff notice');
          expect(outcome).toEqual({ posted: true });
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));
    expect(result.delivery.outOfDiffReviewPosted).toBe(true);
  });

  it('outOfDiffReviewPosted is false (not thrown) when the post fails', async () => {
    const octokit = {
      pulls: { createReview: vi.fn().mockRejectedValue(new Error('network error')) },
    };
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          const outcome = await ctx.postReviewComment!('out of diff notice');
          expect(outcome.posted).toBe(false);
          expect(outcome.error).toContain('network error');
        },
      }),
    );

    const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));
    expect(result.delivery.outOfDiffReviewPosted).toBe(false);
  });

  it('outOfDiffReviewPosted stays null when no plugin attempts it', async () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin());
    const result = await engine.present([], createAdapterContext());
    expect(result.delivery.outOfDiffReviewPosted).toBeNull();
  });

  // Regression coverage for the CodeRabbit #768 finding: annotationsEmitted
  // used to report the QUEUED count on every path, even the one where no
  // check run exists to send them to — the real Action flow, since
  // `presentFindings` always calls `present()` with `skipCheckRun: true`.
  describe('annotationsEmitted', () => {
    it('stays 0 when no check run is finalized (skipCheckRun), even if a plugin queued annotations', async () => {
      const engine = new ReviewEngine();
      engine.register(
        createTestPlugin({
          present: async (_findings, ctx: PresentContext) => {
            ctx.addAnnotations([{ path: 'a.ts', line: 1, level: 'warning', message: 'nit' }]);
          },
        }),
      );

      const result = await engine.present([], createAdapterContext(), { skipCheckRun: true });

      expect(result.delivery.annotationsEmitted).toBe(0);
    });

    it('reflects the actual sent count when a check run is created and finalized', async () => {
      const octokit = {
        checks: {
          create: vi.fn().mockResolvedValue({ data: { id: 99 } }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      const engine = new ReviewEngine();
      engine.register(
        createTestPlugin({
          present: async (_findings, ctx: PresentContext) => {
            ctx.addAnnotations([{ path: 'a.ts', line: 1, level: 'warning', message: 'nit' }]);
          },
        }),
      );

      const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

      expect(result.delivery.annotationsEmitted).toBe(1);
      expect(octokit.checks.update).toHaveBeenCalled();
    });
  });

  // Regression coverage for the CodeRabbit #768 finding: updatePRDescription
  // used to swallow every error internally and never reject, so
  // descriptionBadgeUpdated was always true whenever an update was attempted
  // — it could never reflect a real failure.
  describe('descriptionBadgeUpdated', () => {
    it('is null when no plugin contributes a description section', async () => {
      const engine = new ReviewEngine();
      engine.register(createTestPlugin());
      const result = await engine.present([], createAdapterContext({ octokit: {}, pr: mockPR }));
      expect(result.delivery.descriptionBadgeUpdated).toBeNull();
    });

    it('is true when a plugin contributes a description and the update succeeds', async () => {
      const octokit = {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { body: '' } }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      const engine = new ReviewEngine();
      engine.register(
        createTestPlugin({
          present: async (_findings, ctx: PresentContext) => {
            ctx.appendDescription('Some findings.', 'test');
          },
        }),
      );

      const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

      expect(result.delivery.descriptionBadgeUpdated).toBe(true);
    });

    it('is false (not thrown) when the underlying PR update actually fails', async () => {
      const octokit = {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: { body: '' } }),
          update: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
        },
      };
      const engine = new ReviewEngine();
      engine.register(
        createTestPlugin({
          present: async (_findings, ctx: PresentContext) => {
            ctx.appendDescription('Some findings.', 'test');
          },
        }),
      );

      const result = await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

      expect(result.delivery.descriptionBadgeUpdated).toBe(false);
    });
  });
});

// Regression coverage for a finding Lien Review's own dogfooded check caught
// on this PR: `presentFindings` (review-pr.ts) falls back to EMPTY_DELIVERY
// when `engine.present()` itself throws — a delivery ATTEMPT that crashed,
// not one that never happened. Its two nullable fields must be `false`
// (attempted-and-failed), not `null` (never attempted), or a catastrophic
// present() failure would attest 'delivered' via computeVerdict's null
// carve-out.
describe('EMPTY_DELIVERY', () => {
  it('reports description/out-of-diff delivery as failed, not "not attempted"', () => {
    expect(EMPTY_DELIVERY.descriptionBadgeUpdated).toBe(false);
    expect(EMPTY_DELIVERY.outOfDiffReviewPosted).toBe(false);
  });

  it('computes a degraded verdict, not "delivered", from its own shape', () => {
    const verdict = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      mainPass: { name: 'main', ran: false, stopReason: 'not_run', neverRan: false },
      budget: { allocatedTokens: 0, spentTokens: 0, starved: false },
      inlineComments: EMPTY_DELIVERY.inlineComments,
      descriptionBadgeUpdated: EMPTY_DELIVERY.descriptionBadgeUpdated,
      outOfDiffReviewPosted: EMPTY_DELIVERY.outOfDiffReviewPosted,
    });
    expect(verdict).toBe('degraded:delivery_incomplete');
  });
});
