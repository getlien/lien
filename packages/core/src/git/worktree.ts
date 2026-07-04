import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Result of probing whether a directory is a linked git worktree. */
export interface WorktreeInfo {
  /** True when `rootDir` is a linked worktree (its git-dir differs from the
   *  shared git-common-dir). False for the main checkout or a non-git dir. */
  isLinkedWorktree: boolean;
  /** Absolute path of the main checkout's working tree, or null when unknown
   *  (not a linked worktree, or a bare-repo topology with no main working tree). */
  mainRoot: string | null;
}

/**
 * Detect whether `rootDir` is a *linked* git worktree and, if so, locate the
 * main checkout.
 *
 * Detection rule (verified against `git worktree`): a linked worktree's
 * `--git-dir` (`<main>/.git/worktrees/<name>`) differs from its
 * `--git-common-dir` (`<main>/.git`); in the main checkout the two are equal.
 *
 * The main working-tree path is read from the first `worktree <path>` line of
 * `git worktree list --porcelain` — authoritative, and correct for bare-repo
 * topologies (where deriving it from the common dir would be wrong).
 *
 * Never throws: any git failure (not installed, not a repo) resolves to
 * `{ isLinkedWorktree: false, mainRoot: null }` so callers fall back to
 * standalone behavior.
 */
export async function detectLinkedWorktree(rootDir: string): Promise<WorktreeInfo> {
  const standalone: WorktreeInfo = { isLinkedWorktree: false, mainRoot: null };
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
      { cwd: rootDir, timeout: 5000 },
    );
    const [gitDir, commonDir] = stdout.trim().split('\n');
    if (!gitDir || !commonDir || gitDir === commonDir) {
      return standalone;
    }

    const mainRoot = await findMainWorktreeRoot(rootDir);
    return { isLinkedWorktree: true, mainRoot };
  } catch {
    return standalone;
  }
}

/**
 * Return the main checkout's working-tree path — the first entry of
 * `git worktree list --porcelain`. Returns null on any failure.
 */
async function findMainWorktreeRoot(rootDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: rootDir,
      timeout: 5000,
    });
    const firstLine = stdout.split('\n').find(line => line.startsWith('worktree '));
    if (!firstLine) return null;
    return firstLine.slice('worktree '.length).trim() || null;
  } catch {
    return null;
  }
}
