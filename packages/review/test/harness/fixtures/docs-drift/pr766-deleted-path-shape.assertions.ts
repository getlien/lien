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
 *    all-but-a-few `platform/` files — the handful of exceptions don't
 *    prevent the directory-level grouping, which only needs ONE confirmed
 *    deletion under the prefix AND zero surviving repoChunks under it, both
 *    true here).
 *
 * 2. DISCOVERED: the real PR #593 diff ALSO touches CLAUDE.md (removing the
 *    exact stale bullets: "- `packages/` — ...(..., runner, site)" and
 *    "- `platform/` — Laravel 12 web app..."). Since docs-drift's own
 *    untouched-only filter (by design) excludes any file in `pr.patches` /
 *    `changedFiles` / `allChangedFiles`, CLAUDE.md was NOT eligible as an
 *    "untouched doc" in the raw capture. To honestly stage the counterfactual
 *    design §5.A asks for ("what if this bullet had survived, unedited, in an
 *    UNTOUCHED CLAUDE.md"), CLAUDE.md's entry was removed from `pr.patches`,
 *    `pr.diffLines`, `changedFiles`, `allChangedFiles`, and the changed-
 *    files-only `chunks` array (299->298 patches, 36->3 chunks) — leaving
 *    CLAUDE.md's 33 `repoChunks` doc chunks (the post-deletion, head-state
 *    content) as the untouched corpus docs-drift sweeps.
 *
 * 3. INJECTED the bullet into CLAUDE.md's "## What is Lien?" chunk
 *    (repoChunks entry, startLine 3), right after the existing "Monorepo
 *    Structure:" bullet, bumping that chunk's endLine 38->39:
 *      - `platform/` and `packages/runner` — hosted-platform remnants (see
 *        [ADR-012](docs/architecture/decisions/0012-self-hostable-review-action.md));
 *        safe to ignore.
 *    Two deliberate design choices baked into this exact wording:
 *      a. The "retired" resolution (locked precedence: the suppression guard
 *         stays BROAD, the FIXTURE adapts) — the real #766 bullet ("retired
 *         hosted-platform remnants") contains "retired", which
 *         `HISTORICAL_GUARD_RE` correctly suppresses by design (the primary
 *         FP class docs-drift exists to filter). This variant carries none
 *         of that guard's trigger words (was/were+verb, retired, formerly,
 *         deprecated, previously, prior to, no longer, used to) while
 *         staying equally implausible as a *current*, accurate description —
 *         a reader would still be misled into thinking `platform/` and
 *         `packages/runner` exist.
 *      b. The ADR-cited link — `(see [ADR-012](...))` — is the fix-#1
 *         regression test for the link-suppression NARROWING: this repo's
 *         dominant doc idiom cites an ADR link right next to a genuine
 *         structural bullet. A prior blanket "line has a link ANYWHERE"
 *         suppression silently ate this exact shape (found by adversarial
 *         review of this fixture); the narrowed suppression
 *         (`referandOnlyInsideLinkOrUrl` in `docs-drift-signals.ts`) only
 *         suppresses when the referand's OWN occurrence sits inside the
 *         link markup — `packages/runner`/`platform` sit in plain prose
 *         here, not inside `[ADR-012](...)`, so this bullet correctly FIRES.
 *
 * 4. `config.docsDriftPass` set to `true` (capture-pr.ts never sets
 *    pass-specific config; the pass is dark by default).
 *
 * No other repoChunks were pruned or altered — an earlier iteration of this fixture also removed
 * `.github/workflows/release.yml` (an ambient, unrelated CI comment about the GitHub Actions
 * "hosted runner" machine coincidentally matched the `packages/runner` referand's trailing-segment
 * ALT-TOKEN). That alt-token was removed from the signal entirely (design's precision-first fix:
 * `docs-drift-signals.ts` no longer sweeps a bare trailing path segment, only the full path), so
 * the false match no longer occurs and release.yml no longer needs pruning — fewer hand-edits, a
 * more honest fixture.
 *
 * RESULT (verified this session): `computeDocsDriftCandidates` returns exactly 2 candidates, both
 * citing CLAUDE.md:14 (structural-mention) — `{referand:"packages/runner", ...}` and
 * `{referand:"platform", ...}`. `.github/workflows/release.yml` produces zero candidates (no
 * alt-token to false-match on).
 *
 * OFFLINE PROOF (zero-LLM, no OpenRouter spend — see PR body for the verbatim run):
 * `LIEN_DOCS_DRIFT_PASS=on npx tsx packages/review/test/harness/build-prompts.ts <this fixture>`
 * -> `docsDriftPass: {"fires":true}`, with candidate-1 = referand "packages/runner", "Untouched
 * doc: CLAUDE.md:14 (structural-mention)", the ADR-cited bullet in the doc-side excerpt (NOT
 * suppressed by the link), and the real `packages/runner/Dockerfile` deletion hunk as the code-side
 * evidence. (The "platform" candidate is deferred by this pass's realistic budget ceiling —
 * `computeDocsDriftWorklist` affords exactly 1 of the 2 eligible candidates at the floor budget —
 * an authentic demonstration of the rank-and-cap overflow mechanism, not a fixture defect.)
 *
 * SHIPPED THIS SESSION: the candidate-FIRES proof above (deterministic, zero-LLM), PLUS a durable
 * unit-test regression (`docs-drift-signals.test.ts`) covering the same ADR-cited-bullet shape with
 * inline synthetic input — independent of this gitignored fixture JSON.
 *
 * CALIBRATION RECORD (owner-ordered, 2026-07-23): `npm run test:harness -w @liendev/review -- --fixture
 * test/harness/fixtures/docs-drift/pr766-deleted-path-shape.fixture.json --calibrate 10` (prod default
 * model, `moonshotai/kimi-k2.7-code`) scored **1/10 (10%)** for **$0.4870** — well below the 9/10 bar.
 * NOT certified; recorded here as a characterization, per cost discipline (no prompt iteration; a
 * second calibration run was NOT spent chasing the bar — see per-vote taxonomy below). Scope: this
 * result characterizes the synthetic hand-staged shape only, not production behavior on real captured
 * PRs (the fixture is tagged `synthetic`, not `canary`).
 *
 * PER-VOTE TAXONOMY (from `.wip/traces/2026-07-23T10-22-28Z-pr766-deleted-path-shape/`, 10 votes):
 *   - PASS (1/10, vote 6) — verdict "drifted", correctly reasoned from the candidate excerpt +
 *     `grep_codebase` confirmation that `packages/runner`/`platform/` are genuinely gone; did not
 *     second-guess the excerpt against the live file.
 *   - FAIL bucket A — "ground-truth contradiction via read_file" (6/10: votes 1, 3, 4, 5, 8, 10,
 *     verdicts "intentional" x5 + "unverifiable" x1) — the model calls `read_file` on CLAUDE.md,
 *     which (being a HAND-STAGED synthetic excerpt, not a real repoRootDir capture) returns THIS
 *     repo's actual real-world CLAUDE.md — which has evolved past both the pre-PR and the
 *     injected-bullet state and contains neither the `packages/runner` bullet nor the ADR-012
 *     citation. The model treats that mismatch as proof the doc was "already updated" (verdict
 *     "intentional") or flags it as internally inconsistent (verdict "unverifiable"), rather than
 *     trusting the candidate's stated doc excerpt as the fixture's ground truth. This is a
 *     synthetic-fixture authenticity gap, not a production reasoning bug: a real captured PR's
 *     `read_file` would return the doc content as it stood at capture time, matching the candidate;
 *     only a hand-staged injection can diverge from the live repo like this.
 *   - FAIL bucket B — "historical mis-classification despite no guard keywords" (3/10: votes 2, 7, 9,
 *     verdict "historical") — the fixture's design (§3.a above) deliberately avoids every
 *     `HISTORICAL_GUARD_RE` trigger word specifically to test whether the deterministic regex's
 *     narrow scope leaves a gap the LLM should still catch. Instead, the model's own semantic
 *     judgment independently pattern-matches "hosted-platform remnants ... safe to ignore" as
 *     self-evidently past-tense/historical framing and downgrades to "historical" — the opposite of
 *     the fixture's intent (this phrasing should read as a plausible-looking CURRENT maintenance
 *     note, not an obvious retirement notice). This is a genuine judgment-frontier gap worth tracking
 *     if docs-drift calibration is revisited, not a fixture defect.
 *
 * The Tier-1/Tier-2 assertions below remain the calibration target for a future prompt-tuning pass;
 * per owner instruction this session does NOT iterate the prompt in response to the score above.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'Synthetic — real PR #593 packages/runner + platform/ deletion, hand-staged with an ' +
    'injected untouched CLAUDE.md bullet ("hosted-platform remnants (see [ADR-012](...)); safe ' +
    'to ignore", no historical-guard trigger words, an ADR link that must NOT blanket-suppress) ' +
    'naming the now-deleted paths as if still current',
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
