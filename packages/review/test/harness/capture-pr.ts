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
function parseUnifiedDiff(diff: string): {
  patches: Map<string, string>;
  diffLines: Map<string, Set<number>>;
} {
  const patches = new Map<string, string>();
  const diffLines = new Map<string, Set<number>>();
  const fileBlocks = diff.split(/^diff --git /m).slice(1);
  for (const block of fileBlocks) {
    const headerMatch = block.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!headerMatch) continue;
    const path = headerMatch[2];
    const body = `diff --git ${block}`.trimEnd();
    patches.set(path, body);

    const lines = new Set<number>();
    let currentLine = 0; // overwritten by the first hunk header
    for (const line of block.split('\n')) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith('+') || line.startsWith(' ')) {
        if (!line.startsWith('+++')) {
          lines.add(currentLine);
          currentLine++;
        }
      }
      // `-` lines don't advance currentLine (post-image counter).
    }
    diffLines.set(path, lines);
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
  const [prArg, outArg] = positional;
  if (!prArg || !outArg) {
    console.error(
      'Usage: tsx capture-pr.ts <pr-number> <output-fixture-path> [--sha <commit-sha>]',
    );
    process.exit(2);
  }
  const prNumber = parseInt(prArg, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`pr-number must be a positive integer (got: ${prArg})`);
    process.exit(2);
  }
  return { prNumber, outputPath: resolve(outArg), shaOverride };
}

/**
 * Resolve a possibly-short SHA to its full 40-char form via the current
 * checkout's git data. Throws if the SHA isn't reachable — gives a
 * clearer error than a downstream `git worktree add` failure.
 */
function resolveSha(sha: string): string {
  try {
    return sh(`git rev-parse --verify "${sha}^{commit}"`).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not resolve sha "${sha}": ${reason}`);
  }
}

async function main(): Promise<void> {
  const { prNumber, outputPath, shaOverride } = parseArgs(process.argv.slice(2));

  console.error(`[capture] fetching PR ${prNumber} metadata`);
  const meta = JSON.parse(
    sh(`gh pr view ${prNumber} --json title,body,baseRefOid,headRefOid,files`),
  ) as PrMeta;

  const headSha = shaOverride ? resolveSha(shaOverride) : meta.headRefOid;
  if (shaOverride) {
    console.error(`[capture] overriding head: ${meta.headRefOid} -> ${headSha}`);
  }

  let diffText: string;
  let changedFiles: string[];
  if (shaOverride) {
    // PR-level files include all commits; recompute against the target sha
    // so the captured fixture reflects only the diff up to that commit.
    console.error(`[capture] computing diff ${meta.baseRefOid}..${headSha}`);
    diffText = sh(`git diff "${meta.baseRefOid}".."${headSha}"`);
    changedFiles = sh(`git diff --name-only "${meta.baseRefOid}".."${headSha}"`)
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  } else {
    console.error(`[capture] fetching PR ${prNumber} diff`);
    diffText = sh(`gh pr diff ${prNumber}`);
    changedFiles = meta.files.map(f => f.path);
  }

  const { patches, diffLines } = parseUnifiedDiff(diffText);

  await withWorktree(headSha, async worktree => {
    console.error(`[capture] indexing worktree at ${worktree}`);
    const indexResult = await performChunkOnlyIndex(worktree);
    if (!indexResult.success || !indexResult.chunks) {
      throw new Error(`index failed: ${indexResult.error ?? 'unknown'}`);
    }
    const repoChunks = indexResult.chunks;
    console.error(`[capture] indexed ${repoChunks.length} chunks`);

    // Path-shape between the parser's chunk metadata and `gh pr view`'s file
    // list isn't guaranteed to match byte-for-byte (Windows backslashes,
    // ./ prefixes, absolute vs. repo-relative). Normalize both sides to
    // repo-relative POSIX form before set membership.
    const changedSet = new Set(changedFiles.map(f => toRepoRelative(f, worktree)));
    const chunks = repoChunks.filter(c =>
      changedSet.has(toRepoRelative(c.metadata.file, worktree)),
    );
    console.error(`[capture] ${chunks.length} chunks for changed files`);

    // Real complexity analysis on the changed files so the captured ctx
    // matches what the production runner would build. Without this,
    // complexity-aware rules (e.g. blast-radius risk) see an empty report
    // and behave differently than they would in prod.
    //
    // Limitation: we don't check out the base ref, so `deltas` stays null —
    // the runner computes deltas by diffing head vs base reports. For
    // delta-aware fidelity, capture via the engine's
    // LIEN_REVIEW_CAPTURE_CTX env hook against a live runner instead.
    console.error(`[capture] analyzing complexity for ${changedFiles.length} changed files`);
    const complexityResult = await runComplexityAnalysis(
      changedFiles,
      '50',
      worktree,
      silentLogger,
    );
    const complexityReport = complexityResult?.report ?? {
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
      `[capture] complexity: ${complexityReport.summary.totalViolations} violations, max=${complexityReport.summary.maxComplexity}`,
    );

    const ctx = {
      chunks,
      changedFiles,
      allChangedFiles: changedFiles,
      complexityReport,
      baselineReport: null,
      deltas: null,
      pluginConfigs: {},
      config: {},
      pr: {
        owner: 'getlien',
        repo: 'lien',
        pullNumber: prNumber,
        title: meta.title,
        body: meta.body ?? '',
        baseSha: meta.baseRefOid,
        headSha,
        patches,
        diffLines,
      },
      repoChunks,
      repoRootDir: worktree,
    };

    await fs.mkdir(dirname(outputPath), { recursive: true });
    await saveFixture(ctx, outputPath);
    console.error(`[capture] wrote ${outputPath}`);
  });
}

main().catch(err => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
