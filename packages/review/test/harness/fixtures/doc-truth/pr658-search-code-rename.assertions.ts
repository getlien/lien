/**
 * Snapshot from PR #658 (merged, squash commit 7318371, PR head b24fa33) —
 * a 40-file mechanical rename sweep: `semantic_search` -> `search_code`
 * (per #657, which made embeddings inert and search purely lexical/BM25),
 * plus removal of the now-dishonest embedding-themed indexing spinner copy.
 *
 * Lien Review reported ZERO findings on this PR and its own summary
 * asserted "user-facing docs were updated consistently". CodeRabbit's
 * review on the same PR caught two real findings that Lien Review missed:
 *
 * Finding A (documented below; TRACKED CHARACTERIZATION as of 2026-07-16,
 * see "OWNER RE-SCOPE DECISION" — no longer part of the certified gate):
 *   `packages/core/src/config/schema.ts:62`, the `embeddings.enabled` doc
 *   comment. The diff mechanically renamed the identifier in place:
 *     - "...keep working; semantic_search and find_similar report as disabled."
 *     + "...keep working; search_code and find_similar report as disabled."
 *   The rename is textually correct but the underlying CLAIM is now false:
 *   since #657, `search_code` is the lexical BM25 path and does NOT depend
 *   on embeddings. CodeRabbit's own suggested fix narrows the claim to
 *   "only find_similar reports as disabled" — but that's ALSO stale: an
 *   audit of `handleFindSimilar` at this PR's head commit
 *   (packages/cli/src/mcp/handlers/find-similar.ts) shows it runs the same
 *   lexical FTS5/BM25 `vectorDB.search` with a vestigial zero-vector as
 *   `search_code`, with no `embeddings.enabled` check anywhere in either
 *   handler. Repo-wide grep at the PR head confirms zero runtime references
 *   to a "disabled" search state outside these two doc comments
 *   (`schema.ts` and `null-embeddings.ts:20`, which has the identical
 *   stale claim baked into the same PR's rename and wasn't flagged by
 *   either reviewer). The accurate fix is that NEITHER tool reports as
 *   disabled any more — the disabled-status behavior described here was
 *   fully retired, not partially. This is exactly the shape the `doc-truth`
 *   rule (#665) exists to catch: a prose claim the diff touched that no
 *   longer tracks the code's real behavior. (This fixture was originally
 *   captured under stale-duplicate — the nearest rule at the time — and
 *   retargeted after the 2026-07-04 post-merge sweep showed all 3 votes
 *   catching this finding via doc-truth.) Corroborating GitHub
 *   thread: https://github.com/getlien/lien/pull/658#discussion_r3522630327
 *
 * Finding B (asserted below, Tier 2 — promoted 2026-07-04, see below; still
 * the CERTIFIED signal after the 2026-07-16 re-scope):
 *   `plugins/claude/hooks/augment-explore-task.sh:64` described
 *   `search_code` as "REQUIRED for meaning-based discovery" — the tool is
 *   keyword/BM25 search, not meaning-based, so the hook's own guidance
 *   contradicts the tool's real behavior post-#657.
 *   https://github.com/getlien/lien/pull/658#discussion_r3522630331
 *
 *   PREVIOUSLY (through the #665 merge) this finding was believed
 *   IMPOSSIBLE for the agent-review pipeline to reach — `.sh` produces zero
 *   parser chunks, and the header here documented a second failure mode
 *   (the raw `<diff>` block truncating at `MAX_DIFF_CHARS` = 50,000 chars
 *   before reaching this file, the last one in the PR's ~77.7KB diff). That
 *   analysis predated the guidance-surface passthrough actually landing in
 *   this rule's rendered prompt for this fixture. Re-verified 2026-07-04 via
 *   `npx tsx packages/review/test/harness/build-prompts.ts <fixture>` (zero
 *   LLM calls, pure prompt assembly): the rendered `initialMessage` now
 *   contains a `<guidance_surface_changes>` block — populated independently
 *   of the truncated `<diff>` block and of chunk availability — whose second
 *   entry is the full `augment-explore-task.sh` hunk, including line 64's
 *   "REQUIRED for meaning-based discovery" claim verbatim. The visibility
 *   gap is closed; this is no longer a "can't reach it" case.
 *
 *   With reachability confirmed, the promotion calibrate-10 (below) doubled
 *   as the votes-support-strengthening check: 9/10 runs independently
 *   reported this exact claim, every one quoting "meaning-based" and citing
 *   `augment-explore-task.sh:64` against the same sentence's "Full-text
 *   (BM25) search" / "no embeddings" text. The one miss (run 5 of 10) found
 *   only the `null-embeddings.ts` stale-reference variant of Finding A and
 *   didn't independently reach Finding B — expected model variance, not a
 *   pipeline gap. Asserted as a second Tier-2 `expectFindingMentions(['meaning-based',
 *   'meaning based'], result)` call (kept separate from Finding A's keyword
 *   list so it gates on Finding B specifically rather than piggybacking on
 *   Finding A's broader OR-list, several of whose keywords — `search_code`,
 *   `bm25`, `full-text`, `lexical` — happen to also appear in Finding B's
 *   wording). Tier 1 (`expectRuleFired('doc-truth', …)`) is unchanged: it
 *   already covers "some doc-truth finding fired" regardless of which one.
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 658 \
 *     packages/review/test/harness/fixtures/doc-truth/pr658-search-code-rename.fixture.json
 *
 * Calibration status: PROMOTED TO CANARY 2026-07-04. Fresh `--calibrate 10`
 * against the (then-unmodified) Finding-A-only assertions: 10/10 passed,
 * cost $0.4012 — past the >= 9/10 bar (#538), but the per-run breakdown
 * matters more than the headline number here. Exactly which file the model
 * cited varied a lot: the literal `schema.ts:62` `embeddings.enabled` claim
 * Finding A describes fired directly in only 1/10 runs; the closely related
 * `null-embeddings.ts:22` stale file-path reference (same rename, same
 * underlying staleness, different file — also a real, valid doc-truth
 * finding) fired in 6/10; the `augment-explore-task.sh:64` Finding B fired
 * in 9/10. In 4/10 runs NEITHER schema.ts NOR null-embeddings.ts fired at
 * all — Finding A's Tier-2 check still passed in those runs purely because
 * its keyword list (`search_code`, `lexical`, `bm25`, `full-text`, …) is
 * broad enough to also match Finding B's wording. So the honest read of
 * "10/10": the doc-truth rule reliably (10/10) surfaces *a* real
 * rename-staleness finding on this diff, and independently (9/10) surfaces
 * Finding B specifically — but the original Finding-A assertion, taken
 * alone, does not verify "schema.ts is cited" so much as "some plausible
 * stale-rename claim, in this vocabulary neighborhood, was made". Recorded
 * in full per the harness's Tier-2-brittleness lesson (matches phrasing, not
 * always substance) rather than glossed over; judged an acceptable canary
 * because the rule's core mandate — catch this PR's real regression — is
 * met every run, just not always pinned to the one file this fixture was
 * named after. Finding B's new Tier-2 check was verified against the same
 * 10 raw results via `assert-cli.ts` (zero additional LLM cost) rather than
 * a fresh paid run: 9/10 pass with both Finding-A and Finding-B checks
 * combined (run 5 is the sole miss — only the null-embeddings.ts variant
 * fired, no `augment-explore-task.sh` finding), matching the passThreshold
 * of 9 exactly.
 *
 * History: originally captured under `stale-duplicate` — the nearest rule
 * before `doc-truth` existed — and retargeted to `doc-truth` after a
 * 2026-07-04 post-merge sweep (rename-sweep signal #663 + doc-truth rule
 * and guidance passthrough #665) showed 3/3 votes catching Finding A via
 * `doc-truth`. That 3-vote sweep is superseded by the calibrate-10 above.
 *
 * KEYWORD-INTEGRITY SWEEP (2026-07-16): Finding A's list was bare-noun-heavy
 * ('embeddings', 'search_code', 'find_similar', 'lexical', 'bm25',
 * 'full-text', 'stale', 'no longer' — all central vocabulary for this
 * 40-file rename PR) and false-passed a hand-written distractor about
 * augment-explore-task.sh:64 that reached the WRONG, defensive conclusion
 * ("the meaning-based guidance is fine, just incomplete") via assert-cli.ts
 * — it matched purely on 'search_code', with no schema.ts anchor at all.
 * Tightened Finding A to the file anchor + compound "reports as
 * disabled"/correction phrases only; re-verified against both the literal
 * schema.ts wording AND the null-embeddings.ts sibling variant (6/10 of the
 * original calibration's votes per above) — both still pass. Finding B
 * ('meaning-based') was left untouched per minimal-diff, though note it is
 * itself stance-blind (matches a finding that *agrees* the guidance is
 * accurate, not just one that falsifies it) — a residual worth a future
 * pass, not fixed here. No stored vote traces exist to offline re-score
 * (fresh worktree); this canary's 10/10 PREDATES this tightening — the
 * upcoming corpus recalibration sweep re-measures it.
 *
 * 3-vote screen 2026-07-16 post-#787 state: 1/3 [SCREEN ONLY — calibrate-10
 * certification pending]. Post-#787 both failed votes FIRE doc-truth with 5
 * findings (incl. Finding B, augment-explore-task.sh) but omit Finding A
 * (schema.ts embeddings.enabled claim) — the omission frontier, not a
 * budget/truncation failure. Earlier same-day pre-#787 screen
 * (main@5fadbe1a): 0/3, with 2 empty-verdict votes showing the
 * forced-turn/length degenerate-loop truncation shape (#787's target) and 1
 * Finding-A omission. #787 fixed the truncation shape; the Finding-A
 * omission remains the blocker.
 *
 * ---------------------------------------------------------------------
 * OWNER RE-SCOPE DECISION (2026-07-16, post-PR-#792 screen; see PR #792
 * body for the full 11-canary triage table this decision is drawn from):
 *
 * PR #792's 3-vote screen of this fixture measured 1/3 post-#787. Both
 * misses are healthy, non-degenerate runs: doc-truth fires, produces 5 real
 * findings, and Finding B (augment-explore-task.sh) is among them every
 * time — but Finding A (schema.ts `embeddings.enabled`) is consistently
 * absent from the model's findings list. This is the doc-truth arc's
 * documented output-economy/omission frontier (see
 * docs/development/review-harness-judgment.md, "The deterministic-signal
 * pattern — and its limit": pre-computing the question and the answer isn't
 * enough when a finding must still WIN a competition for a scarce findings
 * slot; proven architecture-level by the Sonnet/Kimi model-swap in the
 * gap-analysis campaign). This PR's diff touches 5+ doc surfaces that all
 * restate the same rename-staleness theme; Finding A is real but is
 * consistently the one that loses that competition inside the dedicated
 * doc-truth pass itself — recurring even with rule competition removed,
 * which makes it an architectural limit of the current single-pass
 * findings list, not flakiness or a budget/prompt bug to chase further.
 *
 * Options considered:
 *   1. Keep grinding the doc-truth prompt/coverage to force Finding A's
 *      recall up. Rejected — this is the documented frontier, not a
 *      reachability or budget bug; #787 already fixed the one budget-shaped
 *      failure mode this fixture had. Further prompt tuning here would be
 *      re-litigating a closed finding per the judgment guide's golden rules.
 *   2. Tag the whole fixture `characterization` (non-gating). Rejected —
 *      the harness's only non-gating mechanism is whole-fixture (see
 *      run.ts: `passed = characterization || …`), which would also stop
 *      gating on Finding B and "doc-truth fired at all" — throwing away the
 *      one signal this pipeline DOES reliably deliver on this diff.
 *   3. [DECISION] Split the gate: keep this fixture tagged `canary` and
 *      CERTIFY on what the pipeline reliably does — doc-truth fires
 *      (Tier 1, unchanged) AND Finding B is present, correctly framed as a
 *      falsification rather than a vacuous mention (Tier 2, below). Finding
 *      A becomes a TRACKED CHARACTERIZATION EXPECTATION: visible in this
 *      header with a dated measured rate, but it no longer executes as a
 *      pass/fail check and never gates the vote. The harness has no
 *      per-check soft-probe primitive (only the fixture-level
 *      `characterization` tag, ruled out above as too coarse) — inventing
 *      one for a single fixture isn't warranted, so the honest
 *      implementation is: the code simply doesn't check Finding A anymore,
 *      and this comment is the record.
 *
 * Finding A's history, reconciled: it was part of the original 10/10
 * cert (2026-07-04, see above) and survived the 2026-07-16 keyword-integrity
 * sweep's re-verification — but both of those measurements ran against a
 * keyword list broad enough that Finding A's Tier-2 check could pass
 * without Finding A itself firing (the 4/10 runs, and the coattail-riding
 * on Finding B's vocabulary, documented above and in the #784 PR body).
 * After #784 tightened Finding A to the schema.ts file anchor specifically,
 * NO fresh paid calibration ran against that tightened check before today
 * — the 2026-07-16 screen above is the first real signal on it, and it's
 * poor (0/3 pre-#787, 1/3 post-#787). Re-reading the post-#787 traces
 * directly (`.wip/traces/2026-07-16T08-49-48Z-pr658-search-code-rename/`)
 * for this PR: the one pass (vote 3) didn't even surface Finding A as its
 * own finding — it appears only inside the *evidence* field of a different
 * finding (the `find_similar` semantic-claim finding at
 * packages/site/docs/guide/mcp-tools.md:103, whose evidence cites
 * "schema.ts:60 comment groups search_code and find_similar as reporting
 * disabled when the embedding worker is disabled"). So Finding A's true
 * measured rate, on the tightened check, across the only 3 votes ever run
 * against it, is best read as 1/3 (and that 1 a piggyback, not a dedicated
 * finding) — consistent with "may never have been truly pinned" rather than
 * a regression from a previously-solid 10/10.
 *
 * Follow-up: doc-truth v2 per-claim judgment (a dedicated per-claim
 * verification step, rather than one shared findings list competing across
 * every doc claim on the diff) is the structural fix for this class of
 * omission — see the two-pass architecture note in
 * docs/development/review-harness-judgment.md for the precedent ("if you
 * add a rule that keeps losing the findings competition, this is the
 * precedent to reach for — but only after proving competition is the
 * bottleneck", which PR #792's screen now does for Finding A specifically).
 * When that per-claim pass exists, re-add Finding A to this fixture's
 * certified Tier 2 gate.
 *
 * Reference only — Finding A's last-known (pre-2026-07-16) keyword list,
 * kept here so doc-truth v2's per-claim pass has a ready-made check to
 * restore rather than re-deriving it from scratch:
 *   ['schema.ts', 'embeddings.enabled', 'report as disabled',
 *    'reports as disabled', 'disabled when embeddings',
 *    'does not depend on embeddings', "doesn't depend on embeddings"]
 *
 * Finding B tightened alongside this re-scope (2026-07-16): now the SOLE
 * certified Tier-2 signal, so its previously-documented stance-blind
 * residual (matches a finding that *agrees* "meaning-based" framing is fine,
 * not just one that falsifies it — flagged but explicitly left unfixed by
 * the #784 sweep's minimal-diff scope) had to close rather than ride on
 * Finding A's now-removed backstop. Requires a SINGLE finding to name both
 * the claim ("meaning-based") and its correction/mechanism (`lexical` /
 * `bm25` / `no embeddings` / `not meaning-based` / `not semantic`).
 *
 * FIRST DRAFT BUG (caught by CodeRabbit on this PR's own review, PR #794):
 * the initial implementation used two separate `expectFindingMentions`
 * calls for the claim and correction keyword lists. `expectFindingMentions`
 * flattens every finding's text into one haystack before matching, so two
 * separate calls check "the claim appears somewhere across all findings"
 * AND "a correction term appears somewhere across all findings" —
 * independently, not within the same finding. On this all-about-lexical-
 * search rename PR, almost any multi-finding result contains "lexical" or
 * "bm25" *somewhere* for reasons unrelated to Finding B, so a distractor
 * finding that only mentions "meaning-based" (the defensive, wrong-
 * conclusion shape this exact residual is about) would still false-pass
 * as long as any sibling finding used the word "lexical" — reintroducing
 * the stance-blind gap this tightening was meant to close, just one level
 * indirected. Fixed by checking both keyword lists against each finding's
 * own text (`result.findings.some(f => ...)`) via a direct
 * `HarnessAssertionError` throw, so both terms must land in the SAME
 * finding.
 *
 * Verified via the four-verdict offline smoke test below, PLUS a fifth
 * adversarial check added specifically to prove the CodeRabbit fix: the
 * defensive-conclusion distractor finding (no correction terms) alongside
 * a second, unrelated real finding that legitimately uses "lexical BM25" —
 * correctly FAILS post-fix (would have false-passed under the two-call
 * draft). All 3 real post-#787 votes' Finding B wording ("performs lexical
 * BM25 keyword search... not meaning-based") names both the claim and its
 * correction within that one finding, so the fix doesn't cost any recall.
 *
 * FOUR-VERDICT SMOKE TEST (assert-cli.ts, zero LLM spend, 2026-07-16):
 *   1. Perfect verdict (real vote 3 from the post-#787 screen trace, 9
 *      findings incl. both Finding A's substance and Finding B) -> PASS.
 *   2. Empty verdict (no findings) -> FAIL (Tier 1: doc-truth didn't fire).
 *   3. Plausible-but-wrong distractor (reconstructed from this header's own
 *      description above: augment-explore-task.sh:64, doc-truth category,
 *      reaches the defensive "fine, just incomplete" conclusion, no
 *      schema.ts anchor, no correction/mechanism wording) -> FAIL (Tier 2:
 *      no single finding names both the claim and its correction).
 *   4. B-only verdict (real vote 1 from the post-#787 screen trace — 5
 *      findings incl. Finding B, Finding A genuinely absent — the currently
 *      common real shape per PR #792's screen) -> PASS. This is the point of
 *      the re-scope: a vote the OLD assertion rejected now certifies,
 *      because it correctly reflects what doc-truth reliably delivers on
 *      this diff.
 *   5. Adversarial cross-finding check (post-CodeRabbit-fix only): verdict 3's
 *      distractor PLUS a second, unrelated real finding mentioning "lexical
 *      BM25" for a different reason -> FAIL. Confirms the per-finding fix
 *      actually closes the cross-finding leakage, not just the single-
 *      finding case verdict 3 already covered.
 *   Verbatim assert-cli.ts output for all five in the PR body.
 */

import { HarnessAssertionError } from '../../assertions.js';
import type { FixtureAssertions } from '../../assertions.js';

const FINDING_B_CLAIM_KEYWORDS = ['meaning-based', 'meaning based'];
const FINDING_B_CORRECTION_KEYWORDS = [
  'lexical',
  'bm25',
  'no embeddings',
  'not meaning-based',
  'not meaning based',
  'not semantic',
];

const assertions: FixtureAssertions = {
  description:
    'PR #658 b24fa33 — schema.ts embeddings.enabled doc comment falsely claims search_code reports as disabled (stale since #657); CodeRabbit caught it, Lien Review did not (pre-#663/#665)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    // CERTIFIED Tier 2 (owner decision 2026-07-16 — see header "OWNER
    // RE-SCOPE DECISION"): Finding B (augment-explore-task.sh:64) is what
    // this pipeline reliably delivers post-#787; Finding A (schema.ts) is
    // now a tracked characterization expectation documented above, not a
    // pass/fail check. Require a SINGLE finding to name both the claim
    // ("meaning-based") AND its correction/mechanism (lexical/BM25/no
    // embeddings/"not meaning-based") — closing the stance-blind residual
    // the #784 sweep flagged but left unfixed, now required since this is
    // the sole certified Tier-2 signal. Checked per-finding rather than via
    // two separate `expectFindingMentions` calls: those flatten every
    // finding's text into one haystack, so a distractor finding merely
    // mentioning "meaning-based" plus an unrelated sibling finding
    // mentioning "lexical" (near-guaranteed on this all-about-lexical-search
    // rename PR) would false-pass — caught by CodeRabbit on this PR's own
    // review, see PR #794. Together with Tier 1 (doc-truth fired, ruling
    // out empty/degenerate runs), this is what "substantive findings" means
    // for this gate.
    const hasCorrectlyFramedFindingB = result.findings.some(f => {
      const haystack = [f.message, f.suggestion ?? '', f.evidence ?? ''].join('\n').toLowerCase();
      return (
        FINDING_B_CLAIM_KEYWORDS.some(kw => haystack.includes(kw)) &&
        FINDING_B_CORRECTION_KEYWORDS.some(kw => haystack.includes(kw))
      );
    });
    if (!hasCorrectlyFramedFindingB) {
      throw new HarnessAssertionError(
        `Tier 2: expected a single finding to mention both the claim ` +
          `(${FINDING_B_CLAIM_KEYWORDS.map(k => `"${k}"`).join(' or ')}) and its ` +
          `correction/mechanism (${FINDING_B_CORRECTION_KEYWORDS.map(k => `"${k}"`).join(' or ')}) ` +
          `— no single finding satisfied both. Findings: ${result.findings.length}.`,
        2,
      );
    }
    // Finding A (schema.ts `embeddings.enabled` stale claim) — TRACKED
    // CHARACTERIZATION, NON-GATING as of 2026-07-16. See header for the
    // measured rate (best-read 1/3, and that 1 a piggyback, not a
    // dedicated finding) and the doc-truth-v2 follow-up that returns this
    // to the certified gate. The harness has no per-check soft-probe
    // primitive (only the whole-fixture `characterization` tag, which
    // would also un-gate Finding B above) — the honest structure per the
    // owner decision is that this check simply no longer runs; this
    // comment plus the header are the record, not new harness machinery.
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;
