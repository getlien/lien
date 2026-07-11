#!/usr/bin/env tsx
/**
 * One-off capture driver: snapshot a closed/historic PR's ReviewContext
 * for use as a harness fixture, without running the agent plugin.
 *
 * Uses a git worktree to avoid touching the current working branch.
 *
 * Usage:
 *   tsx capture-pr.ts <pr-number> <output-fixture-path> [--sha <commit-sha>]
 *
 * `--sha` overrides the captured head: use it to snapshot a PR at an
 * earlier commit (e.g., before a follow-up fix landed). When provided,
 * the diff is computed via `git diff <base>..<sha>` instead of `gh pr
 * diff`, so only the changes up to that commit are captured. The base
 * remains the PR's `baseRefOid`.
 *
 * Prerequisites:
 *   - gh CLI authenticated
 *   - Run from the lien monorepo root
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, isAbsolute, relative } from 'node:path';

import { performChunkOnlyIndex } from '@liendev/parser';

import { runComplexityAnalysis } from '../../src/analysis.js';
import { silentLogger } from '../../src/test-helpers.js';

import { saveFixture } from './fixture-loader.js';

interface PrMeta {
  title: string;
  body: string;
  baseRefOid: string;
  headRefOid: string;
  files: Array<{ path: string }>;
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Mirror the per-line bookkeeping in `parsePatchLines` from
 * `packages/review/src/github-api.ts` so captured fixtures' diffLines
 * match what the runner builds in production:
 *   - hunk header sets `currentLine` to the post-image start (1-based)
 *   - both `+` (added) and ` ` (context) lines are added to the set and
 *     advance the counter
 *   - `-` (deleted) lines don't advance
 *   - `+++ b/...` file header is skipped
 *
 * Engine consumers (`engine.ts:600`) use this to filter findings to
 * diff-adjacent lines via `diffLines.get(file)?.has(line)`. If we only
 * captured `+` lines, findings on context lines would silently fall out
 * of the harness's filter behavior vs prod.
 */
/**
 * Extract the post-image line numbers covered by a single file's diff
 * block (the bit between two `diff --git` headers). Tracks both `+`
 * (added) and ` ` (context) lines so the engine's diff-adjacent filter
 * matches what production sees.
 */
function extractPostImageLines(block: string): Set<number> {
  const lines = new Set<number>();
  let currentLine = 0; // overwritten by the first hunk header
  for (const line of block.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    // `-` lines don't advance currentLine (post-image counter).
    // `+++` is the file header, skip without advancing.
    if ((line.startsWith('+') || line.startsWith(' ')) && !line.startsWith('+++')) {
      lines.add(currentLine);
      currentLine++;
    }
  }
  return lines;
}

function parseUnifiedDiff(diff: string): {
  patches: Map<string, string>;
  diffLines: Map<string, Set<number>>;
} {
  const patches = new Map<string, string>();
  const diffLines = new Map<string, Set<number>>();
  for (const block of diff.split(/^diff --git /m).slice(1)) {
    const headerMatch = block.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!headerMatch) continue;
    const path = headerMatch[2];
    patches.set(path, `diff --git ${block}`.trimEnd());
    diffLines.set(path, extractPostImageLines(block));
  }
  return { patches, diffLines };
}

/**
 * Normalize a path to repo-relative form for set membership.
 * Handles three indexer-output shapes defensively:
 *   1. Already repo-relative: 'src/risk.ts' (current behavior)
 *   2. Absolute, inside the worktree: '/tmp/lien-capture-…/src/risk.ts'
 *   3. Repo-relative with leading './': './src/risk.ts'
 * On Windows, also normalizes backslashes.
 */
function toRepoRelative(p: string, repoRoot: string): string {
  const rel = isAbsolute(p) ? relative(repoRoot, p) : p;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function withWorktree<T>(sha: string, fn: (path: string) => Promise<T>): Promise<T> {
  const wtPath = join(tmpdir(), `lien-capture-${sha.slice(0, 12)}`);
  let addError: Error | undefined;
  // If a previous capture left this worktree in place, reuse it. Otherwise create.
  try {
    sh(`git worktree add --detach "${wtPath}" "${sha}"`);
  } catch (err) {
    addError = err instanceof Error ? err : new Error(String(err));
  }
  // Verify the worktree actually exists at the expected sha — `git worktree
  // add` may fail for reasons unrelated to "already there" (bad sha, perms,
  // disk full). Without this check we'd silently feed a stale or missing
  // path into indexing and produce a confusing downstream error.
  let head: string;
  try {
    head = sh(`git -C "${wtPath}" rev-parse HEAD`).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const orig = addError ? `\n  underlying add error: ${addError.message}` : '';
    throw new Error(`worktree at ${wtPath} not usable: ${reason}${orig}`);
  }
  if (!head.startsWith(sha.slice(0, head.length))) {
    throw new Error(
      `worktree at ${wtPath} is at ${head}, expected ${sha}. ` +
        `Remove it with \`git worktree remove --force ${wtPath}\` and re-run.`,
    );
  }
  // We deliberately do NOT remove the worktree on success — the captured
  // fixture's repoRootDir points here, so harness runs that need
  // read_file/grep_codebase against the PR head still work. Clean up manually:
  //   git worktree remove --force <path>
  return fn(wtPath);
}

interface ParsedArgs {
  prNumber: number;
  outputPath: string;
  shaOverride?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let shaOverride: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sha') {
      const value = argv[++i];
      if (!value) {
        console.error('--sha requires a value');
        process.exit(2);
      }
      shaOverride = value;
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
    positional.push(arg);
  }
  if (positional.length !== 2) {
    const got = positional.length === 0 ? '(none)' : positional.join(' ');
    console.error(
      `Usage: tsx capture-pr.ts <pr-number> <output-fixture-path> [--sha <commit-sha>]\n` +
        `  expected exactly 2 positional arguments, got ${positional.length}: ${got}`,
    );
    process.exit(2);
  }
  const [prArg, outArg] = positional;
  const prNumber = parseInt(prArg, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`pr-number must be a positive integer (got: ${prArg})`);
    process.exit(2);
  }
  return { prNumber, outputPath: resolve(outArg), shaOverride };
}

/** Short or full git commit SHA — 7–40 hex chars, nothing else. */
const SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;

/**
 * Resolve a possibly-short SHA to its full 40-char form via the current
 * checkout's git data. Throws if the SHA isn't reachable — gives a
 * clearer error than a downstream `git worktree add` failure.
 *
 * Validates `sha` against a strict hex pattern before passing it to
 * `sh()`. `sh()` shells out via `execSync`, so an unsanitised SHA
 * (e.g. one containing a quote, semicolon, or backtick) would expand
 * into the command string and execute arbitrary commands. Per
 * CodeRabbit on #545.
 */
function resolveSha(sha: string): string {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(
      `invalid --sha "${sha}": expected 7–40 hex chars (commit SHA), got ${sha.length} chars including non-hex characters`,
    );
  }
  try {
    return sh(`git rev-parse --verify "${sha}^{commit}"`).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not resolve sha "${sha}": ${reason}`);
  }
}

/**
 * Assert that `sha` lives in PR #prNumber's lineage — i.e., the PR's
 * baseRefOid is an ancestor of `sha`, and `sha` is an ancestor of the
 * PR's headRefOid. Without this, `--sha` would happily accept any
 * reachable commit and produce a fixture whose `pr` metadata claims a
 * PR while the diff is from unrelated history. (Per CodeRabbit on #545.)
 */
function assertShaInPrRange(meta: PrMeta, prNumber: number, sha: string): void {
  const inRange = (cmd: string): boolean => {
    try {
      sh(cmd);
      return true;
    } catch {
      return false;
    }
  };
  const baseInSha = inRange(`git merge-base --is-ancestor "${meta.baseRefOid}" "${sha}"`);
  const shaInHead = inRange(`git merge-base --is-ancestor "${sha}" "${meta.headRefOid}"`);
  if (!baseInSha || !shaInHead) {
    throw new Error(
      `--sha ${sha} is not within PR #${prNumber} commit range ` +
        `(${meta.baseRefOid}..${meta.headRefOid}). Pass a SHA that lives in the PR's lineage.`,
    );
  }
}

/**
 * Pick where to source the diff and changed-files list. Default path is
 * `gh pr diff` (the PR's full diff). When a `--sha` override is in play,
 * recompute against that SHA so PR-level files (which include every
 * commit on the PR) don't bleed into a single-commit snapshot.
 */
function selectDiffSource(
  meta: PrMeta,
  prNumber: number,
  headSha: string,
  shaOverride: string | undefined,
): { diffText: string; changedFiles: string[] } {
  if (!shaOverride) {
    console.error(`[capture] fetching PR ${prNumber} diff`);
    return {
      diffText: sh(`gh pr diff ${prNumber}`),
      changedFiles: meta.files.map(f => f.path),
    };
  }
  console.error(`[capture] computing diff ${meta.baseRefOid}..${headSha}`);
  const range = `"${meta.baseRefOid}".."${headSha}"`;
  return {
    diffText: sh(`git diff ${range}`),
    changedFiles: sh(`git diff --name-only ${range}`)
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0),
  };
}

/**
 * Extensions whose chunking goes through the native AST parser
 * (@liendev/parser-native). Markdown (heading-chunked) and Vue (line-based)
 * do NOT — they survive even when the native binding fails, which is exactly
 * why a broken index looks like a markdown/Vue-only corpus. `.liquid` is
 * omitted deliberately: it's uncertain whether it needs the binding, and a
 * false positive here would abort a legitimate capture.
 */
const NATIVE_SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|php|go|rs|java|kt|swift|rb|cs|scala|c|cpp|cc|cxx|h|hpp)$/;

const NATIVE_BUILD_HINT =
  '@liendev/parser-native is almost certainly not built in this worktree, so ' +
  'every AST-language file was silently dropped (performChunkOnlyIndex still ' +
  'reports success). Build it with `npm run build:native -w @liendev/parser-native` ' +
  'and re-run.';

/**
 * Guard against a silent partial index. When the native parser can't load, the
 * scan still finds every file but `chunkFile` throws per-file; those errors are
 * swallowed and only markdown/Vue chunks survive, yet the overall result is
 * `success: true`. Persisting that produces a fixture whose corpus is missing
 * all source code — the agent then "reviews" a diff it has no context for.
 * The fatal signature is a corpus with ZERO source-code chunks anywhere —
 * that never happens with a working binding, even on docs-only PRs, because
 * repoChunks spans the whole repo. A changed source file that individually
 * produced zero chunks is only a WARNING: files with no chunkable top-level
 * declarations (e.g. a VitePress config that is a single `export default`
 * expression) legitimately chunk to zero and must not abort a healthy
 * capture (false positive observed on PR #716's .vitepress/config.ts).
 */
async function assertIndexComplete(
  repoChunks: Array<{ metadata: { file: string } }>,
  changedFiles: string[],
  worktree: string,
): Promise<void> {
  const sourceChunks = repoChunks.filter(c => NATIVE_SOURCE_EXT.test(c.metadata.file)).length;
  if (sourceChunks === 0) {
    throw new Error(
      `partial index: ${repoChunks.length} chunks captured but zero from AST source ` +
        `files. ${NATIVE_BUILD_HINT}`,
    );
  }
  const indexed = new Set(repoChunks.map(c => toRepoRelative(c.metadata.file, worktree)));
  const missing: string[] = [];
  for (const f of changedFiles) {
    const rel = toRepoRelative(f, worktree);
    if (!NATIVE_SOURCE_EXT.test(rel) || indexed.has(rel)) continue;
    let size = 0;
    try {
      size = (await fs.stat(join(worktree, rel))).size;
    } catch {
      continue; // deleted at this SHA: legitimately absent, skip
    }
    if (size > 0) missing.push(rel);
  }
  if (missing.length > 0) {
    console.error(
      `[capture] warning: ${missing.length} changed source file(s) produced zero chunks ` +
        `(${missing.slice(0, 3).join(', ')}). The corpus has ${sourceChunks} source chunks, ` +
        `so the binding works — likely declaration-free files. Verify they matter to the fixture.`,
    );
  }
}

/** Index the worktree and return both repo-wide chunks and the
 * subset belonging to the PR's changed files. */
async function indexCapturedWorktree(worktree: string, changedFiles: string[]) {
  console.error(`[capture] indexing worktree at ${worktree}`);
  const indexResult = await performChunkOnlyIndex(worktree);
  if (!indexResult.success || !indexResult.chunks) {
    throw new Error(`index failed: ${indexResult.error ?? 'unknown'}`);
  }
  const repoChunks = indexResult.chunks;
  console.error(`[capture] indexed ${repoChunks.length} chunks`);
  await assertIndexComplete(repoChunks, changedFiles, worktree);

  // Path-shape between the parser's chunk metadata and `gh pr view`'s file
  // list isn't guaranteed to match byte-for-byte (Windows backslashes,
  // ./ prefixes, absolute vs. repo-relative). Normalize both sides to
  // repo-relative POSIX form before set membership.
  const changedSet = new Set(changedFiles.map(f => toRepoRelative(f, worktree)));
  const chunks = repoChunks.filter(c => changedSet.has(toRepoRelative(c.metadata.file, worktree)));
  console.error(`[capture] ${chunks.length} chunks for changed files`);
  return { repoChunks, chunks };
}

/** Run real complexity analysis on the changed files so the captured
 * ctx matches what the production runner would build. Falls back to an
 * empty report shape if analysis returns nothing.
 *
 * Limitation: we don't check out the base ref, so `deltas` stays null —
 * the runner computes deltas by diffing head vs base reports. For
 * delta-aware fidelity, capture via the engine's
 * LIEN_REVIEW_CAPTURE_CTX env hook against a live runner instead.
 */
async function analyzeCapturedComplexity(changedFiles: string[], worktree: string) {
  console.error(`[capture] analyzing complexity for ${changedFiles.length} changed files`);
  const result = await runComplexityAnalysis(changedFiles, '50', worktree, silentLogger);
  const report = result?.report ?? {
    summary: {
      filesAnalyzed: changedFiles.length,
      totalViolations: 0,
      bySeverity: { error: 0, warning: 0 },
      avgComplexity: 0,
      maxComplexity: 0,
    },
    files: {},
  };
  console.error(
    `[capture] complexity: ${report.summary.totalViolations} violations, max=${report.summary.maxComplexity}`,
  );
  return report;
}

interface CaptureInputs {
  meta: PrMeta;
  prNumber: number;
  headSha: string;
  outputPath: string;
  patches: Map<string, string>;
  diffLines: Map<string, Set<number>>;
  changedFiles: string[];
}

async function captureFixtureFromWorktree(worktree: string, inputs: CaptureInputs): Promise<void> {
  const { repoChunks, chunks } = await indexCapturedWorktree(worktree, inputs.changedFiles);
  const complexityReport = await analyzeCapturedComplexity(inputs.changedFiles, worktree);
  const ctx = {
    chunks,
    changedFiles: inputs.changedFiles,
    allChangedFiles: inputs.changedFiles,
    complexityReport,
    baselineReport: null,
    deltas: null,
    pluginConfigs: {},
    config: {},
    pr: {
      owner: 'getlien',
      repo: 'lien',
      pullNumber: inputs.prNumber,
      title: inputs.meta.title,
      body: inputs.meta.body ?? '',
      baseSha: inputs.meta.baseRefOid,
      headSha: inputs.headSha,
      patches: inputs.patches,
      diffLines: inputs.diffLines,
    },
    repoChunks,
    repoRootDir: worktree,
  };
  await fs.mkdir(dirname(inputs.outputPath), { recursive: true });
  await saveFixture(ctx, inputs.outputPath);
  console.error(`[capture] wrote ${inputs.outputPath}`);
}

async function main(): Promise<void> {
  const { prNumber, outputPath, shaOverride } = parseArgs(process.argv.slice(2));

  console.error(`[capture] fetching PR ${prNumber} metadata`);
  const meta = JSON.parse(
    sh(`gh pr view ${prNumber} --json title,body,baseRefOid,headRefOid,files`),
  ) as PrMeta;

  const headSha = shaOverride ? resolveSha(shaOverride) : meta.headRefOid;
  if (shaOverride) {
    assertShaInPrRange(meta, prNumber, headSha);
    console.error(`[capture] overriding head: ${meta.headRefOid} -> ${headSha}`);
  }

  const { diffText, changedFiles } = selectDiffSource(meta, prNumber, headSha, shaOverride);
  const { patches, diffLines } = parseUnifiedDiff(diffText);

  await withWorktree(headSha, worktree =>
    captureFixtureFromWorktree(worktree, {
      meta,
      prNumber,
      headSha,
      outputPath,
      patches,
      diffLines,
      changedFiles,
    }),
  );
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
