/**
 * Human-readable reporter for harness output. Used by run.ts.
 */

import type { CalibrateResult, VoteResult } from './voting.js';

function previewMessage(msg: string, max = 220): string {
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

/**
 * Render options common to both reporters. A `characterization` fixture
 * measures a known frontier and does not gate: it renders as a neutral `~`
 * line reporting the measured rate rather than a red `✗`, and its result never
 * contributes to the process exit code (that gating is enforced in run.ts).
 */
export interface ReportOptions {
  characterization?: boolean;
}

export function reportVote(label: string, result: VoteResult, opts?: ReportOptions): string {
  if (opts?.characterization) {
    return `~ ${label} — measured ${result.passes}/${result.votes.length} (non-gating, see fixture header) · $${result.totalCost.toFixed(4)}`;
  }
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

/** The headline outcome line for a calibration run (aborted vs completed). */
function calibrateStatusLine(label: string, result: CalibrateResult): string {
  const status = result.meetsReliabilityBar ? '✓' : '✗';
  const cost = `$${result.totalCost.toFixed(4)}`;
  if (result.aborted) {
    return `${status} ${label} — aborted after ${result.runs.length}/${result.requested} votes (--bail ${result.bail}) · ${cost}`;
  }
  const pct = (result.passRate * 100).toFixed(0);
  return `${status} ${label} — ${result.passes}/${result.runs.length} passed (${pct}%) · ${cost}`;
}

export function reportCalibrate(
  label: string,
  result: CalibrateResult,
  opts?: ReportOptions,
): string {
  if (opts?.characterization) {
    return `~ ${label} — measured ${result.passes}/${result.runs.length} (non-gating, see fixture header) · $${result.totalCost.toFixed(4)}`;
  }
  const lines: string[] = [calibrateStatusLine(label, result)];
  if (!result.meetsReliabilityBar && !result.aborted) {
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
