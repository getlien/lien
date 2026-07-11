import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nodeFs from 'node:fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { performChunkOnlyIndex } from './chunk-only-index.js';
import { clearParserCache } from './ast/parser.js';

/**
 * Companion to chunker-native-load.test.ts, one level up the call stack.
 *
 * chunker.ts already re-throws a NativeBindingLoadError past its `astFallback`
 * catch, but `performChunkOnlyIndex` wraps every file in
 * `chunkFileForCollection`'s own try/catch, which historically returned
 * `false` for ANY thrown error. A missing native binding throws that error
 * for EVERY AST-language file, so the per-file catch would swallow all of
 * them and `performChunkOnlyIndex` would still report `success: true` on a
 * corpus containing only the format-specific chunkers' output
 * (markdown/Liquid/Vue) -- a silently partial index. This is the exact
 * failure mode the harness's `assertIndexComplete` guard (PR #722) had to
 * paper over from the outside.
 *
 * The fix makes `chunkFileForCollection` re-throw a NativeBindingLoadError
 * (mirroring chunker.ts) so it propagates to `performChunkOnlyIndex`'s outer
 * handler, which surfaces it as `{ success: false, error }`. Per-file parse
 * or read errors (anything that is NOT a NativeBindingLoadError) still skip
 * the file and keep the run going -- see the sibling test in
 * chunk-only-index.test.ts.
 *
 * Lives in its own file (not alongside chunk-only-index.test.ts) so the
 * fs.existsSync mock below runs before any successful native load memoizes a
 * binding handle in ast/parser.ts's module-level cache -- a memoized success
 * would short-circuit the mock (clearParserCache only resets the failure
 * cache, not the success handle). Same ordering note as
 * chunker-native-load.test.ts / ast/parser.test.ts.
 */
describe('performChunkOnlyIndex native-load failure (fail fast, no silent partial index)', () => {
  let testDir: string;

  beforeEach(async () => {
    clearParserCache();
    testDir = path.join(
      os.tmpdir(),
      `lien-native-load-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearParserCache();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('reports success:false with an actionable error instead of a partial success', async () => {
    const file = path.join(testDir, 'sample.ts');
    await fs.writeFile(file, 'export function sample() { return 42; }');

    // Force the native binding lookup (findPackageDir) to fail, simulating a
    // platform/worktree where @liendev/parser-native was never built.
    vi.spyOn(nodeFs, 'existsSync').mockReturnValue(false);

    // Must resolve (never reject) -- performChunkOnlyIndex's contract is a
    // ChunkOnlyResult, and every caller branches on `.success`.
    const result = await performChunkOnlyIndex(testDir, { filesToIndex: [file] });

    expect(result.success).toBe(false);
    expect(result.chunksCreated).toBe(0);
    expect(result.chunks).toHaveLength(0);
    // The actionable remedy is threaded all the way up from ast/parser.ts.
    expect(result.error).toContain('@liendev/parser-native');
    expect(result.error).toContain('npm run build:native');
  });
});
