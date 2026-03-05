import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@liendev/review', () => ({
  updateCheckRun: vi.fn(),
}));

import { updateCheckRun } from '@liendev/review';
import { finalizeCheckRunNoFiles } from '../src/handlers/pr-review.js';

const mockUpdateCheckRun = vi.mocked(updateCheckRun);

const logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const prContext = {
  owner: 'test-owner',
  repo: 'test-repo',
  pullNumber: 1,
  title: 'Test PR',
  baseSha: 'base-sha',
  headSha: 'head-sha',
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('finalizeCheckRunNoFiles', () => {
  it('updates check run with success when checkRunId is provided', async () => {
    mockUpdateCheckRun.mockResolvedValue(undefined as any);

    await finalizeCheckRunNoFiles(123, {} as any, prContext, logger);

    expect(mockUpdateCheckRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        checkRunId: 123,
        status: 'completed',
        conclusion: 'success',
      }),
      logger,
    );
  });

  it('does nothing when checkRunId is undefined', async () => {
    await finalizeCheckRunNoFiles(undefined, {} as any, prContext, logger);

    expect(mockUpdateCheckRun).not.toHaveBeenCalled();
  });

  it('logs warning when updateCheckRun fails', async () => {
    mockUpdateCheckRun.mockRejectedValue(new Error('API error'));

    await finalizeCheckRunNoFiles(123, {} as any, prContext, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to finalize'));
  });
});
