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
import { resolve, dirname } from 'node:path';

import { performChunkOnlyIndex } from '@liendev/parser';

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

async function withWorktree<T>(sha: string, fn: (path: string) => Promise<T>): Promise<T> {
  const wtPath = `/tmp/lien-capture-${sha.slice(0, 12)}`;
  // If a previous capture left this worktree in place, reuse it. Otherwise create.
  try {
    sh(`git worktree add --detach "${wtPath}" "${sha}"`);
  } catch {
    // assume it already exists (re-running capture is fine)
  }
  // We deliberately do NOT remove the worktree — the captured fixture's
  // repoRootDir points here, so harness runs that need read_file/grep_codebase
  // against the PR head still work. Clean up manually with:
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

    const chunks = repoChunks.filter(c => changedFiles.includes(c.metadata.file));
    console.error(`[capture] ${chunks.length} chunks for changed files`);

    const ctx = {
      chunks,
      changedFiles,
      allChangedFiles: changedFiles,
      complexityReport: {
        summary: {
          filesAnalyzed: changedFiles.length,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 0,
          maxComplexity: 0,
        },
        files: {},
      },
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
