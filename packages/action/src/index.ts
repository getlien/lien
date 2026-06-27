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
): number {
  if (failOn === 'never') return 0;
  // 'any' is strictly stricter than 'error': fail on a failure conclusion (e.g.
  // analysis failed with no findings) OR on any error/warning finding.
  if (failOn === 'any') return conclusion === 'failure' || errorCount + warningCount > 0 ? 1 : 0;
  // failOn === 'error'
  return conclusion === 'failure' ? 1 : 0;
}

/**
 * Finalize a completed review: write the step summary + outputs, note the fork
 * read-only-token limitation if applicable, and return the process exit code
 * (per `fail-on`) so the entrypoint and tests can assert it without reading
 * `process.exitCode`.
 */
export async function finishRun(
  result: ReviewCoreResult,
  isFork: boolean,
  failOn: FailOn,
): Promise<number> {
  const errorCount = countErrors(result.findings);

  await writeStepSummary(result);
  await writeOutputs({
    conclusion: result.conclusion,
    findingsCount: result.findings.length,
    errorCount,
  });

  // On a fork PR the built-in GITHUB_TOKEN is read-only, so inline comments can't
  // post (annotations + the step summary still do). Note it once.
  if (isFork) emitForkWarning();

  const warningCount = result.findings.filter(f => f.severity === 'warning').length;
  actionLogger.info(
    `Review complete: ${result.findings.length} findings (${errorCount} errors), ` +
      `conclusion=${result.conclusion}, files=${result.filesAnalyzed}`,
  );
  return exitCodeFor(failOn, result.conclusion, errorCount, warningCount);
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

  process.exitCode = await finishRun(result, context.isFork, inputs.failOn);
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
