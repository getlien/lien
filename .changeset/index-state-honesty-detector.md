---
"@liendev/lien": patch
---

Fix three more instances of the fail-quiet defect class (#1029 Workstream 1) and build the detector that stops the class from recurring.

**New instances fixed** (same disposition as #1031/#1034: a confident answer where the honest answer is "I don't know"):

- **`get_complexity` (MCP tool)**: a whole-repo scan (no `files` filter) over a structural store with zero rows reported "0 files analyzed, 0 violations" with no indication the store was empty — indistinguishable from a genuinely clean, fully-indexed codebase. Now adds the same `⚠ Lien: ... no data` note `search_code`/`list_functions` already give.
- **`find_similar` (MCP tool)**: 0 results on an empty structural store got the generic "ensure your snippet is representative" note — the same one a healthy index gives for a real 0-match query. Now escalates to the unmissable no-data note when `hasData()` is false.
- **`lien api-delta`**: an index directory that exists but has zero rows (cleared, moved aside, mid-rebuild) sailed past the existing `hasStructuralIndex` check and reported a real-looking `enriched: true, dependentCount: 0` instead of degrading like a never-indexed project does.
- **`lien annotate`**: `reportUnresolvedPath` (a typo'd/nonexistent path) skipped the `hasStructuralIndex` pre-check the file's other two call sites already have, silently materializing an empty `structural.db` as a side effect on a virgin project.
- **`lien complexity`**: extended to catch S1 (index directory exists, store has 0 rows) as a hard error — previously only S0 (no index at all) was caught.

**The detector**: `packages/cli/utils/index-freshness.ts` (from #1031) gains a `classifyIndexState` function consolidating the S0 (no index) / S1 (empty store) / S2 (stale vs. HEAD) ladder in one place. `packages/cli/test/integration/index-state-matrix.test.ts` is a new table test asserting every read-only, index-backed entry point's actual response against a real `SqliteBackend` (no mocking) across every state that applies to it, with a completeness guard that fails the build if a new `createVectorDB` call site or MCP tool handler isn't accounted for.

Policy documented in CLAUDE.md and `docs/architecture/index-state-honesty.md`: the right response differs by command disposition (gate-shaped commands hard-error on S0/S1; advisory nudges warn loudly but stay exit-0; MCP tools use an explicit `note`/`attributionCaveat`) — never a blanket rule.
