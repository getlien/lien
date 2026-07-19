/**
 * SYNTHETIC shape fixture (docs-drift design doc §5.A, `.wip/docs-drift-design.md`).
 *
 * Tagged `synthetic`, NOT `canary` — this exercises the deleted-path referand
 * + structural-mention tier end-to-end, but is honestly hand-staged, not a
 * clean captured-real-PR positive. Design §0.1 established why no single real
 * PR captures "code deletion + a coincident stale UNTOUCHED doc": the real
 * code deletion (PR #593, "retire packages/runner and the platform/ Laravel
 * app") updated CLAUDE.md's stale bullets IN THE SAME DIFF, so there is no
 * real PR where that doc is genuinely untouched.
 *
 * HAND-STAGING HISTORY (every edit, in order — so this fixture's provenance
 * is auditable):
 *
 * 1. BASE CAPTURE — real PR #593 deletion. `capture-pr.ts`'s `--sha` requires
 *    a commit within the PR's OWN branch lineage; the merge commit `06cf2b6a`
 *    the design doc cites is main's SQUASH-MERGE commit, not an ancestor of
 *    the PR branch's own head, so (mirroring the same fix needed for the
 *    pr799 boundary fixture) the actual PR branch head SHA was used instead —
 *    fetched via `git fetch origin refs/pull/593/head` (needed since a
 *    squash-merged branch's commits aren't otherwise reachable locally):
 *      npx tsx packages/review/test/harness/capture-pr.ts 593 \
 *        packages/review/test/harness/fixtures/docs-drift/pr766-deleted-path-shape.fixture.json \
 *        --sha 2aa87b3044fc0ea08768206df4152df17f273a20
 *    This captures the real deletion of `packages/runner/**` (21 files) and
 *    `platform/**` (271 files) — every file's patch is a genuine full-file
 *    deletion (`isFullFileDeletion` true for all 21 `packages/runner/` files;
 *    all-but-a-few `platform/` files, verified via a debug script this
 *    session — the handful of exceptions don't prevent the directory-level
 *    grouping, which only needs ONE confirmed deletion under the prefix AND
 *    zero surviving repoChunks under it, both true here).
 *
 * 2. DISCOVERED: the real PR #593 diff ALSO touches CLAUDE.md (removing the
 *    exact stale bullets: "- `packages/` — ...(..., runner, site)" and
 *    "- `platform/` — Laravel 12 web app..."). Since docs-drift's own
 *    untouched-only filter (by design) excludes any file in `pr.patches` /
 *    `changedFiles` / `allChangedFiles`, CLAUDE.md was NOT eligible as an
 *    "untouched doc" in the raw capture — confirmed via a debug script this
 *    session (`CLAUDE.md in changed set: true`). To honestly stage the
 *    counterfactual design §5.A asks for ("what if this bullet had survived,
 *    unedited, in an UNTOUCHED CLAUDE.md"), CLAUDE.md's entry was removed
 *    from `pr.patches`, `pr.diffLines`, `changedFiles`, `allChangedFiles`,
 *    and the changed-files-only `chunks` array (299->298 patches, 36->3
 *    chunks) — leaving CLAUDE.md's 33 `repoChunks` doc chunks (the post-
 *    deletion, head-state content) as the untouched corpus docs-drift sweeps.
 *
 * 3. INJECTED the variant bullet into CLAUDE.md's "## What is Lien?" chunk
 *    (repoChunks entry, startLine 3), right after the existing "Monorepo
 *    Structure:" bullet, bumping that chunk's endLine 38->39:
 *      - `platform/` and `packages/runner` — hosted-platform remnants; safe to ignore.
 *    CRITICAL — the "retired" resolution (locked precedence: the suppression
 *    guard stays BROAD, the FIXTURE adapts): the real #766 bullet
 *    ("retired hosted-platform remnants") contains "retired", which
 *    `HISTORICAL_GUARD_RE` correctly suppresses by design (the primary FP
 *    class docs-drift exists to filter). This variant carries none of
 *    HISTORICAL_GUARD_RE's trigger words (was/were+verb, retired, formerly,
 *    deprecated, previously, prior to, no longer, used to) while staying
 *    equally implausible as a *current*, accurate description — a reader
 *    would still be misled into thinking `platform/` and `packages/runner`
 *    exist.
 *
 * 4. PRUNED one incidental noise chunk: `.github/workflows/release.yml`
 *    (untouched, unrelated to PR #593) contains an ambient comment
 *    ("the runner's Node 22...", "hosted runner image") about the CI
 *    hosted-runner MACHINE — a coincidental, unrelated hit on the
 *    `packages/runner` referand's trailing-segment alt-token ("runner").
 *    Verified this session: left in, it becomes a `behavioral-claim`-tier
 *    candidate that SORTS AHEAD of the intended `structural-mention`-tier
 *    CLAUDE.md candidate (Tier-1 beats Tier-2 in `computeDocsDriftCandidates`'s
 *    sort), and at this pass's realistic production budget floor
 *    (`docsDriftPassBudget` -> `EXTRA_PASS_MIN_BUDGET_TOKENS` = 11,000 ->
 *    `affordableCandidateCeiling` affords exactly 1 candidate for this
 *    referand count), it would have crowded the CLAUDE.md candidate OUT of
 *    the rendered `<docs_drift>` worklist entirely. This is real, honestly-
 *    documented evidence of a genuine (narrow) precision gap in the
 *    trailing-segment alt-token heuristic (`docs-drift-signals.ts`'s
 *    `trailingSegment`) — worth a future follow-up, not hidden. Pruning this
 *    ONE ambient, unrelated repoChunk from an already-extensively-hand-staged
 *    synthetic fixture (not touching the shipped signal or suppression code)
 *    is the fixture-side fix per the locked precedence.
 *
 * 5. `config.docsDriftPass` set to `true` (capture-pr.ts never sets
 *    pass-specific config; the pass is dark by default).
 *
 * RESULT (verified this session): `computeDocsDriftCandidates` returns
 * exactly 2 candidates, both citing CLAUDE.md:14 (structural-mention) —
 * `{referand:"packages/runner", ...}` and `{referand:"platform", ...}`.
 *
 * OFFLINE PROOF (zero-LLM, no OpenRouter spend — see PR body for the
 * verbatim run): `LIEN_DOCS_DRIFT_PASS=on npx tsx
 * packages/review/test/harness/build-prompts.ts <this fixture>` ->
 * `docsDriftPass: {"fires":true}`, with candidate-1 = referand
 * "packages/runner", "Untouched doc: CLAUDE.md:14 (structural-mention)",
 * the injected bullet in the doc-side excerpt, and the real
 * `packages/runner/Dockerfile` deletion hunk as the code-side evidence. (The
 * "platform" candidate is deferred by the same realistic budget ceiling —
 * `computeDocsDriftWorklist` affords exactly 1 of the 2 eligible candidates —
 * an authentic demonstration of the rank-and-cap overflow mechanism, not a
 * fixture defect.)
 *
 * SHIPPED THIS SESSION: the candidate-FIRES proof above (deterministic,
 * zero-LLM). NOT shipped: any real `drifted` verdict — no paid calibration
 * ran this session (cost discipline; per the overseer's explicit scope). The
 * Tier-1/Tier-2 assertions below are written as the FUTURE calibration
 * target (a `--calibrate 10` run, pending owner greenlight) — a real vote
 * against this fixture has not yet been observed to pass or fail them.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'Synthetic — real PR #593 packages/runner + platform/ deletion, hand-staged with an ' +
    'injected untouched CLAUDE.md bullet ("hosted-platform remnants; safe to ignore", no ' +
    'historical-guard trigger words) naming the now-deleted paths as if still current',
  rule: 'docs-drift',
  expect: (result, h) => {
    h.expectRuleFired('docs-drift', result);
    // Tier 2 (future-calibration target — see header): a correct finding names the deleted
    // path(s) and/or the stale bullet's own wording, and cites the doc file.
    h.expectFindingMentions(
      [
        'packages/runner',
        'platform/',
        'hosted-platform remnants',
        'monorepo structure',
        'claude.md',
        'safe to ignore',
      ],
      result,
    );
  },
  votes: 10,
  passThreshold: 9,
  tags: ['synthetic'],
};

export default assertions;
