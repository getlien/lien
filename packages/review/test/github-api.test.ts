import { describe, it, expect, vi } from 'vitest';
import {
  postPRReview,
  parsePatchLines,
  updatePRDescription,
  removePRDescriptionSection,
} from '../src/github-api.js';
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

/** Octokit RequestError-shaped rejection: a batch validation failure (invalid comment anchor). */
function validationError(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 422 });
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
    expect(result).toEqual({ posted: 2, dropped: [], bodyPosted: true });
  });

  it('drops an invalid (negative) start_line instead of passing it through, and warns', async () => {
    const createReview = vi.fn().mockResolvedValue({});
    const octokit = createMockOctokit({ createReview });
    const logger = createMockLogger();

    const comments: LineComment[] = [{ path: 'a.ts', line: 10, start_line: -1, body: 'nit a' }];

    await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    const postedComment = createReview.mock.calls[0][0].comments[0];
    expect(postedComment).not.toHaveProperty('start_line');
    expect(postedComment).not.toHaveProperty('start_side');
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Stripping invalid start_line (-1) for comment at a.ts:10'),
    );
  });

  it('drops a zero start_line instead of passing it through, and warns', async () => {
    const createReview = vi.fn().mockResolvedValue({});
    const octokit = createMockOctokit({ createReview });
    const logger = createMockLogger();

    const comments: LineComment[] = [{ path: 'a.ts', line: 10, start_line: 0, body: 'nit a' }];

    await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    const postedComment = createReview.mock.calls[0][0].comments[0];
    expect(postedComment).not.toHaveProperty('start_line');
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Stripping invalid start_line (0) for comment at a.ts:10'),
    );
  });

  it('posts the body alone, then every comment individually, when the batch is rejected as invalid (422)', async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(validationError('Line 999 is not part of the diff'))
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
    expect(result).toEqual({ posted: 2, dropped: [], bodyPosted: true });
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post line comments as a batch'),
    );
  });

  it('drops only the comment that still fails individually, and never throws', async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(validationError('batch rejected'))
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
    expect(result.bodyPosted).toBe(true);
    expect(result.dropped).toEqual([
      { path: 'b.ts', line: 20, error: 'Line 20 is not part of the diff' },
    ]);
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Dropped inline comment at b.ts:20'),
    );
  });

  it('still retries comments individually, and reports bodyPosted: false, when the body-only post also fails', async () => {
    const createReview = vi
      .fn()
      .mockRejectedValueOnce(validationError('batch rejected'))
      .mockRejectedValueOnce(new Error('body-only post also failed'));
    const createReviewComment = vi.fn().mockResolvedValue({});
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [
      { path: 'a.ts', line: 10, body: 'nit a' },
      { path: 'b.ts', line: 20, body: 'nit b' },
    ];

    const result = await postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT');

    // Both createReview attempts happened, but neither throws out of the function.
    expect(createReview).toHaveBeenCalledTimes(2);
    // The salvage path still ran for every comment.
    expect(createReviewComment).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ posted: 2, dropped: [], bodyPosted: false });
    expect(logger.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to post body-only review after batch failure'),
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

  it('rethrows a non-validation batch failure (e.g. 500) instead of salvaging, even with comments present', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const createReview = vi.fn().mockRejectedValue(serverError);
    const createReviewComment = vi.fn();
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [{ path: 'a.ts', line: 10, body: 'nit a' }];

    await expect(
      postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT'),
    ).rejects.toThrow('Internal Server Error');

    // Only the initial batch attempt — no body-only fallback, no per-comment salvage.
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReviewComment).not.toHaveBeenCalled();
  });

  it('rethrows a batch failure with no status (e.g. a plain network error) instead of salvaging', async () => {
    const createReview = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const createReviewComment = vi.fn();
    const octokit = createMockOctokit({ createReview, createReviewComment });
    const logger = createMockLogger();

    const comments: LineComment[] = [{ path: 'a.ts', line: 10, body: 'nit a' }];

    await expect(
      postPRReview(octokit, pr, comments, 'summary body', logger, 'COMMENT'),
    ).rejects.toThrow('socket hang up');

    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReviewComment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updatePRDescription / removePRDescriptionSection
// ---------------------------------------------------------------------------

/** Minimal Octokit stand-in for the PR-description read/write pair. */
function createDescriptionOctokit(overrides?: {
  body?: string;
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return {
    pulls: {
      get: overrides?.get ?? vi.fn().mockResolvedValue({ data: { body: overrides?.body ?? '' } }),
      update: overrides?.update ?? vi.fn().mockResolvedValue({}),
    },
  } as unknown as Octokit;
}

describe('updatePRDescription', () => {
  // Regression coverage for the CodeRabbit #768 finding: this used to swallow
  // every error and always resolve void, so a caller tracking delivery (the
  // attestation's descriptionBadgeUpdated) could never see a real failure.
  it('returns true on a successful update', async () => {
    const octokit = createDescriptionOctokit();
    const logger = createMockLogger();

    await expect(updatePRDescription(octokit, pr, 'badge', logger, 'attestation')).resolves.toBe(
      true,
    );
  });

  it('returns false (does not throw) when octokit.pulls.update rejects', async () => {
    const octokit = createDescriptionOctokit({
      update: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
    });
    const logger = createMockLogger();

    await expect(updatePRDescription(octokit, pr, 'badge', logger, 'attestation')).resolves.toBe(
      false,
    );
    expect(logger.warning).toHaveBeenCalled();
  });
});

describe('removePRDescriptionSection', () => {
  it('strips an existing marker-delimited section and updates the PR', async () => {
    const body =
      'Intro.\n\n<!-- lien:attestation -->\nAttested: degraded\n<!-- /lien:attestation -->';
    const update = vi.fn().mockResolvedValue({});
    const octokit = createDescriptionOctokit({ body, update });
    const logger = createMockLogger();

    const ok = await removePRDescriptionSection(octokit, pr, 'attestation', logger);

    expect(ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const newBody = update.mock.calls[0][0].body as string;
    expect(newBody).not.toContain('lien:attestation');
    expect(newBody).toContain('Intro.');
  });

  it('is a no-op (no update call) when the section is not present', async () => {
    const update = vi.fn().mockResolvedValue({});
    const octokit = createDescriptionOctokit({ body: 'Just a plain PR description.', update });
    const logger = createMockLogger();

    const ok = await removePRDescriptionSection(octokit, pr, 'attestation', logger);

    expect(ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns false (does not throw) when the API call fails', async () => {
    const octokit = createDescriptionOctokit({
      get: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const logger = createMockLogger();

    const ok = await removePRDescriptionSection(octokit, pr, 'attestation', logger);

    expect(ok).toBe(false);
    expect(logger.warning).toHaveBeenCalled();
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
