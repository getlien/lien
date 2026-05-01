#!/usr/bin/env tsx
/**
 * One-off capture driver: snapshot a closed/historic PR's ReviewContext
 * for use as a harness fixture, without running the agent plugin.
 *
 * Uses a git worktree to avoid touching the current working branch.
 *
 * Usage:
 *   tsx capture-pr.ts <pr-number> <output-fixture-path>
 *
 * Prerequisites:
 *   - gh CLI authenticated
 *   - Run from the lien monorepo root
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';

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
    let currentNew = 0;
    for (const line of block.split('\n')) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentNew = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lines.add(currentNew);
        currentNew++;
      } else if (line.startsWith(' ')) {
        currentNew++;
      } else if (line.startsWith('-')) {
        // deletion: don't advance new-line counter
      }
    }
    diffLines.set(path, lines);
  }
  return { patches, diffLines };
}

/** Normalize a repo-relative path for set membership checks. */
function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
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

async function main(): Promise<void> {
  const [prArg, outArg] = process.argv.slice(2);
  if (!prArg || !outArg) {
    console.error('Usage: tsx capture-pr.ts <pr-number> <output-fixture-path>');
    process.exit(2);
  }

  const prNumber = parseInt(prArg, 10);
  const outputPath = resolve(outArg);

  console.error(`[capture] fetching PR ${prNumber} metadata`);
  const meta = JSON.parse(
    sh(`gh pr view ${prNumber} --json title,body,baseRefOid,headRefOid,files`),
  ) as PrMeta;

  console.error(`[capture] fetching PR ${prNumber} diff`);
  const diffText = sh(`gh pr diff ${prNumber}`);

  const { patches, diffLines } = parseUnifiedDiff(diffText);
  const changedFiles = meta.files.map(f => f.path);

  await withWorktree(meta.headRefOid, async worktree => {
    console.error(`[capture] indexing worktree at ${worktree}`);
    const indexResult = await performChunkOnlyIndex(worktree);
    if (!indexResult.success || !indexResult.chunks) {
      throw new Error(`index failed: ${indexResult.error ?? 'unknown'}`);
    }
    const repoChunks = indexResult.chunks;
    console.error(`[capture] indexed ${repoChunks.length} chunks`);

    // Path-shape between the parser's chunk metadata and `gh pr view`'s file
    // list isn't guaranteed to match byte-for-byte (Windows backslashes,
    // ./ prefixes). Normalize both sides before set membership.
    const changedSet = new Set(changedFiles.map(normalizeRepoPath));
    const chunks = repoChunks.filter(c => changedSet.has(normalizeRepoPath(c.metadata.file)));
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
        headSha: meta.headRefOid,
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
