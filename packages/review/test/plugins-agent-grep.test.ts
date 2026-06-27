import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { grepCodebase } from '../src/plugins/agent/agent-tools.js';
import { buildDependencyGraph } from '../src/dependency-graph.js';
import { silentLogger } from '../src/test-helpers.js';
import type { AgentToolContext } from '../src/plugins/agent/types.js';

/** Parsed shape of grepCodebase's JSON return. */
interface GrepResult {
  results?: Array<{ filepath: string; line: number; match: string }>;
  count?: number;
  truncated?: boolean;
  error?: string;
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

function ctxFor(repoRootDir: string): AgentToolContext {
  return {
    repoChunks: [],
    repoRootDir,
    graph: buildDependencyGraph([]),
    logger: silentLogger,
  };
}

async function runGrep(repoRootDir: string, pattern: string): Promise<GrepResult> {
  return JSON.parse(await grepCodebase({ pattern }, ctxFor(repoRootDir))) as GrepResult;
}

describe('grepCodebase — real working-tree search', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-grep-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds references in non-code files (the bug fix): YAML, JSON, Markdown, and CI workflows', async () => {
    const SYM = 'OpenRouterClient';
    await write(root, 'src/app.ts', `export class ${SYM} {}\n`);
    await write(root, '.github/workflows/ci.yml', `jobs:\n  run: node -e "${SYM}"\n`); // dot-dir
    await write(root, 'config.json', `{ "client": "${SYM}" }\n`);
    await write(root, 'README.md', `This project uses ${SYM} for routing.\n`);

    const res = await runGrep(root, SYM);
    const files = new Set((res.results ?? []).map(r => r.filepath));

    expect(res.error).toBeUndefined();
    expect(files).toContain('src/app.ts');
    expect(files).toContain(path.join('.github', 'workflows', 'ci.yml'));
    expect(files).toContain('config.json');
    expect(files).toContain('README.md');
  });

  it('respects .gitignore (files and dirs), prunes node_modules, and skips binary files', async () => {
    const SYM = 'OpenRouterClient';
    await write(root, 'src/app.ts', `const x = '${SYM}';\n`);
    await write(root, '.gitignore', 'secret.txt\ncoverage/\n');
    await write(root, 'secret.txt', `${SYM} should be ignored\n`); // gitignored file
    await write(root, 'coverage/report.txt', `${SYM} in ignored dir\n`); // gitignored dir, pruned in walk
    await write(root, 'node_modules/foo/index.js', `${SYM}\n`); // pruned + always-ignored
    // Binary: an embedded NUL byte trips the binary guard.
    await write(root, 'bin.dat', `\0${SYM}\0`);

    const res = await runGrep(root, SYM);
    const files = new Set((res.results ?? []).map(r => r.filepath));

    expect(files).toContain('src/app.ts');
    expect(files).not.toContain('secret.txt');
    expect(files).not.toContain(path.join('coverage', 'report.txt'));
    expect(files).not.toContain(path.join('node_modules', 'foo', 'index.js'));
    expect(files).not.toContain('bin.dat');
  });

  it('follows in-repo file symlinks but skips out-of-repo, directory, and broken links', async () => {
    const SYM = 'OpenRouterClient';
    // Real target inside the repo, plus a symlink to it → should be followed.
    await write(root, 'shared/config.ts', `export const c = '${SYM}';\n`);
    await fs.symlink(path.join(root, 'shared', 'config.ts'), path.join(root, 'linked-config.ts'));

    // Symlink to a file OUTSIDE the repo → must be skipped (no escape).
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-grep-out-'));
    await write(outside, 'secrets.ts', `const leak = '${SYM}';\n`);
    await fs.symlink(path.join(outside, 'secrets.ts'), path.join(root, 'escape.ts'));

    // Directory symlink → skipped (cycle/escape guard).
    await write(root, 'realdir/inside.ts', `const d = '${SYM}';\n`);
    await fs.symlink(path.join(root, 'realdir'), path.join(root, 'linkdir'));

    // Broken symlink → skipped.
    await fs.symlink(path.join(root, 'does-not-exist.ts'), path.join(root, 'broken.ts'));

    try {
      const res = await runGrep(root, SYM);
      const files = new Set((res.results ?? []).map(r => r.filepath));

      expect(files).toContain('linked-config.ts'); // followed in-repo file symlink
      expect(files).toContain(path.join('shared', 'config.ts')); // and the real target
      expect(files).not.toContain('escape.ts'); // out-of-repo target excluded
      expect([...files]).not.toContain(path.join('linkdir', 'inside.ts')); // dir symlink not traversed
      expect(files).not.toContain('broken.ts'); // broken link excluded
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('matches anywhere on very long lines (no length clipping)', async () => {
    // Needle sits well past 2000 chars — full-line matching must still find it.
    await write(root, 'long.ts', `const x = '${'a'.repeat(4000)}NEEDLE';\n`);
    const res = await runGrep(root, 'NEEDLE');
    const files = new Set((res.results ?? []).map(r => r.filepath));
    expect(files).toContain('long.ts');
  });

  it('does not scan a gitignored target reached via a non-ignored symlink', async () => {
    const SYM = 'OpenRouterClient';
    await write(root, '.gitignore', 'private/\n');
    await write(root, 'private/secret.ts', `const s = '${SYM}';\n`); // gitignored target
    await fs.symlink(path.join(root, 'private', 'secret.ts'), path.join(root, 'link.ts')); // link not ignored
    await write(root, 'ok.ts', `const k = '${SYM}';\n`); // control match

    const res = await runGrep(root, SYM);
    const files = new Set((res.results ?? []).map(r => r.filepath));
    expect(files).toContain('ok.ts');
    expect(files).not.toContain('link.ts'); // .gitignore not bypassed via the symlink
  });

  it('reports true 1-based file line numbers', async () => {
    await write(root, 'multi.ts', 'line one\nNEEDLE here\nline three\n');
    const res = await runGrep(root, 'NEEDLE');
    expect(res.results).toHaveLength(1);
    expect(res.results![0]).toMatchObject({ filepath: 'multi.ts', line: 2 });
  });

  it('caps results and flags truncation only when matches exceed the cap', async () => {
    // 50 matching lines — well over the internal cap (30) → truncated.
    const lines = Array.from({ length: 50 }, (_, i) => `match ${i} HIT`).join('\n');
    await write(root, 'many.ts', lines);

    const res = await runGrep(root, 'HIT');
    expect(res.truncated).toBe(true);
    expect(res.count).toBe(30);
    expect(res.results).toHaveLength(30);
  });

  it('does not flag truncation when matches exactly equal the cap', async () => {
    // Exactly 30 matches and nothing dropped → truncated must be false.
    const lines = Array.from({ length: 30 }, (_, i) => `match ${i} HIT`).join('\n');
    await write(root, 'exact.ts', lines);

    const res = await runGrep(root, 'HIT');
    expect(res.count).toBe(30);
    expect(res.truncated).toBe(false);
  });

  it('returns a clean error for an invalid regex instead of throwing', async () => {
    await write(root, 'a.ts', 'anything\n');
    const res = await runGrep(root, '(');
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/invalid regex/i);
  });

  it('requires a pattern', async () => {
    const res = JSON.parse(await grepCodebase({}, ctxFor(root))) as GrepResult;
    expect(res.error).toBe('pattern is required');
  });
});
