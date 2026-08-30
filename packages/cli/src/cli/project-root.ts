import fs from 'fs';
import path from 'path';
import { getIndexDir, VERSION_FILE } from '@liendev/core';
import { type AbsolutePath, toAbsolutePath } from '../types/paths.js';

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
 * Resolve the project root for `start`. A single bounded walk upward,
 * nearest match wins, checking BOTH signals at every directory before moving
 * to its parent:
 *
 * 1. Has this directory already completed a real `lien index` build
 *    (`hasCompletedIndex`)? If so, return it immediately — a directory Lien
 *    has actually indexed is a stronger signal than "some ancestor happens
 *    to be a git repo," even when a `.git` sits closer, farther, or in
 *    between (the #894 fix).
 * 2. Otherwise, does this directory have a `.git` marker (file or dir)? If
 *    so, STOP here and return it — do not keep walking past it looking for
 *    a completed index further out. A `.git` marker is a repo/worktree
 *    boundary; a completed index belonging to a *different* repository on
 *    the other side of that boundary must never win.
 * 3. If the walk reaches the filesystem root without matching either check,
 *    fall back to the resolved `start` path itself, unchanged.
 *
 * This exists to keep read-side commands (`annotate`, `gc`, `path`,
 * `store-paths`, `recap`, `nudge`, `verify-tests` — every consumer of this
 * function) from resolving a *different* root than the one `lien index` was
 * actually run against.
 *
 * The #894 shape: a directory with no `.git` of its own (a monorepo
 * subdirectory indexed as its own project, or a repo nested inside a larger
 * checkout) sits under an unrelated outer `.git`. Walking straight to that
 * outer `.git` silently lands on a root that was never indexed, while the
 * directory the caller actually meant sits right there with a real index.
 * Checking "was this directory actually indexed" before considering `.git`
 * fixes that — as long as the indexed directory is reached before any `.git`
 * marker, which it always is in that shape (the indexed directory itself has
 * no `.git`).
 *
 * The #1050 shape (a linked git worktree — see
 * `docs/architecture/worktree-aware-indexing.md`): the worktree's own root
 * has a `.git` FILE (the linked-worktree marker), and — being a Claude Code
 * agent worktree under `<main>/.claude/worktrees/<name>` — sits *inside* the
 * main checkout's directory tree, whose `.git` DIRECTORY is therefore a
 * filesystem ancestor of the worktree. Before the worktree's own first
 * `lien index` (i.e. its `OverlayBackend` has never completed a local
 * build), the worktree itself has no completed index — but the main
 * checkout, further up the same walk, very likely does. The old two-
 * separate-passes design ran the completed-index check as its own fully
 * unbounded walk, so it walked straight past the worktree's own `.git` file
 * to the main checkout's completed index, silently resolving every
 * annotate/gc/path/etc. call to the WRONG repository. Bounding the walk so
 * it stops the moment it hits a `.git` marker — checking for a completed
 * index no further out than that boundary — fixes it: the worktree's own
 * `.git` file is the nearest marker, so the walk stops there, exactly like a
 * plain `.git`-only walk always did, whether or not the worktree has
 * completed its own overlay build yet.
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
  const fsRoot = path.parse(resolvedStart).root;

  let dir = resolvedStart;
  while (true) {
    if (hasCompletedIndex(dir)) return toAbsolutePath(dir);
    if (hasGitMarker(dir)) return toAbsolutePath(dir);
    if (dir === fsRoot) return toAbsolutePath(resolvedStart);
    dir = path.dirname(dir);
  }
}

/**
 * Resolve the project root using ONLY the `.git` marker, never the index.
 *
 * The index-free counterpart to {@link resolveProjectRoot}, for commands that
 * parse the working tree (`lien complexity`, `lien health`). Those must not
 * consult `hasCompletedIndex`: reading the store to decide where to look
 * would re-introduce the dependency the whole point was to remove, and would
 * make the answer depend on whether someone had once run `lien index` here.
 *
 * Why resolve at all rather than trusting `process.cwd()`: run from
 * `packages/cli`, a raw cwd analyses that subtree alone. The report looks
 * perfectly normal — a smaller file count, paths rooted at the subdirectory —
 * while every dependent count is silently understated, because fan-in is
 * computed over the visible corpus. For a gate-shaped command that means
 * `--fail-on error` passing or failing on an arbitrary subtree. The old
 * index-backed path caught this by accident: no index under `packages/cli`
 * meant a hard "Index not found" rather than a plausible wrong answer.
 *
 * Falls back to `start` when no marker is found anywhere up the tree, which
 * keeps non-repo directories working.
 */
export function resolveRepoRoot(start: string = process.cwd()): AbsolutePath {
  const resolvedStart = path.resolve(start);
  const fsRoot = path.parse(resolvedStart).root;

  let dir = resolvedStart;
  while (true) {
    if (hasGitMarker(dir)) return toAbsolutePath(dir);
    if (dir === fsRoot) return toAbsolutePath(resolvedStart);
    dir = path.dirname(dir);
  }
}
