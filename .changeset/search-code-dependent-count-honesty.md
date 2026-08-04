---
'@liendev/core': patch
'@liendev/lien': patch
---

fix(cli,core): stop `search_code` asserting `dependentCount` as fact (#1072)

`search_code` published `metadata.dependentCount` on every result with no
honesty machinery on any branch — no `attributionCaveat`, no `note`, no degraded
marker — while `get_dependents` carried the full vocabulary for the same number.
Four different situations rendered as the same bare `0`, and a consumer could not
tell them apart.

Each now gets the disposition it warrants, and only that:

- **Genuinely nothing imports this file.** Unchanged: `dependentCount: 0`, no
  note, no marker. This is a real answer and #1014's cost was a caveat that
  fired on healthy sessions until it was trained out as noise. There is an
  explicit negative-control test for it.
- **The language's import forms cannot name the file at all** (C#'s
  `global using` / namespace access, Java's and Kotlin's same-package
  visibility, Swift's whole-module `import Foundation`). The field is now
  **omitted** for that result, silently — an absent count is honest, a `0` is
  not. Gated on the existing `hasDependentAttributionBlindSpot` predicate in
  conjunction with a zero count, exactly as `get_dependents`'
  `dependent-attribution-incomplete` caveat is. A *positive* count in those
  languages is kept: it is a real recovered floor.
- **The counts were never computed for this store** (an index written before the
  `dependent_counts` table existed, where every count reads `0` for a reason
  that has nothing to do with the code). One response-level `note` naming
  `lien index`, plus omission on every result. One note per call, never one per
  result.
- **The counts lag the working tree** by up to one full index run. Deliberately
  **no** response caveat: it is true on nearly every call and is an accepted
  trade for a soft ranking tie-breaker. Documented in `search_code`'s tool
  description and on `SearchResult` instead.

No new confidence vocabulary: `AttributionCaveatReason`'s five reasons all
describe a caller-supplied `filepath`, which neither of the two reported cases
is, so this uses the tool's existing response-level `note` channel (#1018 tracks
consolidating the three vocabularies that already exist).

Core adds `VectorDBInterface.hasDependentCounts()`, backed by a new
`store_meta` marker row written alongside the counts themselves. Presence of the
marker — never the table being non-empty — is what makes a `0` trustworthy: a
corpus whose counts are legitimately all zero is byte-identical to one where
they were never computed, so the distinction has to come from stored state
rather than from the shape of the result. Same reasoning, and same
presence-not-emptiness rule, as `OVERLAY_META.DEPENDENT_COUNTS_COMPOSED`. The
table is additive with `CREATE TABLE IF NOT EXISTS`, so no
`INDEX_FORMAT_VERSION` bump and no forced reindex; an older index simply reports
the new note until its next `lien index`.

`SqliteBackend` accepts row presence as secondary proof (rows can only have been
written over that store's own corpus). `OverlayBackend` deliberately does not:
without the composed flag its read falls back to merging the base's counts, and
that merge can resurrect an obsolete positive value for a file whose last
importer this worktree masked, so row presence there is not evidence the numbers
describe this corpus.

Also exports a `simulatePreCountTrackingIndex` test helper from
`@liendev/core/test`, so the never-computed state is reachable from
`packages/cli`'s index-state matrix without that package taking a
`better-sqlite3` dependency.
