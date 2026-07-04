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
that it **has an index** (`structural.db` exists). If either fails we fall back
to standalone.

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
| Main checkout has **no index** | Standalone + one-line hint: run `lien index` in the main checkout to enable shared-base mode. |
| Base `formatVersion` ≠ current | Standalone + warn once (schema mismatch — can't safely read base rows). |
| Base db file missing **mid-serve** | Reads degrade: base connection errors are caught and treated as "base returned nothing"; overlay still serves. Next serve start re-resolves and falls back to standalone cleanly. |

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
