import fs from 'fs/promises';
import path from 'path';
import { getIndexDir, isGitRepo, getCurrentBranch, getCurrentCommit } from '@liendev/core';

/**
 * Filename of the SQLite structural store inside the index directory.
 * Mirrors `@liendev/core`'s internal `STRUCTURAL_DB_FILENAME`
 * (`packages/core/src/vectordb/sqlite/schema.ts`), which isn't part of the
 * package's public surface — duplicated here rather than exported solely for
 * this cheap existence check.
 */
const STRUCTURAL_DB_FILENAME = 'structural.db';

/**
 * Cheap, side-effect-free existence check for the structural store: does
 * `<indexDir>/structural.db` exist on disk?
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
 */
export async function hasStructuralIndex(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(getIndexDir(rootDir), STRUCTURAL_DB_FILENAME));
    return true;
  } catch {
    return false;
  }
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
