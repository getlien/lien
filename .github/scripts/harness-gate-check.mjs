#!/usr/bin/env node
// Decision logic for the "Require harness evidence or bypass label" gate
// (.github/workflows/harness-attestation.yml). Factored out of inline bash
// so it is unit-testable and locally runnable against real or synthetic
// data without needing a live Actions run -- see the dogfood section of the
// PR that introduced this file for a four-way verification transcript.
//
// OWNER-ONLY LABEL POLICY
// ------------------------
// `skip-harness-gate` bypasses the mandatory harness-calibration evidence
// check from CLAUDE.md. It must never be self-applied by an agent to get
// past the gate -- the norm is: gates pass on EVIDENCE, the bypass label is
// OWNER-only. Two incidents (PR #768, PR #799) had an agent apply the label
// itself. This script enforces that only an allowlisted human login's most
// recent `labeled` event for `skip-harness-gate` is honored; anyone else's
// label application is silently ignored and the PR falls through to the
// ordinary evidence check, exactly as if unlabeled.
//
// KNOWN LIMITATION (see PR body for full context): agents in this repo
// currently act under the owner's own `gh`/GITHUB_TOKEN credentials, so this
// check cannot distinguish an agent-performed label event from a
// human-performed one when both are attributed to the same login. It closes
// the "anyone can bypass by applying the label" hole; it does not (yet)
// close the "the owner's own credentials get used by an agent" hole -- that
// needs a separate bot identity and is out of scope here.
//
// Usage:
//   node harness-gate-check.mjs applier
//     Reads TIMELINE_JSON (env) -- the JSON returned by
//     `gh api repos/{owner}/{repo}/issues/{n}/timeline --paginate --slurp`
//     (an array of per-page arrays; a plain flat array of timeline events
//     also works, e.g. when a `--slurp`-free single-page fetch is used
//     locally for dogfooding).
//     Prints "true" or "false" to stdout (whether the skip-harness-gate
//     label should be honored) and the reasoning to stderr. Always exits 0
//     -- this mode only decides, it never fails the job.
//
//   node harness-gate-check.mjs evidence
//     Reads PR_BODY (env) -- the pull request description.
//     Exits 0 with a stdout message if harness evidence wording is found,
//     exits 1 with an actionable stderr message otherwise.
//
// No npm dependencies -- node:process only.

const LABEL_NAME = 'skip-harness-gate';

// Extend this list to allow another human login to apply the bypass label.
// Do NOT add bot/agent identities -- see the limitation note above.
const ALLOWLISTED_LABEL_APPLIERS = ['alfhen'];

// The root cause of both incidents (#765, #799) was legitimate deterministic
// evidence the original grep didn't recognize -- byte-identical/sha256
// fixture-comparison census results, not just the harness's own
// `--calibrate` wording or a linked harness.yml run. This is a conservative
// widening: a PR body still needs to affirmatively claim ONE of these, an
// empty/unrelated body still fails.
const EVIDENCE_PATTERNS = [
  { name: 'harness-result summary', re: /harness-result/i },
  { name: 'linked harness.yml run', re: /actions\/runs\/[0-9]+/i },
  { name: 'calibrate mention', re: /calibrate/i },
  { name: 'byte-identical census', re: /byte[- ]identical/i },
  { name: 'byte-diff census', re: /byte[- ]diff/i },
  { name: 'sha256-verified census', re: /sha256/i },
  { name: 'build-prompts fixture comparison', re: /build-prompts\.ts/i },
];

export function decideApplier(timelineJson) {
  let events;
  try {
    events = JSON.parse(timelineJson || '[]');
  } catch (err) {
    return {
      honored: false,
      reason: `TIMELINE_JSON did not parse as JSON (${err.message}) -- treating '${LABEL_NAME}' as not honored.`,
    };
  }
  if (!Array.isArray(events)) {
    return {
      honored: false,
      reason: `TIMELINE_JSON was not a JSON array -- treating '${LABEL_NAME}' as not honored.`,
    };
  }
  // `gh api --paginate --slurp` wraps each page's array in an outer array
  // (i.e. an array of arrays), even for a single page. Flatten one level so
  // both that shape and a plain flat array of events work identically.
  if (events.every(e => Array.isArray(e))) {
    events = events.flat();
  }

  const labelEvents = events.filter(
    e => e && e.event === 'labeled' && e.label && e.label.name === LABEL_NAME,
  );
  if (labelEvents.length === 0) {
    return {
      honored: false,
      reason: `No 'labeled' timeline event found for '${LABEL_NAME}' -- treating as not honored.`,
    };
  }

  // Timeline events are already chronological, but sort defensively by
  // created_at so "most recent" is correct even if that ever changes.
  labelEvents.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const mostRecent = labelEvents[labelEvents.length - 1];
  const actor = mostRecent.actor && mostRecent.actor.login;
  const honored = Boolean(actor) && ALLOWLISTED_LABEL_APPLIERS.includes(actor);

  return {
    honored,
    reason: honored
      ? `Most recent '${LABEL_NAME}' labeled event was applied by '${actor}', which is on the allowlist (${ALLOWLISTED_LABEL_APPLIERS.join(', ')}) -- bypass honored.`
      : `Most recent '${LABEL_NAME}' labeled event was applied by '${actor || 'unknown'}', which is NOT on the allowlist (${ALLOWLISTED_LABEL_APPLIERS.join(', ')}) -- ignoring the label; proceeding to the evidence check as if unlabeled.`,
  };
}

export function decideEvidence(prBody) {
  const body = prBody || '';
  const match = EVIDENCE_PATTERNS.find(p => p.re.test(body));
  if (match) {
    return { found: true, reason: `Found harness evidence in PR body (matched: ${match.name}).` };
  }
  return {
    found: false,
    reason:
      "This PR touches packages/review/src/plugins/agent/** but the PR body has no harness evidence (a link to a harness.yml run/artifact, a 'calibrate' mention, or a deterministic byte-identical/byte-diff/sha256/build-prompts.ts fixture-comparison census) and no owner-applied 'skip-harness-gate' label. Per CLAUDE.md, rule/prompt changes need a >=9/10 calibration run (npm run test:harness -- --rule <rule-id> --calibrate 10) before merging, unless the change is provably non-behavioral (deterministic fixture-comparison evidence). Paste the harness.yml run link, a harness-result.json summary, or the deterministic comparison method + result in the PR description.",
  };
}

function main() {
  const mode = process.argv[2];
  if (mode === 'applier') {
    const { honored, reason } = decideApplier(process.env.TIMELINE_JSON);
    console.error(reason);
    console.log(honored ? 'true' : 'false');
    process.exit(0);
  } else if (mode === 'evidence') {
    const { found, reason } = decideEvidence(process.env.PR_BODY);
    if (found) {
      console.log(reason);
      process.exit(0);
    }
    console.error(`::error::${reason}`);
    process.exit(1);
  } else {
    console.error('Usage: harness-gate-check.mjs <applier|evidence>');
    process.exit(2);
  }
}

// Only run as a CLI when invoked directly (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
