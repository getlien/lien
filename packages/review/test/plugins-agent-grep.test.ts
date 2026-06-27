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

  it('reports true 1-based file line numbers', async () => {
    await write(root, 'multi.ts', 'line one\nNEEDLE here\nline three\n');
    const res = await runGrep(root, 'NEEDLE');
    expect(res.results).toHaveLength(1);
    expect(res.results![0]).toMatchObject({ filepath: 'multi.ts', line: 2 });
  });

  it('caps results and flags truncation', async () => {
    // 50 matching lines in a single file — more than the internal cap (30).
    const lines = Array.from({ length: 50 }, (_, i) => `match ${i} HIT`).join('\n');
    await write(root, 'many.ts', lines);

    const res = await runGrep(root, 'HIT');
    expect(res.truncated).toBe(true);
    expect(res.count).toBe(30);
    expect(res.results).toHaveLength(30);
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
