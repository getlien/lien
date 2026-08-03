import fs from 'fs/promises';
import path from 'path';
import type { VectorDBInterface } from '@liendev/core';
import {
  getIndexDir,
  isGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  resolveIndexStrategy,
} from '@liendev/core';

/**
 * Filename of the SQLite structural store inside the index directory.
 * Mirrors `@liendev/core`'s internal `STRUCTURAL_DB_FILENAME`
 * (`packages/core/src/vectordb/sqlite/schema.ts`), which isn't part of the
 * package's public surface — duplicated here rather than exported solely for
 * this cheap existence check.
 */
const STRUCTURAL_DB_FILENAME = 'structural.db';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap, side-effect-free existence check for the structural store: does
 * `<indexDir>/structural.db` exist on disk — either `rootDir`'s own (the
 * standalone case), or, for a linked git worktree in overlay mode, the
 * shared base's?
 *
 * Every read-only CLI command that needs to tell "this project has never
 * been indexed" apart from "the index is just empty" MUST call this BEFORE
 * `createVectorDB(rootDir).initialize()` — that call unconditionally
 * `mkdir`s the index directory and opens the database with
 * `CREATE TABLE IF NOT EXISTS` (see `schema.ts`'s `openDatabase`), which
 * silently materializes a valid, empty store where none existed. For a
 * read-only command that has no business creating index state, that side
 * effect is actively harmful: it makes a later `lien status` claim the
 * project is indexed, and (for a gate-shaped command like
 * `lien complexity --fail-on error`) it turns "I have no data" into a false
 * "no violations found" success.
 *
 * This consolidates what used to be `lien api-delta`'s own local
 * `hasStructuralIndex` — the same guard, reused rather than re-invented at
 * every new read-only call site (`lien complexity`, `lien annotate`).
 *
 * #1051 fix: this used to check ONLY `getIndexDir(rootDir)` — for a linked
 * worktree that's `OverlayBackend.dbPath`, the worktree's own *local* overlay
 * database, which doesn't exist until the worktree completes at least one
 * local `lien index`/overlay build. A fresh worktree that has never run
 * `lien index` locally therefore reported S0 ("never indexed") even though
 * the *shared base* index — what `OverlayBackend` actually reads from, per
 * `docs/architecture/worktree-aware-indexing.md` — was fully populated. The
 * local check runs first (cheapest, and correct for both the common
 * standalone case and a worktree that has already self-healed); only when it
 * misses do we ask `resolveIndexStrategy` whether `rootDir` is a worktree in
 * overlay mode and, if so, check the base's `structural.db` instead. This
 * mirrors `findUnindexedPaths`'s #1014 fix (reading the merged base+overlay
 * view instead of the overlay manifest alone) one layer up, at the
 * whole-index existence check rather than the per-path one.
 */
export async function hasStructuralIndex(rootDir: string): Promise<boolean> {
  if (await fileExists(path.join(getIndexDir(rootDir), STRUCTURAL_DB_FILENAME))) {
    return true;
  }

  const strategy = await resolveIndexStrategy(rootDir);
  if (strategy.mode !== 'overlay') return false;

  return fileExists(path.join(strategy.baseIndexDir, STRUCTURAL_DB_FILENAME));
}

interface StoredGitState {
  branch: string;
  commit: string;
}

/**
 * Read the git state (branch/commit) recorded at the index's last
 * `lien index` or `lien serve` reindex — written by `GitStateTracker` to
 * `<indexDir>/.git-state.json`. Returns null when the file doesn't exist or
 * doesn't parse (no index yet, or an index built before git tracking ran).
 * Never throws.
 *
 * Single source of truth for reading this file — `lien status`'s
 * `printGitStatus` and `getIndexStalenessWarning` below both go through this
 * rather than each re-deriving their own read of the same on-disk state.
 */
export async function readIndexGitState(indexDir: string): Promise<StoredGitState | null> {
  try {
    const content = await fs.readFile(path.join(indexDir, '.git-state.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * One-line warning when the on-disk index's recorded git state no longer
 * matches the working tree's current branch/commit — i.e. the same
 * "⚠️ Git state changed" condition `lien status` already detects
 * (`status.ts`'s `printGitStatus`), factored out so a one-shot read-only
 * command (like `lien complexity`, which has no auto-reindex machinery of
 * its own — that lives only in `lien serve`'s `git-detection.ts`) can warn
 * instead of silently serving stale results.
 *
 * Returns null (no warning) when: not a git repo, the index has no recorded
 * git state (never indexed, or indexed before git tracking existed), or
 * nothing has changed. Never throws — failing to determine staleness must
 * not block the command's real work.
 */
export async function getIndexStalenessWarning(rootDir: string): Promise<string | null> {
  try {
    if (!(await isGitRepo(rootDir))) return null;

    const stored = await readIndexGitState(getIndexDir(rootDir));
    if (!stored) return null;

    const [branch, commit] = await Promise.all([
      getCurrentBranch(rootDir),
      getCurrentCommit(rootDir),
    ]);
    if (stored.branch === branch && stored.commit === commit) return null;

    return (
      'Warning: the index looks stale — git state has changed since the last `lien index` ' +
      '(or `lien serve` reindex). Results may not reflect the current working tree. ' +
      'Run `lien index` to refresh.'
    );
  } catch {
    return null;
  }
}

/**
 * The whole-index states a read-only, index-backed command can find itself
 * in (see #1029 W1 — this is the shared classifier that replaces every call
 * site re-deriving its own version of this ladder):
 *
 * - `S0` — no index directory at all (never indexed).
 * - `S1` — the index directory exists, but the structural store has zero
 *   rows (cleared, moved aside, or indexed against an all-ignored tree).
 * - `S2` — the store has data, but it's stale vs the working tree's current
 *   git HEAD (the one-shot CLI path has no auto-reindex machinery — that
 *   only lives in `lien serve`'s `git-detection.ts` — so this is the only
 *   place staleness gets caught).
 * - `ok` — none of the above; safe to answer normally.
 *
 * Deliberately NOT covering "the requested path isn't in the index" (S3 in
 * the issue's vocabulary) — that's a per-path question, answered by
 * `findUnindexedPaths` (`../mcp/utils/unindexed-paths.js`) against a
 * specific filepath, not a whole-index state this classifier can decide in
 * isolation. Nor does it cover "the analysis mechanism structurally cannot
 * see an answer" (Java same-package, Ruby class names, type symbols) — that
 * is #1026's `attributionCaveat` vocabulary (`get_dependents`'s
 * `AttributionCaveatReason`), a different axis entirely: this classifier is
 * about the INDEX's state, not about a language's import-graph visibility.
 */
export type IndexState = 'S0' | 'S1' | 'S2' | 'ok';

export interface IndexStateResult {
  state: IndexState;
  /** Populated only for `S2` — the human-readable staleness warning. */
  warning?: string;
  /**
   * The opened, initialized `VectorDBInterface` — present for every state
   * except `S0`, where it is deliberately never constructed at all (see
   * `hasStructuralIndex`'s doc comment: `createVectorDB(rootDir).initialize()`
   * itself materializes an empty store as a side effect, which is exactly
   * the bug this classifier exists to prevent).
   */
  vectorDB?: VectorDBInterface;
}

/**
 * Classify `rootDir`'s whole-index state in one call, composing the three
 * checks above in the only safe order: the cheap on-disk existence check
 * FIRST (so an `S0` project is never opened at all), then — only once that
 * has ruled out S0 — open the store and check `hasData()` for `S1`, then
 * the git-state comparison for `S2`.
 *
 * `openVectorDB` is a thunk (not a plain `VectorDBInterface`) specifically
 * so this function — not each call site — owns the decision of whether to
 * ever invoke `createVectorDB(...).initialize()` at all. Callers that
 * already need an initialized `vectorDB` for their real work get it back on
 * the result (`ok`/`S1`/`S2`) rather than opening it a second time; callers
 * that only need the verdict can ignore the field.
 *
 * This is the single place new read-only, index-backed commands should call
 * into — see CLAUDE.md's "Index-state honesty" policy and
 * `docs/architecture/index-state-honesty.md`.
 */
export async function classifyIndexState(
  rootDir: string,
  openVectorDB: () => Promise<VectorDBInterface>,
): Promise<IndexStateResult> {
  if (!(await hasStructuralIndex(rootDir))) {
    return { state: 'S0' };
  }

  const vectorDB = await openVectorDB();

  if (!(await vectorDB.hasData())) {
    return { state: 'S1', vectorDB };
  }

  const warning = await getIndexStalenessWarning(rootDir);
  if (warning) {
    return { state: 'S2', warning, vectorDB };
  }

  return { state: 'ok', vectorDB };
}
