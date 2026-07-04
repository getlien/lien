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
 *   fully retired, not partially. This is exactly the shape the
 *   `stale-duplicate` rule exists to catch: a site the diff touched still
 *   asserts something that no longer tracks reality. Corroborating GitHub
 *   thread: https://github.com/getlien/lien/pull/658#discussion_r3522630327
 *
 * Finding B (documented, NOT asserted — see below):
 *   `plugins/claude/hooks/augment-explore-task.sh:64` described
 *   `search_code` as "REQUIRED for meaning-based discovery" — the tool is
 *   keyword/BM25 search, not meaning-based, so the hook's own guidance
 *   contradicts the tool's real behavior post-#657.
 *   https://github.com/getlien/lien/pull/658#discussion_r3522630331
 *
 *   This finding is intentionally left unasserted because it is currently
 *   IMPOSSIBLE for the agent-review pipeline to reach, not merely
 *   model-dependent — a visibility gap, not a prompt-quality gap. Verified
 *   empirically against this exact fixture via
 *   `npx tsx packages/review/test/harness/build-prompts.ts <fixture>`
 *   (no LLM call — pure prompt assembly):
 *     1. `.sh` is not in any `LanguageDefinition.extensions` in
 *        `packages/parser/src/ast/languages/*.ts`, so the parser never
 *        chunks it: this fixture's `chunks`/`repoChunks` have 0 entries for
 *        `plugins/claude/hooks/augment-explore-task.sh`. Every content-based
 *        tool the rules mandate — `get_files_context`, `list_functions`,
 *        `get_complexity` — has nothing to return for this path, full stop.
 *        (In production, `filterAnalyzableFiles()`,
 *        packages/review/src/analysis.ts, additionally drops the path from
 *        `ctx.changedFiles` entirely before the agent runs, since
 *        `review-pr.ts` passes the *filtered* `filesToAnalyze` as
 *        `changedFiles`. `capture-pr.ts` does not reproduce that filter —
 *        it captures the raw unfiltered file list — so this fixture's
 *        `<changed_files>` block, unlike production's, does still name the
 *        path textually. That's a known fixture/production divergence, not
 *        a reason to expect a different outcome: chunk emptiness is the
 *        operative cause either way.)
 *     2. Even the raw diff text can't compensate: `renderDiff()` in
 *        `packages/review/src/plugins/agent/system-prompt.ts` truncates the
 *        concatenated `<diff>` block at `MAX_DIFF_CHARS` (50,000 chars).
 *        Confirmed by inspecting this fixture's rendered initial message —
 *        the `<diff>` section truncates mid-way through
 *        `packages/cli/src/mcp/server.error-handling.test.ts`, which comes
 *        BEFORE `packages/core/src/config/schema.ts` in diff order, and
 *        well before `augment-explore-task.sh` (the last file in the diff,
 *        starting at ~76KB of this PR's ~77.7KB raw diff). Finding A
 *        survives this same truncation only because `schema.ts` has chunks
 *        (case 1 above) — `get_files_context` on it returns the doc comment
 *        independent of the diff render. Finding B has no such fallback.
 *   Fixing this needs infra work — extending `filterAnalyzableFiles`'s
 *   extension allowlist / adding a lightweight non-AST prose path for
 *   shell/config/doc files — not a `stale-duplicate` prompt tweak. Tracked
 *   here as a documented gap rather than a red assertion so it doesn't get
 *   silently "fixed" by prompt-only iteration that can't actually address
 *   it.
 *
 * Capture command:
 *   npx tsx packages/review/test/harness/capture-pr.ts 658 \
 *     packages/review/test/harness/fixtures/stale-duplicate/pr658-search-code-rename.fixture.json
 *
 * Calibration status: NOT YET RUN. This fixture was captured and validated
 * structurally (fixture-loader round-trip, build-prompts render) only —
 * no OpenRouter/paid run has been made against it. Given the deterministic
 * `<stale_literal_candidates>` pre-scan (packages/review/src/stale-literal-signals.ts)
 * only extracts QUOTED string literals from diff lines
 * (`extractQuotedValues` requires a quote character), and the offending
 * text here is a bare identifier inside a JSDoc-style block comment with
 * no quotes, the pre-scan will NOT surface this candidate — the agent would
 * have to notice the stale claim through general investigation alone, with
 * no deterministic assist. Expect this to need prompt work (or a pre-scan
 * extension to comment-embedded identifiers) before it reliably clears the
 * 9/10 bar; that calibration is a follow-up, human-approved step, not part
 * of this capture.
 */

import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #658 b24fa33 — schema.ts embeddings.enabled doc comment falsely claims search_code reports as disabled (stale since #657); CodeRabbit caught it, Lien Review did not',
  rule: 'stale-duplicate',
  expect: (result, h) => {
    h.expectRuleFired('stale-duplicate', result);
    h.expectFindingMentions(
      [
        // File / symbol anchors
        'schema.ts',
        'embeddings.enabled',
        'embeddings',
        // The specific stale claim and its correction
        'search_code',
        'find_similar',
        'report as disabled',
        'reports as disabled',
        'lexical',
        'bm25',
        'full-text',
        // Vocabulary the model reaches for when describing the drift
        'stale',
        'no longer',
        'disabled when embeddings',
        'does not depend on embeddings',
        "doesn't depend on embeddings",
        '#657',
      ],
      result,
    );
  },
  votes: 3,
  passThreshold: 9,
};

export default assertions;
