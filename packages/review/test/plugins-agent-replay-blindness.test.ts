import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { grepCodebase, readFile } from '../src/plugins/agent/agent-tools.js';
import { buildDependencyGraph } from '../src/dependency-graph.js';
import { silentLogger } from '../src/test-helpers.js';
import type { AgentToolContext } from '../src/plugins/agent/types.js';

interface ToolResult {
  unavailable?: boolean;
  reason?: string;
  error?: string;
  count?: number;
  content?: string;
}

function ctxFor(repoRootDir: string): AgentToolContext {
  return {
    repoChunks: [],
    repoRootDir,
    graph: buildDependencyGraph([]),
    logger: silentLogger,
  };
}

const MISSING_ROOT = path.join(os.tmpdir(), 'lien-replay-gone-9d3f1a2b', 'pr-head');

describe('agent tools — loud behavior when the working tree is unavailable (replay)', () => {
  it('grep_codebase reports unavailable instead of a silent empty result', async () => {
    const res = JSON.parse(
      await grepCodebase({ pattern: 'anything' }, ctxFor(MISSING_ROOT)),
    ) as ToolResult;
    expect(res.unavailable).toBe(true);
    expect(res.count).toBe(0);
    expect(res.reason).toMatch(/not available/i);
    expect(res.reason).toMatch(/stale_literal_candidates/); // points at the deterministic signals
  });

  it('read_file reports unavailable when the whole tree is gone', async () => {
    const res = JSON.parse(
      await readFile({ filepath: 'src/app.ts' }, ctxFor(MISSING_ROOT)),
    ) as ToolResult;
    expect(res.unavailable).toBe(true);
    expect(res.reason).toMatch(/not available/i);
  });
});

describe('agent tools — real tree still behaves normally (no regression)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-replay-real-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('grep_codebase finds a real match (not flagged unavailable)', async () => {
    await fs.writeFile(path.join(root, 'app.ts'), "const m = 'claude-sonnet-4-6';\n", 'utf-8');
    const res = JSON.parse(
      await grepCodebase({ pattern: 'claude-sonnet-4-6' }, ctxFor(root)),
    ) as ToolResult;
    expect(res.unavailable).toBeUndefined();
    expect(res.count).toBe(1);
  });

  it('read_file returns a real 404 (not unavailable) when only the file is missing', async () => {
    const res = JSON.parse(await readFile({ filepath: 'nope.ts' }, ctxFor(root))) as ToolResult;
    expect(res.unavailable).toBeUndefined();
    expect(res.error).toMatch(/File not found/);
  });

  it('read_file returns content for an existing file', async () => {
    await fs.writeFile(path.join(root, 'app.ts'), 'line one\nline two\n', 'utf-8');
    const res = JSON.parse(await readFile({ filepath: 'app.ts' }, ctxFor(root))) as ToolResult;
    expect(res.unavailable).toBeUndefined();
    expect(res.content).toContain('line one');
  });
});
