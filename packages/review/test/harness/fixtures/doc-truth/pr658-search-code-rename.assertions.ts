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
 * Finding A (asserted below, Tier 1 + Tier 2):
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
 * Finding B (asserted below, Tier 2 — promoted 2026-07-04, see below):
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
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #658 b24fa33 — schema.ts embeddings.enabled doc comment falsely claims search_code reports as disabled (stale since #657); CodeRabbit caught it, Lien Review did not (pre-#663/#665)',
  rule: 'doc-truth',
  expect: (result, h) => {
    h.expectRuleFired('doc-truth', result);
    // Kept to the specific file anchor and compound phrases naming the
    // EXACT false claim ("reports as disabled") or its correction — not bare
    // 'embeddings' / 'search_code' / 'find_similar' / 'lexical' / 'bm25' /
    // 'full-text' / 'stale' / 'no longer', each of which is central
    // vocabulary for this entire 40-file rename PR and would be satisfied by
    // an unrelated finding merely discussing the same rename theme (verified
    // via assert-cli.ts: a distractor about augment-explore-task.sh's
    // "meaning-based" line — reaching the WRONG, defensive conclusion that
    // the guidance is fine — false-passed the original list purely via
    // 'search_code'; it has no 'schema.ts'/'embeddings.enabled' anchor and
    // correctly fails against this one).
    h.expectFindingMentions(
      [
        'schema.ts',
        'embeddings.enabled',
        'report as disabled',
        'reports as disabled',
        'disabled when embeddings',
        'does not depend on embeddings',
        "doesn't depend on embeddings",
      ],
      result,
    );
    // Finding B — plugins/claude/hooks/augment-explore-task.sh:64 calling
    // search_code "meaning-based" when it's lexical BM25. Promoted from
    // documented-but-unasserted on 2026-07-04: build-prompts.ts confirmed the
    // guidance_surface_changes passthrough (#665) now carries this hunk into
    // the prompt, and 9/10 votes in the promotion calibrate-10 independently
    // reproduced the claim, all quoting "meaning-based" verbatim. See the
    // header comment's "Finding B" section for the full evidence chain.
    h.expectFindingMentions(['meaning-based', 'meaning based'], result);
  },
  votes: 3,
  passThreshold: 9,
  tags: ['canary'],
};

export default assertions;
