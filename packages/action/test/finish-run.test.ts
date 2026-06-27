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
    writeForbidden: false,
    ...overrides,
  };
}

describe('finishRun fork handling', () => {
  beforeEach(() => {
    // Keep summary/output writes as no-ops (env vars unset) and silence stdout.
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_OUTPUT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one fork warning when a fork PR had writes forbidden', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});
    const result = makeResult({ writeForbidden: true });

    const exitCode = await finishRun(result, /* isFork */ true, 'error');

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][0]).toContain('pull_request_target');
    // A token limitation is not a CI failure.
    expect(exitCode).toBe(0);
  });

  it('does not warn on a same-repo PR even if a write 403 leaked through', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});
    const result = makeResult({ writeForbidden: true });

    await finishRun(result, /* isFork */ false, 'error');

    expect(warning).not.toHaveBeenCalled();
  });

  it('does not warn on a fork PR when writes succeeded', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});
    const result = makeResult({ writeForbidden: false });

    await finishRun(result, /* isFork */ true, 'error');

    expect(warning).not.toHaveBeenCalled();
  });

  it('maps a failure conclusion to exit 1 under fail-on=error', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({ conclusion: 'failure' });

    const exitCode = await finishRun(result, false, 'error');

    expect(exitCode).toBe(1);
  });

  it('forces exit 0 on a forbidden fork PR regardless of fail-on=any', async () => {
    vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});
    const result = makeResult({
      writeForbidden: true,
      findings: [{ severity: 'error' } as ReviewCoreResult['findings'][number]],
    });

    const exitCode = await finishRun(result, true, 'any');

    expect(exitCode).toBe(0);
  });
});
