import { describe, it, expect, vi } from 'vitest';
import { postPRReview, parsePatchLines } from '../src/github-api.js';
import type { Octokit } from '../src/github-api.js';
import type { LineComment, PRContext } from '../src/types.js';
import type { Logger } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pr: PRContext = {
  owner: 'test-owner',
  repo: 'test-repo',
  pullNumber: 42,
  title: 'Test PR',
  baseSha: 'base-sha',
  headSha: 'head-sha',
};

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/** Minimal Octokit stand-in — only the two REST methods postPRReview touches. */
function createMockOctokit(overrides?: {
  createReview?: ReturnType<typeof vi.fn>;
  createReviewComment?: ReturnType<typeof vi.fn>;
}) {
  return {
    pulls: {
      createReview: overrides?.createReview ?? vi.fn().mockResolvedValue({}),
      createReviewComment: overrides?.createReviewComment ?? vi.fn().mockResolvedValue({}),
    },
  } as unknown as Octokit;
}

// ---------------------------------------------------------------------------
// postPRReview
// ---------------------------------------------------------------------------

describe('postPRReview', () => {
  it('posts the whole batch in one call when it succeeds', async () => {
    const createReview = vi.fn().mockResolvedValue({});
    const createReviewComment = vi.fn();
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [
      { path: 'a.ts', line: 10, body: 'nit a' },
      { path: 'b.ts', line: 20, body: 'nit b' },
    ];

    const result = await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        commit_id: 'head-sha',
        body: 'summary body',
        comments: [
          expect.objectContaining({ path: 'a.ts', line: 10, body: 'nit a' }),
          expect.objectContaining({ path: 'b.ts', line: 20, body: 'nit b' }),
        ],
      }),
    );
    // Batch succeeded — no per-comment fallback calls.
    expect(createReviewComment).not.toHaveBeenCalled();
    expect(result).toEqual({ posted: 2, dropped: [] });
  });

  it('posts the body alone, then every comment individually, when the batch is rejected', async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error('Line 999 is not part of the diff'))
      .mockResolvedValueOnce({});
    const createReviewComment = vi.fn().mockResolvedValue({});
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [
      { path: 'a.ts', line: 10, body: 'nit a' },
      { path: 'b.ts', line: 20, body: 'nit b' },
    ];

    const result = await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    // First call attempted the batch; second posted the summary body only.
    expect(createReview).toHaveBeenCalledTimes(2);
    expect(createReview.mock.calls[1][0]).not.toHaveProperty('comments');
    expect(createReview.mock.calls[1][0]).toMatchObject({ body: 'summary body' });

    // Every comment retried individually — none silently dropped.
    expect(createReviewComment).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ posted: 2, dropped: [] });
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post line comments as a batch'),
    );
  });

  it('drops only the comment that still fails individually, and never throws', async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(new Error('batch rejected'))
      .mockResolvedValueOnce({});
    const createReviewComment = vi
      .fn()
      .mockResolvedValueOnce({}) // a.ts posts fine
      .mockRejectedValueOnce(new Error('Line 20 is not part of the diff')); // b.ts still fails
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [
      { path: 'a.ts', line: 10, body: 'nit a' },
      { path: 'b.ts', line: 20, body: 'nit b' },
    ];

    const result = await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    expect(result.posted).toBe(1);
    expect(result.dropped).toEqual([
      { path: 'b.ts', line: 20, error: 'Line 20 is not part of the diff' },
    ]);
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Dropped inline comment at b.ts:20'),
    );
  });

  it('rethrows on batch failure when there are no comments to salvage', async () => {
    const createReview = vi.fn().mockRejectedValue(new Error('network error'));
    const createReviewComment = vi.fn();
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    await expect(postPRReview(octokit, pr, [], 'summary body', logger, 'COMMENT')).rejects.toThrow(
      'network error',
    );
    expect(createReviewComment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parsePatchLines
// ---------------------------------------------------------------------------

describe('parsePatchLines', () => {
  it('collects context and added lines, skipping deleted lines', () => {
    const patch = [
      '@@ -10,3 +10,4 @@ function foo() {',
      ' context1',
      '+added1',
      ' context2',
      '-removed1',
      ' context3',
    ].join('\n');

    expect(parsePatchLines(patch)).toEqual(new Set([10, 11, 12, 13]));
  });

  it('resets the line counter at each hunk header', () => {
    const patch = ['@@ -1,2 +1,2 @@', '+line1', ' line2', '@@ -20,1 +21,1 @@', '+line3'].join('\n');

    expect(parsePatchLines(patch)).toEqual(new Set([1, 2, 21]));
  });

  it('ignores the "+++ b/file" header line instead of counting it as line 0', () => {
    const patch = ['--- a/file.ts', '+++ b/file.ts', '@@ -1,1 +1,2 @@', ' context', '+added'].join(
      '\n',
    );

    expect(parsePatchLines(patch)).toEqual(new Set([1, 2]));
  });
});
