import fs from 'fs';
import path from 'path';
import { type AbsolutePath, toAbsolutePath } from '../types/paths.js';

function hasGitMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Resolve the project root using ONLY the `.git` marker, never the index.
 *
 * The only resolver now. It was written as the index-free counterpart to a
 * `resolveProjectRoot` that preferred a directory with a completed index;
 * that function and the store it consulted are both gone, so the `.git`
 * marker is the sole signal. Commands that parse the working tree
 * (`lien complexity`, `lien health`, `lien review`) always used this one.
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

/**
 * Re-base a user-supplied path from the invocation directory onto the
 * analysis root.
 *
 * Once a command resolves its own root with {@link resolveRepoRoot}, its
 * report paths become root-relative — but the paths a user typed are still
 * relative to wherever they were standing. Run `lien complexity --files
 * src/thing.ts` from `packages/cli` and, unconverted, it looks for
 * `<repoRoot>/src/thing.ts`: a file that usually does not exist, and
 * occasionally a different one that does.
 */
export function rebaseToRoot(userPath: string, cwd: string, rootDir: string): string {
  const absolute = path.isAbsolute(userPath) ? userPath : path.resolve(cwd, userPath);
  return path.relative(rootDir, absolute);
}
