---
"@liendev/lien": patch
---

Fix `lien complexity` reporting a false clean (exit 0, "no violations found") on a project that has never been indexed, and silently materializing an empty `structural.db` as a side effect — the worst possible gate failure mode, since `--fail-on error` is meant to be a CI gate.

Root cause: `complexityCommand()` called `createVectorDB(rootDir).initialize()` before checking whether an index existed. `SqliteBackend.initialize()` unconditionally `mkdir`s the index directory and opens the database with `CREATE TABLE IF NOT EXISTS` (`schema.ts`'s `openDatabase`), which materializes a valid, empty store even for a project that was never indexed — and the existing `ensureIndexExists` check only caught a thrown exception, never an empty-but-valid result, so it never fired. The created store then made a subsequent `lien status` wrongly report the project as indexed.

`lien api-delta` had already solved exactly this with a cheap, side-effect-free existence check (`hasStructuralIndex`, a plain `fs.access` on `structural.db`) run BEFORE ever calling `createVectorDB`. This consolidates that pattern into a shared `packages/cli/src/utils/index-freshness.ts` and applies it at every read-only call site that had the same bug:

- `lien complexity` now checks `hasStructuralIndex` first and, on a missing index, prints the existing "Index not found" error and exits 1 — unconditionally, independent of `--fail-on` — without ever touching the database file.
- `lien annotate` (both its full-annotation path and its `--tests-only`/`lookupTestAssociations` path, also used by `lien verify-tests note-edit`) had the identical bug: `createVectorDB(rootDir).initialize()` ran before the `hasData()` check that prints its own "no index found" warning, so a single `Read` or `Edit` in an unindexed repo silently created `structural.db` too. Since several of this plugin's own hooks (`augment-explore-task.sh`, `test-reminder.sh`) gate on "does `structural.db` exist on disk?" as their sole signal for "is this repo indexed?", that one side effect permanently flipped those hooks' gate open for the rest of the session, making them act on an empty index. Fixed the same way: check existence before ever calling `createVectorDB`.
- `lien api-delta` now imports the shared `hasStructuralIndex` instead of keeping its own copy.

Also added: `lien complexity` now warns (via `getIndexStalenessWarning`, reusing `lien status`'s existing "git state changed" detection against `.git-state.json`) when the on-disk index's recorded git state no longer matches the working tree, instead of silently serving stale results with no signal at all. `lien serve`'s auto-reindex machinery (`git-detection.ts`) doesn't run for this one-shot command, so this is a warning, not an auto-reindex — `lien status`'s own staleness check (`status.ts`) was refactored to share the same read (`readIndexGitState`) rather than re-deriving it a third time.

A genuinely clean, up-to-date, indexed project is unaffected: `lien complexity` still reports "no violations found" at exit 0, and `lien index` still creates the store on a virgin directory exactly as before — only read-only commands that have no business creating index state were changed.
