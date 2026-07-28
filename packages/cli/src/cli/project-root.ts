import fs from 'fs';
import path from 'path';
import { getIndexDir } from '@liendev/parser';
import { VERSION_FILE } from '@liendev/core';
import { type AbsolutePath, toAbsolutePath } from '../types/paths.js';

/**
 * Walk upward from `start` (inclusive) looking for a directory that satisfies
 * `predicate`. Returns the first match, or `null` if none is found by the
 * time the filesystem root is reached.
 */
function walkUp(start: string, predicate: (dir: string) => boolean): string | null {
  let dir = start;
  const fsRoot = path.parse(dir).root;
  // Loop is inclusive of fsRoot — a repo rooted at / (or a drive root) is
  // rare but valid, and should still be detected before giving up.
  while (true) {
    if (predicate(dir)) return dir;
    if (dir === fsRoot) return null;
    dir = path.dirname(dir);
  }
}

/**
 * Has `dir` ever completed a real `lien index` (or worktree-overlay) build?
 * Checks for `VERSION_FILE` inside `dir`'s own index directory (keyed by
 * `dir`'s absolute path — see `getIndexDir`), which both backends write ONLY
 * after a build actually completes (`writeVersionFile` — see
 * `SqliteBackend`/`OverlayBackend`), never as a side effect of merely opening
 * a store. That distinction matters: opening a store for a bare `initialize()`
 * DOES `mkdir` the index directory, so a plain "does the directory exist"
 * check would go stale the first time *anything* — even a misresolved
 * `annotate` run — opens a store there.
 *
 * Checking `.lien.config.json` presence instead (or in addition) was tried
 * and dropped: this very repo carries a checked-in, vestigial
 * `packages/cli/.lien.config.json` (pre-monorepo history, PR #42) that isn't
 * an active project root — running `lien annotate` from inside `packages/cli`
 * would have hijacked resolution to that subdirectory. A completed index is
 * ground truth ("did `lien index` actually run here") in a way a config file
 * is not.
 */
function hasCompletedIndex(dir: string): boolean {
  return fs.existsSync(path.join(getIndexDir(dir), VERSION_FILE));
}

function hasGitMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Resolve the project root for `start`. Two-pass, nearest match wins each
 * pass:
 *
 * 1. Nearest ancestor (inclusive) that has already completed a real
 *    `lien index` build (`hasCompletedIndex`). This wins even when a `.git`
 *    sits closer, farther, or in between — a directory Lien has actually
 *    indexed is a stronger signal than "some ancestor happens to be a git
 *    repo."
 * 2. Nearest ancestor with a `.git` marker (file or dir), the original
 *    heuristic — used only when no ancestor has a completed index.
 * 3. The resolved `start` path itself, unchanged.
 *
 * This exists to keep read-side commands (`annotate`, `gc`, `path`,
 * `store-paths`, `recap`, `nudge`, `verify-tests` — every consumer of this
 * function) from resolving a *different* root than the one `lien index` was
 * actually run against. The failure mode (#894): a directory with no `.git`
 * of its own (a monorepo subdirectory indexed as its own project, or a repo
 * nested inside a larger checkout) sits under an unrelated outer `.git`.
 * Walking straight to that outer `.git` — the old, single-pass behavior —
 * silently lands on a root that was never indexed, while the directory the
 * caller actually meant sits right there with a real index. Pass 1 fixes
 * that by checking "was this directory actually indexed" before ever
 * considering `.git` at all.
 *
 * `lien index`/`lien init`/`lien serve` deliberately do NOT go through this
 * function — they take `process.cwd()` (or an explicit `--root`/`--path`) as
 * the root verbatim, because that's how a repo-less subdirectory gets
 * indexed as its own project in the first place. Routing them through the
 * `.git`-preferring fallback here would break exactly that setup on a fresh
 * (never-yet-indexed) first run.
 */
export function resolveProjectRoot(start: string = process.cwd()): AbsolutePath {
  const resolvedStart = path.resolve(start);

  const indexed = walkUp(resolvedStart, hasCompletedIndex);
  if (indexed) return toAbsolutePath(indexed);

  const gitRoot = walkUp(resolvedStart, hasGitMarker);
  if (gitRoot) return toAbsolutePath(gitRoot);

  return toAbsolutePath(resolvedStart);
}
