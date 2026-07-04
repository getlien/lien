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
import { readFile } from 'node:fs/promises';
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
    return null;
  }
}

async function readWorktree(rootDir: string, gitPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(rootDir, gitPath), 'utf-8');
  } catch {
    return null;
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
