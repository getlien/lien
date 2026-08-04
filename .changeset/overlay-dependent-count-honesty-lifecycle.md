---
'@liendev/core': patch
'@liendev/lien': patch
---

fix: the `dependentCount` honesty note no longer fires on a worktree that has counts, and the remedy it prints now works (#1085, #1084)

Two halves of the same lifecycle defect in #1072's honesty plumbing.

**#1085 — a self-contradictory response.** In a linked worktree,
`OverlayBackend.hasDependentCounts()` read only the worktree's OWN overlay flag,
which is absent until that worktree has completed its own `lien index`. So a
fresh worktree whose shared base had counts fully computed emitted "this index
predates reverse-dependency counting" and dropped `dependentCount` from 100% of
`search_code` results — while the base's counts were ranking the very results the
note was attached to. Measured on MediatR: `Mediator.cs` at #1 with the boost on
and #5 with `LIEN_STRUCTURAL_RANKING=off`, in the same worktree, with every count
reported as omitted.

That is the #1050/#1051 shape — asking one of two on-disk locations instead of the
composition — and #1014's cost, since every agent session in a linked worktree got
the note on its first search. The method now mirrors the two branches of
`composedDependentCounts` exactly: the composed flag when set, and otherwise
whatever the BASE store can prove about its own table, which is the store the read
path is serving those numbers from. Not the row-count-of-the-merged-map reasoning
review rejected on #1078 — that map is a merge and proves nothing; this asks the
base store whether it computed counts over its own corpus. A resurrected stale
count is real but it is staleness, deliberately uncaveated per #1072's case 4, and
suppressing every count never fixed it — it only also lied about why.

**#1084 — the note prescribed a remedy that did nothing.** The note says
`Run "lien index" to populate them`, and the code comment claimed it "clears itself
permanently after one index run". Neither was true on the upgrade path that
produces the note: `lien index` found no content changes, printed "Index is up to
date", and returned without writing the counts or the flag. Touching a file did not
help either. Only `lien index --force` worked. Computing the counts is now a
MIGRATION-completion step gated on `hasDependentCounts()`, so the next `lien index`
after an upgrade completes it whether or not anything changed, and every run after
that skips it on one meta lookup. #1071's freshness contract is unchanged: normal
incremental editing still does not recompute whole-corpus counts, so counts still
lag by at most one full index run. The version stamp is bumped only when a backfill
actually ran, so a live `lien serve` reconnects rather than clearing the note while
still serving an empty cached count map.

`OverlayBackend` gains a public `backfillDependentCounts()` for the same migration
over the composed `(base − masked) ∪ overlay` corpus, because `buildOverlay`
returns before `applyRebuild` entirely when the overlay's signature already
matches — so an overlay that had never composed counts previously had no path to
them.

`hasComputedDependentCounts` now tolerates either of its tables being absent, each
clause independently: a base index written by 0.75.4 has real `dependent_counts`
rows and no `store_meta` table at all, and the base connection is read-only so
nothing creates it.

The note still fires, unchanged, for a store that genuinely never computed
counts — including a worktree whose base never did either. That property is
covered by explicit negative controls in
`packages/cli/test/integration/index-state-matrix.test.ts`, which gains the
crossing of its worktree and derived-data axes: the row whose absence is why this
shipped.
