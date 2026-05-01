/**
 * Human-readable reporter for harness output. Used by run.ts.
 */

import type { CalibrateResult, VoteResult } from './voting.js';

function previewMessage(msg: string, max = 220): string {
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

export function reportVote(label: string, result: VoteResult): string {
  const lines: string[] = [];
  const status = result.agree ? (result.passes === result.votes.length ? '✓' : '✗') : '?';
  lines.push(
    `${status} ${label} — ${result.passes}/${result.votes.length} passed${result.agree ? '' : ' (FLAKY)'} · $${result.totalCost.toFixed(4)}`,
  );
  for (const [i, v] of result.votes.entries()) {
    if (!v.passed) {
      lines.push(
        `    vote ${i + 1}: tier ${v.failureTier ?? '?'} — ${previewMessage(v.failureMessage ?? '(no message)')}`,
      );
    }
  }
  if (!result.agree) {
    lines.push('    NOTE: votes disagreed — flag as flaky, do not claim green/red');
  }
  return lines.join('\n');
}

export function reportCalibrate(label: string, result: CalibrateResult): string {
  const status = result.meetsReliabilityBar ? '✓' : '✗';
  const lines: string[] = [];
  lines.push(
    `${status} ${label} — ${result.passes}/${result.runs.length} passed (${(result.passRate * 100).toFixed(0)}%) · $${result.totalCost.toFixed(4)}`,
  );
  if (!result.meetsReliabilityBar) {
    lines.push('    BAR NOT MET — assertions too tight or fixture too ambiguous (per #538)');
  }
  const failures = result.runs.filter(r => !r.passed);
  if (failures.length > 0) {
    const tier1 = failures.filter(f => f.failureTier === 1).length;
    const tier2 = failures.filter(f => f.failureTier === 2).length;
    lines.push(`    failures: ${tier1} tier-1, ${tier2} tier-2`);
    lines.push(
      `    first failure: ${previewMessage(failures[0].failureMessage ?? '(no message)')}`,
    );
  }
  return lines.join('\n');
}
