import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ReviewCoreResult } from '@liendev/review';

import { finishRun } from '../src/index.js';
import { actionLogger } from '../src/logger.js';

function makeResult(overrides?: Partial<ReviewCoreResult>): ReviewCoreResult {
  return {
    findings: [],
    conclusion: 'success',
    summaryMarkdown: 'All good.',
    filesAnalyzed: 3,
    usage: { totalTokens: 0, cost: 0 },
    ...overrides,
  };
}

describe('finishRun', () => {
  beforeEach(() => {
    // Keep summary/output writes as no-ops (env vars unset) and silence stdout.
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_OUTPUT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once about the read-only token on a fork PR', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});

    await finishRun(makeResult(), /* isFork */ true, 'error');

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][0]).toContain('pull_request_target');
  });

  it('does not warn on a same-repo PR', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});

    await finishRun(makeResult(), /* isFork */ false, 'error');

    expect(warning).not.toHaveBeenCalled();
  });

  it('maps a failure conclusion to exit 1 under fail-on=error', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});

    const exitCode = await finishRun(makeResult({ conclusion: 'failure' }), false, 'error');

    expect(exitCode).toBe(1);
  });

  it('maps a success conclusion to exit 0 under fail-on=error', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});

    const exitCode = await finishRun(makeResult({ conclusion: 'success' }), false, 'error');

    expect(exitCode).toBe(0);
  });

  it('fail-on=never never fails, even on a fork PR with error findings', async () => {
    vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({
      conclusion: 'failure',
      findings: [{ severity: 'error' } as ReviewCoreResult['findings'][number]],
    });

    const exitCode = await finishRun(result, /* isFork */ true, 'never');

    expect(exitCode).toBe(0);
  });

  it('fail-on=any fails on a failure conclusion even with no findings', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({ conclusion: 'failure', findings: [] });

    const exitCode = await finishRun(result, /* isFork */ false, 'any');

    expect(exitCode).toBe(1);
  });
});
