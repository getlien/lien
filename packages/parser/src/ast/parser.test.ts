import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { parseAST, clearParserCache, NativeBindingLoadError } from './parser.js';
import { CompatSyntaxNode } from './native/index.js';

const VALID_TS = 'const x = 1;';
const INVALID_TS = 'const x = ;';

/**
 * ADR-013 Phase 4-B removed the legacy (node-tree-sitter) fallback: a
 * binding that cannot load is now a fail-fast, process-wide error thrown
 * directly out of parseAST (see loadNativeBinding's doc comment in
 * parser.ts), not a silent per-file degrade. `CompatSyntaxNode` (the native
 * compat layer's real exported class -- see ast/native/compat-node.ts) is
 * used as the "did native actually produce this tree" discriminator now
 * that there is no second backend to compare against.
 *
 * `fs.existsSync` is mocked to simulate the native binding failing to
 * *load* (findPackageDir can't resolve @liendev/parser-native), following
 * the same real-fs-spy pattern chunk-only-index.test.ts uses for
 * `fs.readFile`, rather than vi.mock'ing the module.
 *
 * Order matters within this file: loadNativeBinding() memoizes a
 * *successful* load in a module-level variable that clearParserCache() does
 * not (and must not, per its own doc comment) reset. The load-failure tests
 * must run before anything triggers a real successful native load, or the
 * memoized handle would short-circuit the fs.existsSync mock. Each test
 * file gets its own fresh module graph, so this only matters relative to
 * other tests in this file.
 */
describe('parseAST native-load failure (ADR-013 Phase 4-B: fail-fast, no fallback)', () => {
  const originalEnv = process.env.LIEN_PARSER;

  beforeEach(() => {
    clearParserCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearParserCache();
    if (originalEnv === undefined) {
      delete process.env.LIEN_PARSER;
    } else {
      process.env.LIEN_PARSER = originalEnv;
    }
  });

  it('a binding that cannot load throws once, actionably -- no fallback tree, no warning', () => {
    delete process.env.LIEN_PARSER;
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let thrown: Error | undefined;
    try {
      parseAST(VALID_TS, 'typescript');
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(NativeBindingLoadError);
    expect(thrown!.message).toContain(process.platform);
    expect(thrown!.message).toContain('@liendev/parser-native');
    expect(thrown!.message).toContain('ADR-013');
    // No fallback left to warn-and-degrade into (see loadNativeBinding).
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('caches the load failure -- a second call throws the same error without re-walking node_modules', () => {
    delete process.env.LIEN_PARSER;
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(() => parseAST(VALID_TS, 'typescript')).toThrow();
    const callsAfterFirst = existsSyncSpy.mock.calls.length;

    expect(() => parseAST(VALID_TS, 'typescript')).toThrow();
    expect(existsSyncSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('LIEN_PARSER=legacy throws the retired-backend error before ever touching the binding', () => {
    process.env.LIEN_PARSER = 'legacy';
    // existsSync is deliberately left unmocked: resolveParserBackend() must
    // reject 'legacy' before loadNativeBinding() (and its fs walk) ever runs.
    expect(() => parseAST(VALID_TS, 'typescript')).toThrow(/no longer supported/);
  });
});

describe('parseAST (native, the only backend)', () => {
  afterEach(() => {
    delete process.env.LIEN_PARSER;
    clearParserCache();
  });

  it('parses successfully into a native compat tree', () => {
    const result = parseAST(VALID_TS, 'typescript');

    expect(result.tree).not.toBeNull();
    expect(result.tree!.rootNode).toBeInstanceOf(CompatSyntaxNode);
    expect(result.error).toBeUndefined();
  });

  it('a genuine per-file syntax error still returns {tree, error}, not a throw', () => {
    const result = parseAST(INVALID_TS, 'typescript');

    expect(result.tree).not.toBeNull();
    expect(result.tree!.rootNode).toBeInstanceOf(CompatSyntaxNode);
    expect(result.error).toBe('Parse completed with errors');
  });
});
