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
  attestation: ReviewCoreResult['attestation'];
}

/** Count findings whose severity marks them as errors. */
export function countErrors(findings: ReviewFinding[]): number {
  return findings.filter(f => f.severity === 'error').length;
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
    formatAttestationDetails(result.attestation),
    '',
  ].join('\n');

  await appendFile(summaryPath, body, 'utf8');
}

/**
 * A collapsed `<details>` block with the full attestation JSON. Collapsed by
 * default so it costs nothing in the visible summary; the JSON inside is the
 * complete record — see `@liendev/review`'s `attestation.ts` for the schema.
 */
function formatAttestationDetails(attestation: ReviewCoreResult['attestation']): string {
  return [
    '<details>',
    '<summary>Delivery attestation</summary>',
    '',
    '```json',
    JSON.stringify(attestation, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');
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
    formatOutput('attestation', JSON.stringify(outputs.attestation)),
  ].join('');

  await appendFile(outputPath, body, 'utf8');
}
