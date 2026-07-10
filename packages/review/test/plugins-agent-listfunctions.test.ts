import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';

import { listFunctions } from '../src/plugins/agent/agent-tools.js';
import { buildDependencyGraph } from '../src/dependency-graph.js';
import { createTestChunk, silentLogger } from '../src/test-helpers.js';
import type { AgentToolContext } from '../src/plugins/agent/types.js';

/** Parsed shape of listFunctions' JSON return. */
interface ListFnResult {
  results?: Array<{ symbolName: string; symbolType: string | null; filepath: string }>;
  count?: number;
  error?: string;
}

function ctxWith(repoChunks: CodeChunk[]): AgentToolContext {
  return {
    repoChunks,
    repoRootDir: '/tmp/does-not-matter',
    graph: buildDependencyGraph([]),
    logger: silentLogger,
  };
}

function run(repoChunks: CodeChunk[], input: Record<string, unknown> = {}): ListFnResult {
  return JSON.parse(listFunctions(input, ctxWith(repoChunks))) as ListFnResult;
}

const codeChunk = createTestChunk({
  metadata: {
    file: 'src/foo.ts',
    startLine: 1,
    endLine: 5,
    type: 'function',
    symbolName: 'doThing',
    symbolType: 'function',
    language: 'typescript',
  },
});

// A markdown 'doc' chunk carries a heading-breadcrumb symbolName (0.64.0+) but is
// prose, not a code symbol. It must not appear in list_functions results.
const docChunk = createTestChunk({
  content: '## Install\n\nRun the installer.\n',
  metadata: {
    file: 'README.md',
    startLine: 1,
    endLine: 10,
    type: 'doc',
    symbolName: 'Guide > Install',
    language: 'markdown',
  },
});

describe('listFunctions — markdown doc chunks are not treated as symbols', () => {
  it('lists real code symbols but excludes doc-heading breadcrumbs', () => {
    const res = run([codeChunk, docChunk]);
    const names = (res.results ?? []).map(r => r.symbolName);

    expect(res.error).toBeUndefined();
    expect(names).toContain('doThing');
    expect(names).not.toContain('Guide > Install');
    expect(res.count).toBe(1);
  });

  it('returns no results when the repo has only doc chunks', () => {
    const res = run([docChunk]);
    expect(res.count).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('excludes doc chunks even when a pattern would otherwise match their breadcrumb', () => {
    const res = run([codeChunk, docChunk], { pattern: 'Install' });
    const names = (res.results ?? []).map(r => r.symbolName);
    expect(names).not.toContain('Guide > Install');
    expect(res.count).toBe(0);
  });
});
