/**
 * Agent tool implementations backed by in-memory CodeChunk[] arrays.
 *
 * No VectorDB or embeddings required. Most tools work from the repoChunks
 * that the engine already produces via performChunkOnlyIndex(); the
 * exceptions are read_file and grep_codebase, which read the cloned repo
 * from disk so they can see files the parser never chunks (config, YAML,
 * CI workflows, etc.).
 */

import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

import { analyzeComplexityFromChunks, createGitignoreFilter } from '@liendev/parser';

import type { AgentToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILES_CONTEXT = 20;
const MAX_FUNCTIONS_LIMIT = 100;
const DEFAULT_FUNCTIONS_LIMIT = 30;
const DEFAULT_COMPLEXITY_TOP = 10;
const MAX_READ_LINES = 500;

// ---------------------------------------------------------------------------
// get_files_context
// ---------------------------------------------------------------------------

export function getFilesContext(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const raw = input.filepaths;
    const filepaths = Array.isArray(raw) ? (raw as string[]) : [raw as string];

    if (filepaths.length === 0) return JSON.stringify({ error: 'filepaths is required' });
    if (filepaths.length > MAX_FILES_CONTEXT) {
      return JSON.stringify({ error: `Too many files (max ${MAX_FILES_CONTEXT})` });
    }

    const fileResults: Record<string, unknown[]> = {};

    for (const filepath of filepaths) {
      const chunks = ctx.repoChunks.filter(c => c.metadata.file === filepath);
      fileResults[filepath] = chunks.map(c => ({
        symbolName: c.metadata.symbolName ?? null,
        symbolType: c.metadata.symbolType ?? null,
        signature: c.metadata.signature ?? null,
        startLine: c.metadata.startLine,
        endLine: c.metadata.endLine,
        imports: c.metadata.imports ?? [],
        exports: c.metadata.exports ?? [],
        callSites: c.metadata.callSites ?? [],
        parameters: c.metadata.parameters ?? [],
        returnType: c.metadata.returnType ?? null,
        complexity: c.metadata.complexity ?? null,
        cognitiveComplexity: c.metadata.cognitiveComplexity ?? null,
      }));
    }

    return JSON.stringify({ files: fileResults });
  } catch (err) {
    return JSON.stringify({ error: `get_files_context failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_dependents
// ---------------------------------------------------------------------------

export function getDependents(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    const symbol = input.symbol as string | undefined;

    if (symbol) {
      const callers = ctx.graph.getCallers(filepath, symbol);
      const riskLevel = getRiskLevel(callers.length);

      return JSON.stringify({
        filepath,
        symbol,
        dependentCount: callers.length,
        riskLevel,
        callers: callers.map(c => ({
          filepath: c.caller.filepath,
          symbolName: c.caller.symbolName,
          callSiteLine: c.callSiteLine,
        })),
      });
    }

    // No specific symbol — find callers for all exports from this file
    const fileChunks = ctx.repoChunks.filter(c => c.metadata.file === filepath);
    const exportedSymbols = new Set<string>();
    for (const chunk of fileChunks) {
      if (chunk.metadata.exports) {
        for (const exp of chunk.metadata.exports) {
          exportedSymbols.add(exp);
        }
      }
    }

    const allCallers: Array<{
      symbol: string;
      filepath: string;
      symbolName: string;
      callSiteLine: number;
    }> = [];

    for (const sym of exportedSymbols) {
      const callers = ctx.graph.getCallers(filepath, sym);
      for (const c of callers) {
        allCallers.push({
          symbol: sym,
          filepath: c.caller.filepath,
          symbolName: c.caller.symbolName,
          callSiteLine: c.callSiteLine,
        });
      }
    }

    const riskLevel = getRiskLevel(allCallers.length);

    return JSON.stringify({
      filepath,
      dependentCount: allCallers.length,
      riskLevel,
      callers: allCallers,
    });
  } catch (err) {
    return JSON.stringify({ error: `get_dependents failed: ${(err as Error).message}` });
  }
}

function getRiskLevel(count: number): 'low' | 'medium' | 'high' | 'critical' {
  if (count >= 20) return 'critical';
  if (count >= 10) return 'high';
  if (count >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// list_functions
// ---------------------------------------------------------------------------

export function listFunctions(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const pattern = input.pattern as string | undefined;
    const symbolType = input.symbolType as
      | 'function'
      | 'method'
      | 'class'
      | 'interface'
      | undefined;
    const language = input.language as string | undefined;
    const limit = Math.min(
      Math.max((input.limit as number) || DEFAULT_FUNCTIONS_LIMIT, 1),
      MAX_FUNCTIONS_LIMIT,
    );

    // Exclude markdown 'doc' and YAML 'config' chunks: they carry a
    // heading-breadcrumb / key-path symbolName but are prose or config keys,
    // not real code symbols (mirrors core's matchesSymbolFilter, which
    // review can't import across the package boundary).
    let results = ctx.repoChunks.filter(
      c => !!c.metadata.symbolName && c.metadata.type !== 'doc' && c.metadata.type !== 'config',
    );

    if (symbolType) {
      results = results.filter(c => c.metadata.symbolType === symbolType);
    }
    if (language) {
      results = results.filter(c => c.metadata.language === language);
    }
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      results = results.filter(c => regex.test(c.metadata.symbolName!));
    }

    const shaped = results.slice(0, limit).map(c => ({
      symbolName: c.metadata.symbolName,
      symbolType: c.metadata.symbolType ?? null,
      filepath: c.metadata.file,
      startLine: c.metadata.startLine,
      signature: c.metadata.signature ?? null,
      language: c.metadata.language,
    }));

    return JSON.stringify({ results: shaped, count: shaped.length });
  } catch (err) {
    return JSON.stringify({ error: `list_functions failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// get_complexity
// ---------------------------------------------------------------------------

export function getComplexity(input: Record<string, unknown>, ctx: AgentToolContext): string {
  try {
    const files = input.files as string[] | undefined;
    const top = Math.max((input.top as number) || DEFAULT_COMPLEXITY_TOP, 1);

    const report = analyzeComplexityFromChunks(ctx.repoChunks, files);

    const allViolations = Object.values(report.files)
      .flatMap(f => f.violations)
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return b.complexity - a.complexity;
      })
      .slice(0, top);

    const shaped = allViolations.map(v => ({
      filepath: v.filepath,
      symbolName: v.symbolName,
      symbolType: v.symbolType,
      startLine: v.startLine,
      endLine: v.endLine,
      metricType: v.metricType,
      complexity: v.complexity,
      threshold: v.threshold,
      severity: v.severity,
      message: v.message,
    }));

    return JSON.stringify({
      summary: report.summary,
      violations: shaped,
      count: shaped.length,
    });
  } catch (err) {
    return JSON.stringify({ error: `get_complexity failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// grep_codebase
// ---------------------------------------------------------------------------

const MAX_GREP_RESULTS = 30;
/** Skip files larger than this — lockfiles, bundles, and binaries are noise. */
const MAX_GREP_FILE_BYTES = 1_000_000;
/**
 * Wall-clock backstop for a single grep call. The agent-supplied pattern is
 * compiled with `new RegExp` and could backtrack pathologically (ReDoS) or the
 * repo could simply be huge; this bounds total scan time and returns partial
 * results rather than hanging the worker. It does not interrupt a single
 * `regex.test` already in flight — a non-backtracking engine (e.g. RE2) would,
 * but that is a native dependency we avoid to keep the Action portable.
 */
const GREP_TIME_BUDGET_MS = 5_000;
/**
 * Directories never worth walking. Mirrors the heavy entries in
 * ALWAYS_IGNORE_PATTERNS so we prune them up front instead of reading every
 * entry and discarding it. `.github` is deliberately NOT skipped — CI
 * workflows are exactly the kind of non-code reference we now want to find.
 */
const GREP_SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.lien']);

/** A single grep hit: file path, 1-based line number, and trimmed matching text. */
interface GrepMatch {
  filepath: string;
  line: number;
  match: string;
}

/**
 * Decide whether a symlink entry should be grepped. Follows the link with
 * realpath and includes it only when it resolves to a regular file whose real
 * location stays inside `rootDir` and is not itself gitignored (a non-ignored
 * link must not become a back door to ignored content). Directory symlinks
 * (traversal cycle / escape risk), out-of-tree targets, and broken links are
 * excluded. This lets grep see references behind symlinked config/source while
 * never reading outside the repo or past .gitignore. `rootDir` must already be
 * canonical (see grepCodebase) so the containment comparison is like-for-like.
 */
async function symlinkPointsToFileInRepo(
  rootDir: string,
  linkPath: string,
  isIgnored: (relPath: string) => boolean,
): Promise<boolean> {
  try {
    const real = await fs.realpath(linkPath);
    const rel = path.relative(rootDir, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false; // escapes repo
    if (isIgnored(rel)) return false; // target is gitignored — don't scan it via the link
    return (await fs.stat(real)).isFile();
  } catch {
    return false; // broken link / permission
  }
}

/**
 * Classify a directory entry for the grep walk: 'file' to scan, 'dir' to
 * descend into, or 'skip'. Regular files scan; non-skip directories descend;
 * symlinks scan only when they point to a non-ignored regular file inside the
 * repo (directory symlinks are skipped to avoid cycles/escapes).
 */
async function classifyGrepEntry(
  rootDir: string,
  entry: Dirent,
  full: string,
  isIgnored: (relPath: string) => boolean,
): Promise<'file' | 'dir' | 'skip'> {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return GREP_SKIP_DIRS.has(entry.name) ? 'skip' : 'dir';
  if (entry.isSymbolicLink() && (await symlinkPointsToFileInRepo(rootDir, full, isIgnored)))
    return 'file';
  return 'skip';
}

/**
 * Recursively collect file paths under `dir`, pruning GREP_SKIP_DIRS and
 * gitignored paths. Applying `isIgnored` during traversal means ignored
 * directories (e.g. coverage/, .next/) are never descended into, rather than
 * walked and discarded afterward. Dotfiles and dot-directories other than the
 * skip set ARE included.
 */
async function collectGrepFiles(
  rootDir: string,
  dir: string,
  isIgnored: (relPath: string) => boolean,
  acc: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip rather than abort the whole grep
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (isIgnored(path.relative(rootDir, full))) continue;
    const kind = await classifyGrepEntry(rootDir, entry, full, isIgnored);
    if (kind === 'file') acc.push(full);
    else if (kind === 'dir') await collectGrepFiles(rootDir, full, isIgnored, acc);
  }
}

/**
 * Read a file's text for grepping, or null if it should be skipped: too large,
 * binary (contains a NUL byte), or unreadable. Keeps those guards out of the
 * main loop.
 */
async function readGrepCandidate(absFile: string): Promise<string | null> {
  try {
    const { size } = await fs.stat(absFile);
    if (size > MAX_GREP_FILE_BYTES) return null;
    const content = await fs.readFile(absFile, 'utf-8');
    return content.includes('\0') ? null : content;
  } catch {
    return null; // disappeared / permission / not readable
  }
}

/**
 * Append matching lines from `content` to `matches`; returns true if the
 * wall-clock deadline was hit mid-file (checked per line, so a many-line file
 * can't blow the budget). Collects one past the result cap (a sentinel) so the
 * caller can tell "exactly cap matches" from "more than cap"; the extra is
 * trimmed before returning. Lines are tested in full — no length clipping —
 * to avoid dropping matches or skewing anchored patterns. Line numbers are
 * 1-based.
 */
function collectLineMatches(
  content: string,
  regex: RegExp,
  filepath: string,
  matches: GrepMatch[],
  deadline: number,
): boolean {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && matches.length <= MAX_GREP_RESULTS; i++) {
    if (Date.now() > deadline) return true;
    if (regex.test(lines[i])) {
      matches.push({ filepath, line: i + 1, match: lines[i].trim().slice(0, 200) });
    }
  }
  return false;
}

/**
 * Read and scan each file for `regex`, accumulating hits up to one past the
 * result cap. `truncated` is true when results are incomplete — either a
 * genuine (cap+1)th match was found, or the wall-clock deadline passed. The
 * sentinel overflow is trimmed off the returned matches.
 */
async function scanForMatches(
  files: string[],
  regex: RegExp,
  rootDir: string,
  deadline: number,
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const matches: GrepMatch[] = [];
  let timedOut = false;
  for (const absFile of files) {
    if (matches.length > MAX_GREP_RESULTS) break; // found the sentinel — there are more
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const content = await readGrepCandidate(absFile);
    if (content === null) continue;
    if (collectLineMatches(content, regex, path.relative(rootDir, absFile), matches, deadline)) {
      timedOut = true;
      break;
    }
  }
  const truncated = timedOut || matches.length > MAX_GREP_RESULTS;
  return { matches: matches.slice(0, MAX_GREP_RESULTS), truncated };
}

/**
 * Message returned by the disk-backed tools when the working tree is absent.
 * Spelled out so the agent does NOT read an empty/missing result as "no match
 * exists" — in offline fixture replay the captured repoRootDir is long gone, so
 * grep/read are blind and a silent empty result has caused grep-dependent rules
 * to be misdiagnosed as model failures. Points the agent at the deterministic
 * signals and in-memory chunk tools, which work regardless of the working tree.
 */
const REPLAY_UNAVAILABLE_REASON =
  'The repository working tree is not available in this run (e.g. offline fixture ' +
  'replay), so disk-backed search is blind here — a zero/empty result does NOT mean ' +
  '"no match exists". Rely on the pre-computed signals in your initial message ' +
  '(<stale_literal_candidates>, <blast_radius>, <removed_exports>) and the ' +
  'chunk-backed tools (get_files_context, get_dependents, list_functions) instead.';

/**
 * True when the repo working tree is not on disk (e.g. harness fixture replay).
 * Only a genuinely missing root (ENOENT / ENOTDIR) counts — a root that exists
 * but is unreadable (EACCES, EMFILE, transient I/O) must surface as a real
 * error, not be masked as replay blindness, so return false and let the caller
 * fail normally.
 */
async function repoTreeUnavailable(repoRootDir: string): Promise<boolean> {
  try {
    await fs.access(repoRootDir);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

export async function grepCodebase(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const pattern = input.pattern as string;
    if (!pattern) return JSON.stringify({ error: 'pattern is required' });

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (err) {
      return JSON.stringify({ error: `Invalid regex pattern: ${(err as Error).message}` });
    }

    // Search the real working tree (not just parser-chunked source) so refs in
    // config, YAML, CI workflows, etc. are visible. Respect .gitignore +
    // built-in excludes via the shared parser filter, pruning ignored paths
    // during the walk rather than after. Canonicalize the root first so symlink
    // containment checks compare like-for-like (e.g. macOS /var vs /private/var).
    // A missing root (offline fixture replay against a long-gone temp dir)
    // surfaces here as ENOENT/ENOTDIR and is translated in the catch below —
    // handled on the real operation rather than a pre-check, to avoid a TOCTOU
    // window and a redundant stat.
    const rootDir = await fs.realpath(ctx.repoRootDir);
    const isIgnored = await createGitignoreFilter(rootDir);
    const files: string[] = [];
    await collectGrepFiles(rootDir, rootDir, isIgnored, files);
    files.sort(); // deterministic ordering across filesystems

    const { matches, truncated } = await scanForMatches(
      files,
      regex,
      rootDir,
      Date.now() + GREP_TIME_BUDGET_MS,
    );

    return JSON.stringify({ results: matches, count: matches.length, truncated });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return JSON.stringify({
        results: [],
        count: 0,
        unavailable: true,
        reason: REPLAY_UNAVAILABLE_REASON,
      });
    }
    return JSON.stringify({ error: `grep_codebase failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export async function readFile(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  try {
    const filepath = input.filepath as string;
    if (!filepath) return JSON.stringify({ error: 'filepath is required' });

    if (filepath.includes('..')) {
      return JSON.stringify({ error: 'Path traversal not allowed' });
    }
    if (path.isAbsolute(filepath)) {
      return JSON.stringify({
        error: 'Absolute paths not allowed — use relative paths from repo root',
      });
    }

    const resolved = path.resolve(ctx.repoRootDir, filepath);
    if (!resolved.startsWith(ctx.repoRootDir)) {
      return JSON.stringify({ error: 'Path traversal not allowed' });
    }

    const raw = await fs.readFile(resolved, 'utf-8');
    const lines = raw.split('\n');

    const startLine = Math.max((input.startLine as number) || 1, 1);
    const endLine = Math.min(
      (input.endLine as number) || startLine + MAX_READ_LINES - 1,
      lines.length,
    );

    const effectiveEnd = Math.min(endLine, startLine + MAX_READ_LINES - 1);
    const slice = lines.slice(startLine - 1, effectiveEnd);
    const numbered = slice.map((line, i) => `${startLine + i}: ${line}`).join('\n');

    return JSON.stringify({
      filepath,
      startLine,
      endLine: effectiveEnd,
      totalLines: lines.length,
      content: numbered,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Distinguish "this one file is missing" from "the whole working tree is
      // gone" (offline replay) — the latter is blind, not a real 404.
      if (await repoTreeUnavailable(ctx.repoRootDir)) {
        return JSON.stringify({ unavailable: true, reason: REPLAY_UNAVAILABLE_REASON });
      }
      return JSON.stringify({ error: `File not found: ${input.filepath}` });
    }
    return JSON.stringify({ error: `read_file failed: ${(err as Error).message}` });
  }
}
