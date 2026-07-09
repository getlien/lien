import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { chunkFile } from './chunker.js';
import { clearParserCache, NativeBindingLoadError } from './ast/parser.js';

/**
 * ADR-013 Phase 4-B removed the legacy (node-tree-sitter) fallback, so a
 * missing/unloadable native parser binding is a systemic, process-wide
 * failure with no other backend to hand parsing off to (see
 * loadNativeBinding's doc comment in ast/parser.ts).
 *
 * This must hold through `chunkFile` too, not just direct `parseAST`
 * callers: `chunkFile`'s `astFallback` option (default 'line-based')
 * catches ordinary per-file AST errors and degrades to line-based chunking,
 * but a `NativeBindingLoadError` is not an ordinary per-file error and must
 * bypass that fallback entirely -- otherwise every file in a scan would
 * silently degrade to a symbol-less line-based chunk instead of the run
 * failing loudly (the exact anti-pattern the native-load fail-fast design
 * exists to prevent).
 *
 * This lives in its own file (rather than alongside chunker.test.ts) so
 * that the fs.existsSync mock below runs before any successful native load
 * memoizes a handle in the module-level cache -- a memoized success would
 * silently short-circuit the mock (see the same ordering note in
 * ast/parser.test.ts).
 */
describe('chunkFile native-load failure (ADR-013 Phase 4-B: fail-fast, no fallback)', () => {
  beforeEach(() => {
    clearParserCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearParserCache();
  });

  it('propagates NativeBindingLoadError instead of degrading to line-based chunking (default astFallback)', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const code = 'function test() { return 42; }';

    expect(() => chunkFile('test.ts', code, { useAST: true })).toThrow(NativeBindingLoadError);
    // No fallback to warn-and-degrade into -- see loadNativeBinding.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('propagates NativeBindingLoadError with astFallback explicitly set to "error" too', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const code = 'function test() { return 42; }';

    expect(() => chunkFile('test.ts', code, { useAST: true, astFallback: 'error' })).toThrow(
      NativeBindingLoadError,
    );
  });
});
