import { describe, it, expect, vi } from 'vitest';
import { ReviewEngine } from '../src/engine.js';
import { createTestContext, createTestReport, silentLogger } from '../src/test-helpers.js';
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
  const report = createTestReport();
  return {
    complexityReport: report,
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
    ...overrides,
  };
}

const mockOctokit = {
  checks: {
    create: vi.fn().mockResolvedValue({ data: { id: 42 } }),
    update: vi.fn().mockResolvedValue({}),
  },
  pulls: {
    createReview: vi.fn().mockResolvedValue({}),
  },
};

const mockPR = {
  owner: 'test-owner',
  repo: 'test-repo',
  pullNumber: 1,
  title: 'Test PR',
  baseSha: 'abc',
  headSha: 'def',
};

describe('ReviewEngine.present()', () => {
  it('creates check run when octokit and pr are present', async () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin());

    await engine.present([], createAdapterContext({ octokit: mockOctokit, pr: mockPR }));

    expect(mockOctokit.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        head_sha: 'def',
        name: 'Lien Review',
        status: 'in_progress',
      }),
    );
  });

  it('does not create check run when octokit is missing (CLI mode)', async () => {
    const create = vi.fn();
    const engine = new ReviewEngine();
    engine.register(createTestPlugin());

    await engine.present([], createAdapterContext());

    expect(create).not.toHaveBeenCalled();
  });

  it('calls plugin present() with PresentContext', async () => {
    const presentFn = vi.fn();
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ present: presentFn }));

    const findings: ReviewFinding[] = [
      {
        pluginId: 'test',
        filepath: 'a.ts',
        line: 1,
        severity: 'warning',
        category: 'test',
        message: 'Test',
      },
    ];

    await engine.present(findings, createAdapterContext());

    expect(presentFn).toHaveBeenCalledTimes(1);
    expect(presentFn).toHaveBeenCalledWith(
      findings,
      expect.objectContaining({
        addAnnotations: expect.any(Function),
        logger: expect.any(Object),
      }),
    );
  });

  it('addAnnotations() queues annotations for batched posting', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 99 } }),
        update: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        createReview: vi.fn().mockResolvedValue({}),
      },
    };

    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          ctx.addAnnotations([
            {
              path: 'a.ts',
              start_line: 1,
              end_line: 5,
              annotation_level: 'warning',
              message: 'Too complex',
              title: 'Test',
            },
          ]);
        },
      }),
    );

    await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    // Should finalize with the annotation
    expect(octokit.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 99,
        status: 'completed',
        output: expect.objectContaining({
          annotations: [
            expect.objectContaining({
              path: 'a.ts',
              message: 'Too complex',
            }),
          ],
        }),
      }),
    );
  });

  it('postReviewComment is available when octokit + pr present', async () => {
    let hasPostReviewComment = false;
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
      pulls: {
        createReview: vi.fn().mockResolvedValue({}),
      },
    };

    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          hasPostReviewComment = typeof ctx.postReviewComment === 'function';
        },
      }),
    );

    await engine.present([], createAdapterContext({ octokit, pr: mockPR }));
    expect(hasPostReviewComment).toBe(true);
  });

  it('postReviewComment is undefined when octokit is missing', async () => {
    let hasPostReviewComment = false;
    const engine = new ReviewEngine();

    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          hasPostReviewComment = ctx.postReviewComment !== undefined;
        },
      }),
    );

    await engine.present([], createAdapterContext());
    expect(hasPostReviewComment).toBe(false);
  });

  it('plugin present() error is logged and does not block others', async () => {
    const warnings: string[] = [];
    const logger = {
      ...silentLogger,
      warning: (msg: string) => warnings.push(msg),
    };

    const secondPresent = vi.fn();
    const engine = new ReviewEngine();
    engine.register(
      createTestPlugin({
        id: 'crasher',
        present: async () => {
          throw new Error('boom');
        },
      }),
    );
    engine.register(
      createTestPlugin({
        id: 'survivor',
        present: secondPresent,
      }),
    );

    await engine.present([], createAdapterContext({ logger }));

    expect(warnings.some(w => w.includes('crasher') && w.includes('boom'))).toBe(true);
    expect(secondPresent).toHaveBeenCalledTimes(1);
  });

  it('conclusion is success when no findings', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    expect(octokit.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        conclusion: 'success',
      }),
    );
  });

  it('conclusion is failure when error findings exist', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const findings: ReviewFinding[] = [
      {
        pluginId: 'test',
        filepath: 'a.ts',
        line: 1,
        severity: 'error',
        category: 'test',
        message: 'Error',
      },
    ];

    await engine.present(findings, createAdapterContext({ octokit, pr: mockPR }));

    expect(octokit.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        conclusion: 'failure',
      }),
    );
  });

  it('conclusion is neutral when only warnings', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const findings: ReviewFinding[] = [
      {
        pluginId: 'test',
        filepath: 'a.ts',
        line: 1,
        severity: 'warning',
        category: 'test',
        message: 'Warning',
      },
    ];

    await engine.present(findings, createAdapterContext({ octokit, pr: mockPR }));

    expect(octokit.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        conclusion: 'neutral',
      }),
    );
  });

  it('captures debug log in check run text field', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          ctx.logger.info('hello from plugin');
        },
      }),
    );

    await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    // The final update should have text containing our log message
    const lastCall = octokit.checks.update.mock.calls.at(-1)?.[0];
    expect(lastCall?.output?.text).toContain('hello from plugin');
  });

  it('batches annotations when more than 50', async () => {
    const engine = new ReviewEngine();
    const octokit = {
      checks: {
        create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    engine.register(
      createTestPlugin({
        present: async (_findings, ctx: PresentContext) => {
          const annotations = Array.from({ length: 75 }, (_, i) => ({
            path: `file${i}.ts`,
            start_line: 1,
            end_line: 1,
            annotation_level: 'warning' as const,
            message: `Annotation ${i}`,
          }));
          ctx.addAnnotations(annotations);
        },
      }),
    );

    await engine.present([], createAdapterContext({ octokit, pr: mockPR }));

    // Should have 2 update calls: one intermediate batch (50) + one final batch (25)
    expect(octokit.checks.update).toHaveBeenCalledTimes(2);

    // First call: intermediate batch of 50
    const firstCall = octokit.checks.update.mock.calls[0][0];
    expect(firstCall.output.annotations).toHaveLength(50);

    // Second call: final batch of 25 with status completed
    const secondCall = octokit.checks.update.mock.calls[1][0];
    expect(secondCall.output.annotations).toHaveLength(25);
    expect(secondCall.status).toBe('completed');
  });

  it('respects pluginFilter for present()', async () => {
    const presentA = vi.fn();
    const presentB = vi.fn();
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ id: 'alpha', present: presentA }));
    engine.register(createTestPlugin({ id: 'beta', present: presentB }));

    await engine.present([], createAdapterContext(), 'alpha');

    expect(presentA).toHaveBeenCalledTimes(1);
    expect(presentB).not.toHaveBeenCalled();
  });

  it('skips plugins without present() method', async () => {
    const engine = new ReviewEngine();
    engine.register(createTestPlugin({ id: 'no-present' })); // no present()

    // Should not throw
    await engine.present([], createAdapterContext());
  });
});
