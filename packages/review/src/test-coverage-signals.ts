/**
 * Deterministic "no test coverage" signal for PR reviews (issue #288).
 *
 * `ComplexityReport.files[path].testAssociations` already carries which test
 * files map to each changed source file, but nothing surfaces it in the
 * architectural prompt — the agent can't say "you added 3 files with no
 * tests" without seeing this data. This module serializes it as a
 * `<test_coverage>` block, mirroring the `<removed_exports>` /
 * `<stale_literal_candidates>` precedents: pre-compute the deterministic fact,
 * inject it, and let the agent decide whether it matters for this PR.
 *
 * `testAssociations` is a required `string[]` that defaults to `[]` in TWO
 * situations the type can't distinguish: enrichment ran and genuinely found
 * no test file, OR enrichment never ran (it's wrapped in try/catch in
 * review-pr.ts and silently no-ops when the repo has no test files at all —
 * see `enrichWithTestAssociations` in analysis.ts). There is no separate flag
 * for "did enrichment run." To avoid manufacturing gaps out of missing data,
 * this module keys off PER-FILE entry presence in `complexityReport.files`
 * rather than trusting every empty array: a changed file with NO entry at all
 * has no complexity data one way or the other and is skipped, not flagged. An
 * empty `testAssociations` is only treated as a real gap on a file that DOES
 * have a report entry. Practically, this also covers "enrichment never ran
 * for any file" — every lookup misses, so the gap list ends up empty and the
 * block renders nothing, matching the "absence of data is not evidence of a
 * gap" principle.
 */

import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max changed files listed — keeps the block within the ~100-200 token target. */
const MAX_FILES = 10;

const HEADER =
  'Pre-computed from the complexity report’s test-association data — ' +
  'deterministic, not a tool call; do not re-derive it. Each listed file ' +
  'changed in this PR and has NO associated test file. This is a factual ' +
  'observation, not an instruction to report each one as a finding (missing ' +
  'tests are out of scope for individual findings — see Rules); use it only ' +
  'as context, e.g. for the summary/overview when substantial new logic ' +
  'ships with no test coverage at all. A file NOT listed here has SOME test ' +
  'file associated with it — that does not mean this PR’s specific change is ' +
  'covered. It does NOT substitute for the boundary-change protocol’s ' +
  'MANDATORY get_files_context call: you must still inspect the actual test ' +
  'content for an assertion on the exact divergence input, per the protocol.';

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Changed files that have a complexity-report entry but no associated test
 * file. Files with no entry in `complexityReport.files` (not analyzed, or
 * enrichment never ran) are skipped — absence of data is not evidence of a
 * gap. Exposed for testing.
 */
export function computeTestCoverageGaps(context: ReviewContext): string[] {
  const files = context.complexityReport?.files;
  if (!files) return [];

  const gaps: string[] = [];
  for (const file of context.changedFiles) {
    const data = files[file];
    if (!data || !Array.isArray(data.testAssociations)) continue;
    if (data.testAssociations.length === 0) gaps.push(file);
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the gap list as a `<test_coverage>` block for the agent's initial
 * message. Returns '' when there are no gaps, so callers can append
 * unconditionally. Caps at MAX_FILES with an explicit omission note — no
 * silent truncation. Exposed for testing.
 */
export function renderTestCoverageGaps(gaps: string[]): string {
  if (gaps.length === 0) return '';

  const lines: string[] = ['<test_coverage>', HEADER];
  const shown = gaps.slice(0, MAX_FILES);
  for (const file of shown) lines.push(`- ${file}`);

  const omitted = gaps.length - shown.length;
  if (omitted > 0) {
    lines.push(
      `- [+${omitted} more changed file(s) with no associated tests omitted — see the complexity report for the rest]`,
    );
  }

  lines.push('</test_coverage>');
  return lines.join('\n');
}

/**
 * Build the `<test_coverage>` section from the review context. Returns ''
 * when every changed file with complexity data has test associations, or when
 * no changed file has complexity data at all.
 */
export function renderTestCoverageSection(context: ReviewContext): string {
  return renderTestCoverageGaps(computeTestCoverageGaps(context));
}
