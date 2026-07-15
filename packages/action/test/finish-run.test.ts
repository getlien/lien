import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { emptyAttestation, type ReviewCoreResult } from '@liendev/review';

import { finishRun, buildCrashResult } from '../src/index.js';
import { actionLogger } from '../src/logger.js';

function makeResult(overrides?: Partial<ReviewCoreResult>): ReviewCoreResult {
  return {
    findings: [],
    conclusion: 'success',
    summaryMarkdown: 'All good.',
    filesAnalyzed: 3,
    usage: { totalTokens: 0, cost: 0 },
    providerFailure: false,
    attestation: emptyAttestation('success', 3, 'normal'),
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

    await finishRun(makeResult(), /* forkReadOnly */ true, 'error');

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][0]).toContain('pull_request_target');
  });

  it('does not warn on a same-repo PR', async () => {
    const warning = vi.spyOn(actionLogger, 'warning').mockImplementation(() => {});

    await finishRun(makeResult(), /* forkReadOnly */ false, 'error');

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

    const exitCode = await finishRun(result, /* forkReadOnly */ true, 'never');

    expect(exitCode).toBe(0);
  });

  it('fail-on=any fails on a failure conclusion even with no findings', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({ conclusion: 'failure', findings: [] });

    const exitCode = await finishRun(result, /* forkReadOnly */ false, 'any');

    expect(exitCode).toBe(1);
  });

  // Regression coverage for #764: a total provider failure (every OpenRouter
  // request 402'd) reached a green check because `fail-on: never` forced exit 0
  // unconditionally, with no distinction between an advisory finding and an
  // operational "the review never ran" failure.
  function neverRanFinding(): ReviewCoreResult['findings'][number] {
    return {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'error',
      category: 'summary',
      message:
        'Lien Review did not run — every provider request failed (API error (402): Insufficient credits). ' +
        'This is NOT a clean review; no code was analyzed. Re-run once the provider issue is resolved.',
      metadata: { incomplete: true, neverRan: true, stopReason: 'error' },
    };
  }

  it('fails the check on a total provider failure even under fail-on=never (#764)', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const error = vi.spyOn(actionLogger, 'error').mockImplementation(() => {});
    // `providerFailure` is the authoritative signal computed by `@liendev/review`
    // (see review-pr.ts's `hasProviderFailure`) — `conclusion`/`findings` mirror
    // what it would actually produce alongside it, but `finishRun` gates on
    // `providerFailure` directly, not on re-deriving it from findings/strings.
    const result = makeResult({
      conclusion: 'failure',
      findings: [neverRanFinding()],
      providerFailure: true,
    });

    const exitCode = await finishRun(result, /* forkReadOnly */ false, 'never');

    expect(exitCode).toBe(1);
    // A clear, actionable message names the cause — not just the raw finding.
    expect(error).toHaveBeenCalled();
    const logged = error.mock.calls.map(c => c[0]).join('\n');
    expect(logged).toContain('402');
    expect(logged).toContain('fail-on: never');
  });

  it('still fails a total provider failure under fail-on=error and fail-on=any', async () => {
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    vi.spyOn(actionLogger, 'error').mockImplementation(() => {});
    const result = makeResult({
      conclusion: 'failure',
      findings: [neverRanFinding()],
      providerFailure: true,
    });

    expect(await finishRun(result, false, 'error')).toBe(1);
    expect(await finishRun(result, false, 'any')).toBe(1);
  });

  it('a findings-based failure conclusion (providerFailure=false) still obeys fail-on=never', async () => {
    // Distinguishes the two ways `conclusion` can be 'failure': ordinary error
    // findings (e.g. a new complexity violation) must stay advisory under the
    // default, unlike an operational provider failure (the test above).
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({
      conclusion: 'failure',
      findings: [{ severity: 'error' } as ReviewCoreResult['findings'][number]],
      providerFailure: false,
    });

    const exitCode = await finishRun(result, /* forkReadOnly */ false, 'never');

    expect(exitCode).toBe(0);
  });

  it('a PARTIAL incomplete run (budget/turn limit, not neverRan) stays advisory under fail-on=never', async () => {
    // Some turns completed before the run bailed — this is a warning-severity
    // notice (see appendIncompleteNotice), not the never-ran operational failure,
    // so it must not force a failing exit code by itself.
    vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
    const result = makeResult({
      conclusion: 'neutral',
      findings: [
        {
          pluginId: 'agent-review',
          filepath: '',
          line: 0,
          severity: 'warning',
          category: 'summary',
          message:
            'Lien Review did not finish — it hit the token budget limit while investigating.',
          metadata: { incomplete: true, stopReason: 'budget' },
        } as ReviewCoreResult['findings'][number],
      ],
    });

    const exitCode = await finishRun(result, /* forkReadOnly */ false, 'never');

    expect(exitCode).toBe(0);
  });

  // Regression coverage for the CodeRabbit #768 finding: `reviewPullRequest()`
  // throwing (e.g. a clone failure) used to escape with no result at all — no
  // attestation, no step summary, no outputs — reaching only main()'s top-level
  // catch. `buildCrashResult` is what main() now falls back to so the receipt
  // still gets written before the check fails.
  describe('buildCrashResult', () => {
    it('produces a failed:analysis_error attestation carrying the crash message', () => {
      const result = buildCrashResult('clone failed: ENOTFOUND');

      expect(result.conclusion).toBe('failure');
      expect(result.providerFailure).toBe(false);
      expect(result.attestation.verdict).toBe('failed:analysis_error');
      expect(result.summaryMarkdown).toContain('clone failed: ENOTFOUND');
    });

    it('still writes the attestation/summary/outputs via finishRun', async () => {
      vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
      const result = buildCrashResult('boom');

      const exitCode = await finishRun(result, false, 'never');

      // finishRun alone doesn't force this to fail (that's main()'s job, since
      // `crashed` isn't part of ReviewCoreResult) — this just proves the crash
      // result flows through the normal write path without throwing.
      expect(exitCode).toBe(0);
    });
  });

  describe('attestation output + summary rendering', () => {
    let summaryPath: string;
    let outputPath: string;

    beforeEach(async () => {
      const { mkdtemp, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const dir = await mkdtemp(join(tmpdir(), 'lien-action-test-'));
      await mkdir(dir, { recursive: true });
      summaryPath = join(dir, 'summary.md');
      outputPath = join(dir, 'output.txt');
      process.env.GITHUB_STEP_SUMMARY = summaryPath;
      process.env.GITHUB_OUTPUT = outputPath;
    });

    it('writes the attestation JSON into the step summary as a collapsed details block', async () => {
      vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
      const result = makeResult({ attestation: emptyAttestation('success', 5, 'normal') });

      await finishRun(result, false, 'never');

      const { readFile } = await import('node:fs/promises');
      const summary = await readFile(summaryPath, 'utf8');
      expect(summary).toContain('<summary>Delivery attestation</summary>');
      expect(summary).toContain('"attestationVersion": 1');
      expect(summary).toContain('"verdict": "delivered"');
    });

    it('writes the attestation as a JSON action output', async () => {
      vi.spyOn(actionLogger, 'info').mockImplementation(() => {});
      const result = makeResult({ attestation: emptyAttestation('success', 5, 'normal') });

      await finishRun(result, false, 'never');

      const { readFile } = await import('node:fs/promises');
      const output = await readFile(outputPath, 'utf8');
      expect(output).toContain('attestation<<');
      expect(output).toContain('"verdict":"delivered"');
    });
  });
});
