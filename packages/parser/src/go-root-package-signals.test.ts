import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  findGoRootPackageDependents,
  buildGoRootPackageIndex,
  resolveGoRootPackageDependents,
  isRootLevelGoFile,
} from './go-root-package-signals.js';
import { clearGoModuleCache, resolveGoModulePrefix } from './go-module.js';
import type { CodeChunk } from './types.js';

// Wraps (not replaces) `resolveGoModulePrefix` with a spy so the perf-guard
// tests below can observe whether `buildGoRootPackageIndex` -- whose very
// first statement calls this function -- ran at all, while every other test
// in this file keeps getting the real go.mod-reading behavior unchanged.
vi.mock('./go-module.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./go-module.js')>();
  return { ...actual, resolveGoModulePrefix: vi.fn(actual.resolveGoModulePrefix) };
});

const MODULE_PREFIX = 'github.com/go-chi/chi/v5';

interface ChunkOptions {
  file: string;
  exports?: string[];
  imports?: string[];
  callSites?: string[];
}

function makeChunk(opts: ChunkOptions): CodeChunk {
  return {
    content: '',
    metadata: {
      file: opts.file,
      startLine: 1,
      endLine: 10,
      type: 'function',
      language: 'go',
      exports: opts.exports,
      imports: opts.imports,
      callSites: opts.callSites?.map((symbol, i) => ({ symbol, line: i + 1 })),
    },
  };
}

describe('findGoRootPackageDependents', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-go-root-pkg-'));
    await fs.writeFile(path.join(workspaceRoot, 'go.mod'), `module ${MODULE_PREFIX}\n\ngo 1.21\n`);
  });

  afterEach(async () => {
    clearGoModuleCache();
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("recovers a subpackage file that calls a root file's uniquely-exported, distinctive symbol via a bare self-import", () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext', 'NewRouteContext'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    expect(findGoRootPackageDependents('context.go', chunks, workspaceRoot)).toEqual([
      'middleware/clean_path.go',
    ]);
  });

  it("does not credit a referencer that never calls any of the target root file's exports", () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({
        file: 'middleware/unrelated.go',
        imports: [MODULE_PREFIX],
        callSites: ['SomethingElse'],
      }),
    ];

    expect(findGoRootPackageDependents('context.go', chunks, workspaceRoot)).toEqual([]);
  });

  it('does not credit a file that never imports the bare module root at all (coincidental symbol-name match only)', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({ file: 'unrelated/other.go', callSites: ['RouteContext'] }),
    ];

    expect(findGoRootPackageDependents('context.go', chunks, workspaceRoot)).toEqual([]);
  });

  it('never fabricates a false hub: two unrelated root files return disjoint dependent lists (#1056 failure shape)', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({ file: 'chi.go', exports: ['NewRouter'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
      makeChunk({
        file: 'middleware/profiler.go',
        imports: [MODULE_PREFIX],
        callSites: ['NewRouter'],
      }),
    ];

    const contextDeps = findGoRootPackageDependents('context.go', chunks, workspaceRoot);
    const chiDeps = findGoRootPackageDependents('chi.go', chunks, workspaceRoot);

    expect(contextDeps).toEqual(['middleware/clean_path.go']);
    expect(chiDeps).toEqual(['middleware/profiler.go']);
    expect(contextDeps).not.toEqual(chiDeps);
  });

  it("never guesses when a symbol is exported by more than one root file (e.g. chi's own ServeHTTP, declared by both chain.go and mux.go)", () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'chain.go', exports: ['ServeHTTP'] }),
      makeChunk({ file: 'mux.go', exports: ['ServeHTTP'] }),
      makeChunk({
        file: 'middleware/whatever.go',
        imports: [MODULE_PREFIX],
        callSites: ['ServeHTTP'],
      }),
    ];

    expect(findGoRootPackageDependents('chain.go', chunks, workspaceRoot)).toEqual([]);
    expect(findGoRootPackageDependents('mux.go', chunks, workspaceRoot)).toEqual([]);
  });

  it('excludes single-segment, non-distinctive export names from candidacy (the Use/Get/Post false-positive risk)', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'mux.go', exports: ['Use', 'Get', 'Post'] }),
      makeChunk({
        file: 'unrelated/builder.go',
        imports: [MODULE_PREFIX],
        callSites: ['Use'],
      }),
    ];

    expect(findGoRootPackageDependents('mux.go', chunks, workspaceRoot)).toEqual([]);
  });

  it('only considers root-level files -- a subpackage file cannot own an export via this signal', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'middleware/logger.go', exports: ['LogEntry'] }),
      makeChunk({
        file: 'middleware/other.go',
        imports: [MODULE_PREFIX],
        callSites: ['LogEntry'],
      }),
    ];

    expect(findGoRootPackageDependents('middleware/logger.go', chunks, workspaceRoot)).toEqual([]);
  });

  it('is a no-op for a non-Go-module workspace (no go.mod)', async () => {
    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-go-root-pkg-bare-'));
    try {
      const chunks: CodeChunk[] = [
        makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
        makeChunk({
          file: 'middleware/clean_path.go',
          imports: [MODULE_PREFIX],
          callSites: ['RouteContext'],
        }),
      ];
      expect(findGoRootPackageDependents('context.go', chunks, bareDir)).toEqual([]);
    } finally {
      clearGoModuleCache();
      await fs.rm(bareDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('is a no-op for a non-Go target file', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    expect(findGoRootPackageDependents('src/context.ts', chunks, workspaceRoot)).toEqual([]);
  });

  it('build-once/resolve-many index gives the same result as the convenience wrapper', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    const index = buildGoRootPackageIndex(chunks, workspaceRoot);
    expect(resolveGoRootPackageDependents('context.go', index)).toEqual([
      'middleware/clean_path.go',
    ]);
  });
});

describe('findGoRootPackageDependents root-level guard (perf: no project-wide scan for a non-root target)', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-go-root-pkg-guard-'));
    await fs.writeFile(path.join(workspaceRoot, 'go.mod'), `module ${MODULE_PREFIX}\n\ngo 1.21\n`);
    vi.mocked(resolveGoModulePrefix).mockClear();
  });

  afterEach(async () => {
    clearGoModuleCache();
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("short-circuits for a non-root-level Go target WITHOUT building the project-wide index -- resolveGoModulePrefix (buildGoRootPackageIndex's own first statement) never runs", () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    expect(findGoRootPackageDependents('middleware/clean_path.go', chunks, workspaceRoot)).toEqual(
      [],
    );
    expect(resolveGoModulePrefix).not.toHaveBeenCalled();
  });

  it('sanity check: the same spy DOES fire for a genuine root-level query (proves the assertion above pins a real guard, not a broken mock)', () => {
    const chunks: CodeChunk[] = [
      makeChunk({ file: 'context.go', exports: ['RouteContext'] }),
      makeChunk({
        file: 'middleware/clean_path.go',
        imports: [MODULE_PREFIX],
        callSites: ['RouteContext'],
      }),
    ];

    expect(findGoRootPackageDependents('context.go', chunks, workspaceRoot)).toEqual([
      'middleware/clean_path.go',
    ]);
    expect(resolveGoModulePrefix).toHaveBeenCalledWith(workspaceRoot);
  });

  it('isRootLevelGoFile correctly distinguishes a root file from a subpackage file and a non-Go file', () => {
    expect(isRootLevelGoFile('context.go')).toBe(true);
    expect(isRootLevelGoFile('middleware/clean_path.go')).toBe(false);
    expect(isRootLevelGoFile('src/context.ts')).toBe(false);
  });
});
