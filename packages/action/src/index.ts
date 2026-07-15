/**
 * Lien Review GitHub Action entrypoint.
 *
 * Flow: inputs → context → octokit → reviewPullRequest → workflow annotations +
 * step summary + outputs → exit code per `fail-on`. The action posts no Checks
 * API check run of its own — the workflow job is the single status check, and
 * findings render as annotations (inline on the diff), the step summary, and
 * inline PR comments. On fork PRs the built-in `GITHUB_TOKEN` is read-only, so
 * inline comments can't post (annotations + summary still do); we note that once
 * with the `pull_request_target` remedy.
 */

import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createOctokit,
  type ReviewCoreContext,
  type ReviewCoreResult,
  type ReviewFinding,
  reviewPullRequest,
} from '@liendev/review';

import { readInputs, type FailOn } from './inputs.js';
import { loadContext } from './context.js';
import { writeStepSummary, writeOutputs, countErrors } from './summary.js';
import { actionLogger, group, endGroup, annotate } from './logger.js';

/**
 * Surface findings as GitHub Actions annotations (single-check mode, `check-run:
 * false`). With no separate check run, these put each finding inline on the diff
 * and on the workflow job's check — where the check-run annotations would be.
 */
export function emitFindingAnnotations(findings: ReviewFinding[]): void {
  for (const f of findings) {
    const level =
      f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
    const title = f.category ? `Lien Review (${f.category})` : 'Lien Review';
    const message = f.suggestion ? `${f.message}\n\n${f.suggestion}` : f.message;
    annotate(level, { file: f.filepath, line: f.line, endLine: f.endLine, title }, message);
  }
}

function emitForkWarning(): void {
  actionLogger.warning(
    'This PR is from a fork, so the built-in GITHUB_TOKEN is read-only — Lien could ' +
      'not post inline PR comments (findings still appear as annotations and in the ' +
      'job summary). For inline comments on fork PRs, run Lien on the ' +
      'pull_request_target event instead (safe — Lien only clones and parses code, ' +
      'never executes it). See the action README for the workflow example.',
  );
}

/** Map the review conclusion to a process exit code per the `fail-on` policy. */
function exitCodeFor(
  failOn: FailOn,
  conclusion: 'success' | 'failure' | 'neutral',
  errorCount: number,
  warningCount: number,
  providerFailure: boolean,
): number {
  // A total provider failure means the agent review never ran at all — an
  // operational failure, not an advisory finding. A user who enabled (and is
  // paying for) the review deserves a red check when it didn't happen, so
  // this fails regardless of `fail-on`, including the advisory default
  // `never`. See the "Fail-loudly guarantee" section of the action README.
  if (providerFailure) return 1;
  if (failOn === 'never') return 0;
  // 'any' is strictly stricter than 'error': fail on a failure conclusion (e.g.
  // analysis failed with no findings) OR on any error/warning finding.
  if (failOn === 'any') return conclusion === 'failure' || errorCount + warningCount > 0 ? 1 : 0;
  // failOn === 'error'
  return conclusion === 'failure' ? 1 : 0;
}

/**
 * Log a clear, actionable message naming why the review couldn't run at all.
 * Only called once `result.providerFailure` (the authoritative signal from
 * `@liendev/review`) is already known true — this just locates the specific
 * never-ran notice among `findings` to quote its message (which already
 * carries the raw provider error, e.g. "API error (402): ..."), then adds the
 * common-cause remediation so a maintainer doesn't have to guess.
 */
function logProviderFailure(findings: ReviewFinding[]): void {
  const notice = findings.find(f => (f.metadata as { neverRan?: boolean } | undefined)?.neverRan);
  const cause = notice?.message ?? 'every LLM provider request failed.';
  actionLogger.error(
    `Lien Review could not run: ${cause} This fails the check even with fail-on: never — a ` +
      'review that never ran is an operational failure, not an advisory finding. Common causes: ' +
      'insufficient provider credits (402, add credits), an invalid/expired API key (401/403, ' +
      'check the openrouter-api-key/anthropic-api-key secret), or a provider outage (5xx, re-run ' +
      'once it recovers).',
  );
}

/**
 * Finalize a completed review: write the step summary + outputs, note the fork
 * read-only-token limitation if applicable, and return the process exit code
 * (per `fail-on`) so the entrypoint and tests can assert it without reading
 * `process.exitCode`.
 */
export async function finishRun(
  result: ReviewCoreResult,
  forkReadOnly: boolean,
  failOn: FailOn,
): Promise<number> {
  const errorCount = countErrors(result.findings);
  const providerFailure = result.providerFailure;

  await writeStepSummary(result);
  await writeOutputs({
    conclusion: result.conclusion,
    findingsCount: result.findings.length,
    errorCount,
  });

  // Read-only fork token (a `pull_request` from a fork): inline comments can't
  // post (annotations + the step summary still do). Note it once. Skipped under
  // pull_request_target, which grants forks a writable token.
  if (forkReadOnly) emitForkWarning();
  if (providerFailure) logProviderFailure(result.findings);

  const warningCount = result.findings.filter(f => f.severity === 'warning').length;
  actionLogger.info(
    `Review complete: ${result.findings.length} findings (${errorCount} errors), ` +
      `conclusion=${result.conclusion}, files=${result.filesAnalyzed}`,
  );
  return exitCodeFor(failOn, result.conclusion, errorCount, warningCount, providerFailure);
}

async function main(): Promise<void> {
  const inputs = readInputs();
  const context = await loadContext();

  const octokit = createOctokit(inputs.githubToken);

  const ctx: ReviewCoreContext = {
    octokit,
    pr: context.pr,
    headRepoFullName: context.headRepoFullName,
    baseRepoFullName: context.baseRepoFullName,
    token: inputs.githubToken,
    config: {
      threshold: inputs.threshold,
      blockOnNewErrors: inputs.blockOnNewErrors,
      reviewTypes: {
        complexity: inputs.reviewTypes.complexity,
        summary: inputs.reviewTypes.summary,
        architectural: inputs.reviewTypes.architectural,
        bugs: inputs.reviewTypes.bugs,
      },
    },
    llm: inputs.llm,
    logger: actionLogger,
  };

  group('Lien Review');
  let result;
  try {
    result = await reviewPullRequest(ctx);
  } finally {
    endGroup();
  }

  // The job is the only check, so surface findings inline as workflow annotations.
  emitFindingAnnotations(result.findings);

  // A fork's GITHUB_TOKEN is read-only on `pull_request` (inline comments can't
  // post), but pull_request_target grants a writable token — only warn in the former.
  const forkReadOnly = context.isFork && process.env.GITHUB_EVENT_NAME !== 'pull_request_target';
  process.exitCode = await finishRun(result, forkReadOnly, inputs.failOn);
}

/** True when this module is the process entrypoint (not imported by a test). */
function isEntrypoint(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isEntrypoint()) {
  main().catch(error => {
    actionLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
