import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@liendev/review', () => ({
  updateCheckRun: vi.fn(),
}));

import { updateCheckRun } from '@liendev/review';
import { tryPresentFindings } from '../src/handlers/pr-review.js';

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

describe('tryPresentFindings', () => {
  it('calls engine.present successfully', async () => {
    const engine = { present: vi.fn().mockResolvedValue(undefined) } as any;
    const findings = [{ filepath: 'foo.ts', severity: 'error' }] as any;
    const adapterContext = {} as any;

    await tryPresentFindings(engine, findings, adapterContext, 123, {} as any, prContext, logger);

    expect(engine.present).toHaveBeenCalledWith(findings, adapterContext, { checkRunId: 123 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs error and updates check run when engine.present fails', async () => {
    const engine = {
      present: vi.fn().mockRejectedValue(new Error('present failed')),
    } as any;
    mockUpdateCheckRun.mockResolvedValue(undefined as any);

    await tryPresentFindings(engine, [], {} as any, 456, {} as any, prContext, logger);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('present failed'));
    expect(mockUpdateCheckRun).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        checkRunId: 456,
        status: 'completed',
        conclusion: 'action_required',
      }),
      logger,
    );
  });

  it('skips check run update when no checkRunId and engine.present fails', async () => {
    const engine = {
      present: vi.fn().mockRejectedValue(new Error('boom')),
    } as any;

    await tryPresentFindings(engine, [], {} as any, undefined, {} as any, prContext, logger);

    expect(logger.error).toHaveBeenCalled();
    expect(mockUpdateCheckRun).not.toHaveBeenCalled();
  });
});
