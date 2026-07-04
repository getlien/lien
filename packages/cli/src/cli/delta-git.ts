/**
 * Git change discovery for `lien delta`.
 *
 * Builds the before/after content pairs the complexity-delta primitive
 * consumes, comparing the working tree against HEAD. Handles staged + unstaged
 * changes (via `git diff HEAD`), untracked new files, renames, deletions, and
 * an unborn HEAD (a repo with no commits yet).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { getSupportedExtensions, type FileContentChange } from '@liendev/parser';

const execFileAsync = promisify(execFile);

// git show of a large blob can exceed the default 1 MB stdout buffer.
const MAX_BUFFER = 64 * 1024 * 1024;

async function git(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: rootDir, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Resolve the git repository root for `cwd`, or null if not a git repo. */
export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel']);
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function hasCommits(rootDir: string): Promise<boolean> {
  try {
    await git(rootDir, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

interface RawChange {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  oldPath?: string;
}

/**
 * Parse `git diff --name-status --find-renames -z` output. The `-z` stream is a
 * flat NUL-separated token list: a status token, then one path (or, for renames
 * and copies, an old path followed by a new path).
 */
function parseNameStatusZ(out: string): RawChange[] {
  const tokens = out.split('\0').filter(t => t.length > 0);
  const changes: RawChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      changes.push({ status: 'R', path: newPath, oldPath });
    } else if (code === 'A' || code === 'M' || code === 'D') {
      changes.push({ status: code, path: tokens[i++] });
    } else {
      // Unknown status (T type change, U unmerged, …) — treat as modified.
      changes.push({ status: 'M', path: tokens[i++] });
    }
  }
  return changes;
}

function splitZ(out: string): string[] {
  return out.split('\0').filter(t => t.length > 0);
}

function isSupported(filepath: string, supported: ReadonlySet<string>): boolean {
  const dot = filepath.lastIndexOf('.');
  if (dot < 0) return false;
  return supported.has(filepath.slice(dot));
}

async function showHead(rootDir: string, gitPath: string): Promise<string | null> {
  try {
    return await git(rootDir, ['show', `HEAD:${gitPath}`]);
  } catch {
    // `null` here means "no version of this path in HEAD" — i.e. the file is
    // added/untracked. That is the intended, correct meaning of a `git show`
    // failure for this path (unlike readWorktree below, where null must be
    // reserved for genuine absence), so all errors legitimately map to null.
    return null;
  }
}

// Exported for unit testing of the ENOENT-only null-mapping (Phase-1 finding #4).
export async function readWorktree(rootDir: string, gitPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(rootDir, gitPath), 'utf-8');
  } catch (error) {
    // Downstream, a null `after` is read as "file deleted". Only a genuinely
    // absent file (ENOENT) means that. Any other failure — EACCES, EISDIR, an
    // I/O error — must NOT masquerade as a deletion; surface it as an
    // operational error (the caller maps thrown errors to exit 2).
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Turn a raw git change into a before/after content pair. */
async function toContentChange(
  rootDir: string,
  raw: RawChange,
  unborn: boolean,
): Promise<FileContentChange> {
  if (unborn || raw.status === 'A') {
    return { filepath: raw.path, before: null, after: await readWorktree(rootDir, raw.path) };
  }
  if (raw.status === 'D') {
    return { filepath: raw.path, before: await showHead(rootDir, raw.path), after: null };
  }
  if (raw.status === 'R') {
    const oldPath = raw.oldPath ?? raw.path;
    return {
      filepath: raw.path,
      oldPath,
      before: await showHead(rootDir, oldPath),
      after: await readWorktree(rootDir, raw.path),
    };
  }
  // Modified
  return {
    filepath: raw.path,
    before: await showHead(rootDir, raw.path),
    after: await readWorktree(rootDir, raw.path),
  };
}

/**
 * Collect before/after content pairs for every changed, parser-supported file
 * (working tree vs HEAD). Returns an empty array when there are no changes.
 */
export async function collectFileChanges(rootDir: string): Promise<FileContentChange[]> {
  const supported = new Set(getSupportedExtensions().map(ext => `.${ext}`));
  const born = await hasCommits(rootDir);

  let raw: RawChange[];
  if (born) {
    raw = parseNameStatusZ(
      await git(rootDir, ['diff', '--name-status', '--find-renames', '-z', 'HEAD']),
    );
  } else {
    // Unborn HEAD: everything staged is "added"; nothing has a HEAD baseline.
    const staged = splitZ(await git(rootDir, ['diff', '--cached', '--name-only', '-z']));
    raw = staged.map(p => ({ status: 'A' as const, path: p }));
  }

  // Untracked files are additions regardless of HEAD state.
  const untracked = splitZ(
    await git(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']),
  );
  for (const p of untracked) raw.push({ status: 'A', path: p });

  const filtered = raw.filter(r => isSupported(r.path, supported));
  return Promise.all(filtered.map(r => toContentChange(rootDir, r, !born)));
}

/**
 * Resolve symlinked path segments so lexical `path.relative` comparisons are
 * sound. Falls back gracefully when the target does not exist yet (e.g. a
 * deleted file): realpath the parent directory and re-attach the basename;
 * failing that, return the input unchanged.
 */
async function canonicalize(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    try {
      return path.join(await realpath(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

/**
 * Build the before/after content pair for a SINGLE file (working tree vs HEAD).
 * This is the fast path for the per-edit hook: it avoids the full `git diff`
 * scan and touches only the one file that was just edited.
 *
 * `filePath` may be absolute or relative to `rootDir`. Returns `null` — meaning
 * "nothing to analyze, stay silent" — when the path is outside the repo, its
 * extension is not parser-supported, or it exists on neither side (before and
 * after both absent). Read errors other than ENOENT propagate (operational
 * failure), matching `readWorktree`'s contract.
 */
export async function collectFileChange(
  rootDir: string,
  filePath: string,
): Promise<FileContentChange | null> {
  // Resolve to a repo-relative POSIX path; reject anything outside the repo.
  // Canonicalize symlinked path segments on BOTH sides first — otherwise a
  // symlinked ancestor (macOS /tmp → /private/tmp, or a symlinked project dir)
  // makes an absolute input path lexically "escape" the repo and get rejected.
  const canonRoot = await canonicalize(rootDir);
  const abs = await canonicalize(path.resolve(rootDir, filePath));
  const rel = path.relative(canonRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const relPosix = rel.split(path.sep).join('/');

  const supported = new Set(getSupportedExtensions().map(ext => `.${ext}`));
  if (!isSupported(relPosix, supported)) return null;

  const before = await showHead(rootDir, relPosix); // null => not in HEAD (added/new)
  const after = await readWorktree(rootDir, relPosix); // null => deleted (ENOENT only)
  if (before === null && after === null) return null;

  return { filepath: relPosix, before, after };
}
