import path from 'path';
import { isHomeDirectory, toComparablePath } from '@liendev/parser';

/** Why `checkRootSafety` refused a root. */
export type UnsafeRootKind = 'home' | 'filesystem-root';

/**
 * Result of {@link checkRootSafety}. `resolved` is always the fully resolved
 * absolute path that was checked, so callers never need to re-resolve it for
 * logging or error messages.
 */
export type RootSafetyResult =
  | { unsafe: true; kind: UnsafeRootKind; resolved: string }
  | { unsafe: false; resolved: string };

/**
 * Detect whether `dir` (resolved) IS — not merely contains or sits under —
 * the user's home directory or a filesystem root (`/`, `C:\`, a Windows
 * user-profile root). Exact-match only: a real project that happens to live
 * directly under `$HOME` (`~/myproject`) must never match. That scoping is
 * deliberate — see #1025: `lien index` run from `$HOME` swept macOS Keychain
 * databases, `.npm` debug logs, and Claude Code agent caches into a 10.5 GB
 * index, and there was no guard anywhere against it. That command and its
 * index are gone, but the hazard is not — and for one commit this comment
 * claimed the guard had followed it, which was false: deleting `lien index`
 * left this function with no caller at all (tree-shaken clean out of the
 * bundle) while the comment asserted it protected `lien complexity`. It is
 * now genuinely wired into `lien complexity` and `lien health`, which walk
 * from `resolveRepoRoot` and so fall back to the start directory when no
 * `.git` sits above it. That makes `$HOME` MORE reachable than before, not
 * less: `lien health` is what the quick-start banner tells a new user to run.
 *
 * The home check delegates to {@link isHomeDirectory} (`@liendev/parser`) —
 * the same symlink-safe comparison `getEffectiveAlwaysIgnorePatterns` uses —
 * rather than a second, parallel `os.homedir()` comparison here.
 *
 * `resolved` comes from {@link toComparablePath} (`@liendev/parser`), not a
 * plain `path.resolve`: the latter only normalizes `.`/`..` segments and
 * leaves a symlink target unresolved, so a `cwd` that is itself a symlink to
 * `/` would lexically read as some other path and slip past the
 * `resolved === fsRoot` check below (review finding — a false negative in a
 * safety check is worse than a false positive, same rationale
 * `toComparablePath`'s own doc comment gives for the home-directory half of
 * this same guard).
 */
export function checkRootSafety(dir: string): RootSafetyResult {
  const resolved = toComparablePath(dir);
  const fsRoot = path.parse(resolved).root;

  if (resolved === fsRoot) {
    return { unsafe: true, kind: 'filesystem-root', resolved };
  }

  if (isHomeDirectory(resolved)) {
    return { unsafe: true, kind: 'home', resolved };
  }

  return { unsafe: false, resolved };
}

/**
 * Build the hard-error message for an unsafe root. Names the exact path and
 * the override that lets someone with a genuine reason proceed deliberately
 * (`--allow-unsafe-root`) — a refusal must be actionable, never a dead end
 * (CLAUDE.md's index-state-honesty policy: gate-shaped commands hard-error,
 * but always with a way forward).
 */
export function formatUnsafeRootMessage(
  result: Extract<RootSafetyResult, { unsafe: true }>,
): string {
  const what = result.kind === 'home' ? 'your home directory' : 'a filesystem root';

  return (
    `Refusing to index ${what} (${result.resolved}).\n\n` +
    'Indexing this path would sweep OS caches, credential stores (SSH keys, ' +
    'cloud CLI configs, keychains), and every unrelated project underneath it ' +
    'into one index — this is almost never intentional, and it has previously ' +
    'produced a multi-gigabyte index built entirely from OS and agent cache ' +
    'files (see https://github.com/getlien/lien/issues/1025).\n\n' +
    'If this is really what you want, rerun with --allow-unsafe-root.'
  );
}

/**
 * The whole guard as one call: check `dir`, and hard-exit 2 with an actionable
 * message unless the caller passed the override. Both `lien complexity` and
 * `lien health` need the identical three lines, and inlining them twice was
 * enough to push `complexityCommand` over its time-to-understand threshold.
 */
export function assertSafeRoot(dir: string, allowUnsafeRoot: boolean | undefined): void {
  const result = checkRootSafety(dir);
  if (result.unsafe && allowUnsafeRoot !== true) {
    console.error(formatUnsafeRootMessage(result));
    process.exit(2);
  }
}
