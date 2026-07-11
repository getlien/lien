# Worktree-Aware Indexing

Status: In development (`feat/worktree-aware-indexing`)
Package impact: `@liendev/core` (new backend + build), `@liendev/lien` (wiring)

## Problem

Today, every project root gets its own fully independent index at
`~/.lien/indices/<repoId>` where `repoId = <basename>-<md5(path).slice(8)>`
(`packages/parser/src/utils/repo-id.ts`). A linked git worktree has a distinct
absolute path, so it hashes to a distinct `repoId` and gets a **complete,
independent copy** of the index.

Claude Code agent worktrees make this pathological: ~30 worktrees of one repo
produced a **21 GB** pile of near-identical indexes (the incident that motivated
[PR #651](https://github.com/getlien/lien/pull/651), which blunt-excluded
`.claude/worktrees/**` from being indexed *as a subtree of main*). That exclude
does not help when Lien's root **is** a worktree — the case this feature covers.

The insight: a worktree differs from its main checkout by only a handful of
files. We should index those, and **share** everything else.

## Solution overview

When Lien's root is a **linked git worktree**, share the main checkout's index
as a **read-only base** and store only a small per-worktree **overlay**:

```
~/.lien/indices/<main-repoId>/structural.db      ← BASE  (read-only, owned by main)
~/.lien/indices/<main-repoId>/manifest.json      ← BASE manifest (also required for overlay eligibility)
~/.lien/indices/<worktree-repoId>/structural.db  ← OVERLAY (rows for diverged files)
~/.lien/indices/<worktree-repoId>/overlay.db     ← (see "One overlay DB" below)
```

Reads = overlay rows **UNION** base rows whose file is **not masked**. Writes
(index/watcher) touch the overlay only. The base is never written by a worktree
process.

### Detection

A root is a linked worktree iff:

```
git rev-parse --git-dir  !=  git rev-parse --git-common-dir
```

(verified: in a linked worktree `--git-dir` is `<main>/.git/worktrees/<name>`
while `--git-common-dir` is `<main>/.git`; in the main checkout they're equal).

The **main checkout root** is taken from the first `worktree <path>` line of
`git worktree list --porcelain` — this is authoritative and also correct for
bare-repo topologies (where deriving `dirname(commonDir)` would be wrong). We
additionally require that the resolved main root is **not** the current root and
that it **has a complete index** (both `structural.db` and `manifest.json`
exist — see `resolveIndexStrategy` in `overlay-resolution.ts`). If either fails
we fall back to standalone.

### Escape hatch

`LIEN_WORKTREE_STANDALONE=1` forces today's standalone behavior (a full,
independent index for the worktree). Chosen as an env var (not a config key) for
KISS and to match existing `LIEN_HOME` / `LIEN_FORCE_INDEX` conventions. No
config-schema change.

## Storage & schema

The overlay reuses the **exact `chunks` + `chunks_fts` schema** from
`packages/core/src/vectordb/sqlite/schema.ts` (full chunk rows, same columns,
same external-content FTS5, same `porter unicode61` tokenizer). Diverged and
added files are chunked and inserted exactly as a standalone index would store
them — so all existing row-mapping / FTS / filter code works unchanged on the
overlay side.

Two small extra tables live in the overlay's index directory:

```sql
-- Paths (relative, forward-slash) of BASE files suppressed from base reads.
-- Populated for files that are modified-in-worktree (also present in overlay)
-- and deleted-in-worktree (absent from overlay).
CREATE TABLE IF NOT EXISTS overlay_mask (
  file TEXT PRIMARY KEY
);

-- Single-row metadata: which base build this overlay was diffed against.
CREATE TABLE IF NOT EXISTS overlay_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
-- keys: baseIndexDir, baseStamp (base's .lien-index-version value at build time),
--       baseFormatVersion
```

### One overlay DB vs a separate `overlay.db`

**Decision:** the mask/meta tables live in the **same** SQLite file as the
overlay `chunks` table (`structural.db` inside the worktree's index dir). One
file, one connection, one WAL. A separate `overlay.db` would buy nothing and
add a second handle. The two extra tables are inert in a standalone index, so
sharing the file is safe.

## Deviation from the brief: two connections, not `ATTACH`

The brief specified ATTACHing the base read-only. **We use two independent
better-sqlite3 connections instead** and merge in application code:

- **Base**: opened with `{ readonly: true, fileMustExist: true }`. This is the
  only way to *guarantee* the worktree process cannot mutate the base — SQLite's
  `ATTACH` has no per-database read-only flag, so an attached base would inherit
  the overlay connection's read-write mode, violating "NEVER written by the
  worktree process" and endangering a concurrent `main` serve.
- **Overlay**: opened read-write via the normal `openDatabase()`.

`ATTACH` also would not have simplified FTS: `bm25()` ranks from two separate
external-content FTS5 tables are computed per-corpus and cannot be fused into a
single ranked SQL query anyway — the merge has to happen in application code
regardless. Two connections make that explicit and keep the base immutable.

**Performance:** today's standalone `scanAll` already reads *all* rows into JS
(`SELECT * FROM chunks`). The overlay's base read is no worse; the overlay side
is tiny; masking is a `Set` membership test. So read cost stays at parity with
standalone.

## Read paths (union + mask)

`OverlayBackend implements VectorDBInterface`. For every read it queries the
overlay and the base, drops base results whose `file` is in the mask, and merges:

| Method | Strategy |
|---|---|
| `scanAll` / `scanWithFilter` / `querySymbols` / `scanPaginated` | overlay rows ∪ (base rows where `file ∉ mask`); existing filters/limits applied to the merged set |
| `search` (FTS/BM25) | run `keywordSearch` on each connection independently, mask base hits, merge, re-sort by `score` ascending, trim to `limit` |

Because the overlay contains exactly the diverged/added files and those files
are exactly what's masked from base, a file is served from **one** side only —
no duplication:

| File state in worktree | In overlay? | Masked from base? | Served from |
|---|---|---|---|
| unchanged | no | no | base |
| modified | yes | yes | overlay |
| added (new) | yes | no (not in base) | overlay |
| deleted | no | yes | (nothing) |
| renamed | new path: yes | old path: yes | overlay (new), suppressed (old) |

### FTS caveat (v1)

BM25 scores are corpus-relative. Merging ranked hits from two corpora
(base + overlay) yields an approximate global ordering, not a true one. This is
accepted for v1 and documented here; in practice the overlay is small and top
hits are dominated by exact-symbol boosting, which is corpus-independent.

## Overlay build (hash-diff scan)

State-based, **not** git-history-based (robust to divergence, rebases, dirty
trees). Given `worktreeRoot`, the base index dir, and the overlay backend:

1. Load the **base manifest** (`<baseIndexDir>/manifest.json`) → map
   `relPath → contentHash`. (The manifest is the source of base per-file
   hashes; the `chunks` table does not store hashes.)
2. Scan the worktree (`scanFilesToIndex(worktreeRoot)`) → current relative paths.
3. For each current file, compute `computeContentHash` and compare to base:
   - **not in base** → *added* → chunk + insert into overlay (no mask).
   - **in base, hash differs** → *modified* → mask + chunk + insert into overlay.
   - **in base, hash equal** → *unchanged* → skip (served from base).
4. **deleted** = base-manifest paths ∉ current set → mask (no overlay rows).
5. Stamp `overlay_meta`: `baseIndexDir`, `baseStamp` (base's
   `.lien-index-version`), `baseFormatVersion`.

The overlay keeps its **own** manifest (in the worktree index dir) tracking only
the files it indexed — this drives the overlay's own incremental/watcher path.
The base manifest is read-only input for the diff.

## Incremental / watcher updates (overlay only)

The watcher and `indexMultipleFiles` write to the `OverlayBackend`, which
**reconciles the mask against base** so the union stays correct without the
caller knowing about the base.

**Implementation note (deviation from the first-draft reconcile rule):** the
incremental write path is `deleteByFile(f)` **then** `insertBatch(...)` (see
`incremental.ts` `handleNonEmptyFile`), not a single `updateFile`. So the mask
rule hinges on one cheap fact — *is `f` present in the base manifest?* — with no
per-file re-hashing in the backend:

- `deleteByFile(f)`: drop overlay rows; if `f ∈ base` → mask it. This one rule
  covers both a real deletion (no insert follows) and the delete-old-chunks step
  that precedes an incremental `insertBatch` (the file diverged from base, so it
  must stay masked while its new overlay rows are written).
- `insertBatch(...)`: write overlay rows only (the preceding `deleteByFile`
  already set the mask when needed; added files are never in base, so never
  masked).
- `updateFile(f, …)` (used by `indexSingleFile`): write overlay rows; mask `f`
  when `f ∈ base`.

The first draft proposed *un-masking* a file whose content was reverted to
exactly match base. We drop that: it would require re-hashing every written file
against base, and the win is only reclaiming a redundant overlay copy. Instead,
a revert-to-base leaves a correct-but-redundant overlay copy (the union still
returns the right content because base is masked); the next full overlay
rebuild — which happens whenever the base is reindexed — reclaims it. Simpler,
and correctness is a property of the backend, not of every call site.

## Staleness & revalidation

- **Overlay stamped with base's version.** On serve start (overlay mode) compare
  the base's current `.lien-index-version` to `overlay_meta.baseStamp`.
  - unchanged → overlay is valid; rely on the overlay's own incremental for
    worktree-local edits since last run.
  - **moved** (main was reindexed) → the base hashes the overlay was diffed
    against changed → **rebuild the overlay** (clear overlay rows + mask, re-run
    the hash-diff scan). This is bounded by the worktree file count (hashing) +
    chunking only the still-diverged files — cheap.
- **Base staleness is out of scope.** Keeping the base fresh is main's own
  serve/watcher responsibility.

## Fallbacks (never error)

| Condition | Behavior |
|---|---|
| Not a linked worktree | Standalone (unchanged). |
| `LIEN_WORKTREE_STANDALONE=1` | Standalone (forced). |
| Main checkout has **no index** | Standalone. `serve` emits a one-line hint (run `lien index` in the main checkout to enable shared-base mode); other commands stay silent — `resolveIndexStrategy` is silent by default and callers opt into the hint via `createVectorDB(root, { warn })`. |
| Base `formatVersion` ≠ current | Standalone + (opt-in) warn once (schema mismatch — can't safely read base rows). |
| Base db file missing **mid-serve** | Reads degrade: base connection errors are caught and treated as "base returned nothing"; overlay still serves. Next serve start re-resolves and falls back to standalone cleanly. |
| Main indexed from a **different path string** than git reports (e.g. a symlinked checkout: `/var/...` vs `/private/var/...`) | The base index dir is keyed by `md5(path)` (`extractRepoId`). If the path string the main checkout was indexed under differs from the canonical path `git worktree list` reports, the base-dir hash misses and we fall back to standalone (safe, no error). Normal for repos under a real (non-symlinked) path; a known limitation otherwise, inherited from `extractRepoId`. |

## Edge cases

- **File added / deleted / renamed in worktree** — covered by the build table
  and the reconcile rules above.
- **Overlay invalidation on base reindex** — base-stamp compare on serve start
  triggers a rebuild.
- **Base db file missing mid-serve** — graceful degrade; base read errors are
  swallowed to `[]`. Full re-resolution on next start.
- **Two worktree serves reading the same base concurrently** — both open the
  base `{ readonly: true }`; WAL mode + `busy_timeout` already configured in
  `openDatabase`; read-only handles don't contend for the write lock. Safe.
- **Base opened while main is mid-write** — WAL readers see the last committed
  snapshot; no torn reads.

## Wiring

- `createVectorDB(projectRoot)` (`vectordb/factory.ts`) is the seam: it resolves
  worktree mode and returns an `OverlayBackend` (composing base reader +
  overlay `SqliteBackend`) or a plain `SqliteBackend`. All read call sites become
  overlay-aware for free.
- `VectorDBInterface.dbPath` for an overlay is the **worktree** index dir, so
  `ManifestManager` and `GitStateTracker` operate on the worktree's own state.
- `hasData()` returns true if base **or** overlay has data — so the serve
  auto-index gate does not full-index a worktree.
- Because `hasData()` is true in overlay mode, the serve/index path must
  **explicitly** build/refresh the overlay. `indexCodebase` detects overlay mode
  (typed discriminator on the backend) and routes to the overlay build instead
  of `performFullIndex`; the MCP server's auto-index step triggers an overlay
  refresh regardless of `hasData()`.

## Non-goals (YAGNI)

- No cross-worktree dedup beyond base+overlay (no global content-addressed store).
- No writing to / refreshing the base from a worktree.
- No merging BM25 corpora into a single statistically-correct ranking.

## Test plan

- **Detection + path resolution** (unit): linked-worktree vs main vs non-git;
  escape hatch; main-has-no-index fallback; bare-repo fallback.
- **Overlay build** (unit): added / modified / unchanged / deleted classification
  → correct overlay rows + mask; base stamp recorded.
- **Read union** (unit): mask correctness (modified file served from overlay not
  base; deleted file served from neither; unchanged from base); FTS merge.
- **Reconcile** (unit): edit→diverge→mask, revert→un-mask, delete→mask.
- **Integration**: fixture repo + real `git worktree add`; assert shared-base
  reads (unchanged files resolve from base) and overlay divergence (edited file
  returns worktree content, not base content).

## Verified (2026-07-04)

Independent adversarial verification against the built CLI (`packages/cli/dist/index.js`)
and MCP over stdio, using scratch `git worktree add` repos plus the real lien
repo's own worktree/base pair. All scenarios below passed:

- Happy path: modified/added/deleted/unchanged/renamed files each resolve
  correctly through `get_files_context` over a real MCP stdio round-trip.
- Churn + revert-to-base: re-diffing after further edits correctly reclassifies
  a reverted file back to "shared with base" with no stale or duplicate content.
- Fallbacks: main-has-no-index → standalone + hint; `LIEN_WORKTREE_STANDALONE=1`
  → forced standalone; base db deleted mid-serve → graceful degrade, no crash.
- Concurrency: two worktree serves reading while the base was force-reindexed
  five times in a loop — no `SQLITE_BUSY`, no crashes, correct isolated reads.
- Real repo: `lien-e96f171e` (base, ~420 files) vs this feature's own
  development worktree — overlay correctly held only the ~23 files that
  actually diverged.

**Bug found and fixed**: `OverlayBackend.clear()` used an in-place
`DELETE FROM chunks` (and mask/meta tables), which leaves freed pages in
SQLite's freelist instead of shrinking the file. Since `buildOverlay` calls
`clear()` at the start of every rebuild, an overlay that once held many
diverged files — e.g. this exact worktree, which had been used standalone
during Phase 1 development — kept that high-water-mark file size forever even
after shrinking back down to a handful of live rows. On the real repo this
made the "small" overlay 11 MB, nearly the size of the 11.5 MB base, defeating
the feature's point.

The first fix attempt mirrored `SqliteBackend.clear()`'s existing pattern
(close the handle, delete the db + WAL/SHM files, reopen fresh), which did
shrink the file (11 MB → 1.0 MB) but turned out to be unsafe: it swaps the
overlay file's identity out from under any other process that has it open, and
a 20–30-way concurrent `lien index` stress test on one worktree reproduced
real `disk I/O error` / "Failed to initialize overlay database" failures in
roughly half the runs. The same stress test against the original DELETE-only
code, and against `SqliteBackend`'s own close+delete+recreate path on a
*standalone* index, produced zero failures — so the hazard is specific to
swapping the overlay's file identity while multiple processes hold it open
concurrently. The shipped fix instead does `DELETE` + `VACUUM` + a WAL
checkpoint: same file identity throughout, same disk-space reclamation
(confirmed 1.1 MB on the real repo), and zero failures across repeated 20- and
30-way concurrent runs. See `packages/core/src/vectordb/overlay-backend.ts`
and its disk-space regression test.

See PR #667's "Verification findings" section for the full scenario matrix,
including one documented-but-not-fixed edge case (transient state mixing when
toggling the `LIEN_WORKTREE_STANDALONE=1` escape hatch on and off for the same
worktree, which self-heals on the next normal-mode `lien index`/`lien serve`).

## Concurrency hardening (2026-07-04)

PR #667 shipped `buildOverlay` as: `clear()` (DELETE + VACUUM + checkpoint) →
scan → hash → `maskBasePath` for deletions → `indexMultipleFiles` (per-file
`deleteByFile` then `insertBatch`) → `recordBaseBuild` (which always bumped the
version stamp). Lien Review flagged the rebuild window on #667; it was
documented but not fixed. Live dogfooding then reproduced it: in a worktree
serve, `list_functions` / `querySymbols` intermittently returned **0 results**
for a class that exists, for minutes. Single-transaction snapshots of the
overlay db repeatedly caught `overlay_mask` containing the diverged file while
`chunks` held **zero rows** for it — the file suppressed from base with no
replacement, invisible to every read path — with the overlay's `indexVersion`
churning (multiple bumps in minutes with **zero file edits**) while more than
one serve process had the worktree as cwd.

Two composing root causes, both now fixed:

### 1. Non-atomic rebuild → reader could see mask-without-replacement

The old rebuild mutated the mask and chunks across many autocommitted
statements spread over async ticks. Between `clear()` and the final
`insertBatch`, an **added** file had no overlay rows and no base fallback for
the entire scan/chunk phase; between a **modified** file's `deleteByFile` (which
sets the mask) and its `insertBatch`, the file was masked with no rows. A
concurrent reader on another connection (another serve) observed those states.

**Fix (reader-atomic swap).** All async work (scan, hash, chunk) now happens in
`buildOverlay` *before* any write, producing in-memory chunk batches + the mask
set. `OverlayBackend.applyRebuild` then applies the **entire swap** — delete old
chunks + mask, insert new chunks + mask, update meta — in **one
`BEGIN IMMEDIATE` transaction**. WAL snapshot isolation means another connection
sees the complete old overlay or the complete new one, never a half-applied
state. `buildOverlay` no longer calls `clear()`; the transaction's `DELETE`
reclaims logically and a **post-commit** `VACUUM` + `wal_checkpoint(TRUNCATE)`
(VACUUM cannot run inside a transaction) reclaim on disk — **same file identity
throughout**, preserving #667's multi-process safety fix (close+delete+recreate
stays banned).

The reader side is snapshotted too: overlay reads pair a chunk scan with a mask
read, so each union read (`unionRecords`, `search`, `scanPaginated`) now runs
both statements inside **one deferred read transaction**, pinning a single WAL
snapshot. Without this, an atomic writer commit landing *between* the reader's
two statements would still be observed half-applied.

**Accepted limitation: the base read is a separate snapshot.** A union read is
overlay-rows + mask from one overlay snapshot `S`, merged with base rows read
afterwards on the base connection (a *different database file*). SQLite
transactions are per-connection, so no code structure can extend `S` across the
base — true cross-database snapshot atomicity is impossible in the
two-connection design (and `ATTACH` was rejected above to keep the base
provably read-only). This window is accepted, not mitigated, because it cannot
produce the mask-without-replacement bug or duplicates:

- Base hits are filtered against the mask from the **same** snapshot `S` as the
  overlay hits. Per `S`'s build invariant, any file with overlay rows that also
  exists in base is masked in `S` — so its base row is dropped no matter when
  the base read runs, including across a concurrent `applyRebuild` commit.
  A rebuild un-masking a file (revert-to-base) also removes its overlay rows in
  the same transaction, so a reader on `S` serves the old overlay row and drops
  the base row (consistent old state); a reader on the new snapshot drops the
  overlay row and serves the base row (consistent new state). No interleaving
  yields both.
- The only residual effect is that base rows may come from a base commit that
  landed mid-query: the result is overlay@`S` ∪ base@now, each side internally
  consistent, per-file single-source preserved. But a mid-serve base write
  already implies the overlay is stale-until-rebuild *regardless of intra-query
  timing* (see "Staleness & revalidation" — the base-stamp compare triggers the
  reconciling rebuild). A retry-on-base-stamp-change would re-run the query into
  the same stale-until-rebuild state, buying nothing for two extra fs reads per
  query. Cross-corpus BM25 ranking is likewise already approximate by design
  (see "FTS caveat (v1)").

### 2. Rebuild livelock → identical rebuilds churned the version stamp

`recordBaseBuild` bumped `.lien-index-version` on **every** rebuild. The only
overlay-rebuild trigger is each serve's **startup** `handleAutoIndexing`
(tool handlers and the version/git polls only *reconnect*, never rebuild) — but
multiple serves per root is a known operational reality (they pile up, three
install paths). Every startup rebuild bumped the stamp; every bump made **all
other** serves' version poll reconnect; restart/re-spawn churn kept new serves
rebuilding — a self-amplifying reconnect/rebuild storm with no file edits.

**Fix (no-op → no bump).** `buildOverlay` computes a cheap **content
signature** — a hash over an indexing-format salt (`INDEX_FORMAT_VERSION` +
chunk size/overlap, so a Lien upgrade that changes the chunking contract forces
one real rebuild instead of skipping forever) plus the sorted (diverged file →
content hash) pairs plus the sorted mask set, reusing hashes already computed
during the diff. If it
matches the signature stored at the last build, the rebuild is a no-op: it
refreshes only the base stamp (so `needsRebuild()` still settles after a base
reindex) and returns `changed: false` **without bumping**. So once any serve has
built the overlay, further startups on an unchanged worktree are silent — the
storm cannot form. A genuine content change still bumps, so real edits
propagate. `applyRebuild` re-checks the signature **inside** its `IMMEDIATE`
transaction, so even under a true race the swap is serialized and only the first
writer bumps; a peer that already applied the identical overlay makes this a
no-op.

### Cross-process single-rebuilder guard: what we chose

The brief asked to *consider* a dedicated single-rebuilder advisory lock (e.g.
`BEGIN IMMEDIATE` held for the whole build with busy-skip, "its result serves
both"). We chose **not** to hold a long-lived lock, and instead rely on:

- the **in-transaction signature test-and-set** under `BEGIN IMMEDIATE`, which
  already guarantees a single effective rebuild (one bump, silent no-ops) across
  any number of concurrent writers, and
- a lightweight **busy-skip**: if a peer holds the overlay's write lock past the
  busy timeout, `applyRebuild` catches `SQLITE_BUSY` and returns
  `changed: false` — the peer's atomic swap serves everyone.

Rejected: a held advisory lock (or a lease row with a staleness timeout) would
have to span the async chunking phase, blocking the watcher's incremental
writes for the whole build, and needs fragile cross-async transaction handling
plus stale-lock/lease heuristics and their own tests. Its only remaining benefit
over the chosen design is de-duplicating concurrent *chunking CPU* — negligible,
because the overlay only covers the handful of diverged files and the build is
already cheap (KISS/YAGNI). Multiple serves are therefore **tolerated** (atomic,
single-bump, busy-skip), not assumed away.

### Verified

- **Reproduction-first stress test** (`overlay-concurrency.test.ts`): two
  `OverlayBackend` connections on one overlay db — a writer rebuilding in a loop
  while a reader polls `querySymbols` for diverged files. Against origin/main it
  **fails** (the reader observes an added file missing many times; the no-op
  tests fail because every rebuild bumped); with the fix all four pass. A second
  case toggles a file between two bodies each iteration so every rebuild is a
  genuine atomic swap, exercising the reader-snapshot path.
- No-op-doesn't-bump and two-writers-don't-re-trigger (but a real change still
  bumps) are asserted directly against the version stamp.
- Full suite green: parser 963, core 322, review 565, cli 757, action 28.

See `packages/core/src/vectordb/overlay-backend.ts` (`applyRebuild`,
`overlaySnapshot`, `refreshBaseStamp`), `packages/core/src/indexer/overlay-index.ts`
(`buildOverlay`, `computeOverlaySignature`), and
`packages/core/src/vectordb/overlay-concurrency.test.ts`.
