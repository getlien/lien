/**
 * Write GitHub Actions outputs and the job step summary.
 *
 * - {@link writeStepSummary} appends the review's markdown (plus a findings count
 *   and a token/cost line) to the file named by `$GITHUB_STEP_SUMMARY`.
 * - {@link writeOutputs} writes the action outputs (conclusion, findings-count,
 *   error-count) to `$GITHUB_OUTPUT` in the `name=value` / heredoc format.
 *
 * See https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions#setting-an-output-parameter
 */

import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import type { ReviewCoreResult, ReviewFinding } from '@liendev/review';

export interface ActionOutputs {
  conclusion: ReviewCoreResult['conclusion'];
  findingsCount: number;
  errorCount: number;
}

/** Count findings whose severity marks them as errors. */
export function countErrors(findings: ReviewFinding[]): number {
  return findings.filter(f => f.severity === 'error').length;
}

/**
 * True when a finding signals that the agent-review MAIN pass never ran at
 * all — every LLM provider request failed terminally (a 402 on an overdrawn
 * account, an invalid key, a provider outage). Set via `AgentResult.neverRan`
 * and surfaced as `metadata.neverRan` by `appendNeverRanNotice` in
 * `packages/review/src/plugins/agent/index.ts`.
 *
 * This is an operational failure, not an advisory finding: a user who
 * configured and paid for a review deserves to know it didn't run, so the
 * action fails the check for this even under `fail-on: never` (see
 * `finishRun`) — unlike ordinary error/warning findings, which stay advisory.
 */
export function hasProviderFailure(findings: ReviewFinding[]): boolean {
  return findings.some(f => (f.metadata as { neverRan?: boolean } | undefined)?.neverRan === true);
}

/**
 * Append the review summary to `$GITHUB_STEP_SUMMARY`. No-op when the env var is
 * unset (e.g. running outside Actions) so local invocations don't crash.
 */
export async function writeStepSummary(result: ReviewCoreResult): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const errorCount = countErrors(result.findings);
  const tokens = result.usage.totalTokens.toLocaleString('en-US');
  const cost = result.usage.cost.toFixed(4);

  const body = [
    result.summaryMarkdown,
    '',
    `**Findings:** ${result.findings.length} (${errorCount} error${errorCount === 1 ? '' : 's'})`,
    `**Tokens:** ${tokens} · **Cost:** $${cost}`,
    '',
  ].join('\n');

  await appendFile(summaryPath, body, 'utf8');
}

/** Format one `$GITHUB_OUTPUT` entry using the heredoc form (safe for any value). */
function formatOutput(name: string, value: string): string {
  const delimiter = `ghadelimiter_${randomUUID()}`;
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

/**
 * Write action outputs to `$GITHUB_OUTPUT`. No-op when the env var is unset.
 */
export async function writeOutputs(outputs: ActionOutputs): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const body = [
    formatOutput('conclusion', outputs.conclusion),
    formatOutput('findings-count', String(outputs.findingsCount)),
    formatOutput('error-count', String(outputs.errorCount)),
  ].join('');

  await appendFile(outputPath, body, 'utf8');
}
