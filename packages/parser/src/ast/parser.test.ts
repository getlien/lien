import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import Parser from 'tree-sitter';
import { parseAST, clearParserCache } from './parser.js';

const VALID_TS = 'const x = 1;';
const INVALID_TS = 'const x = ;';

/**
 * ADR-013 Phase 4-A transitional fallback (see parser.ts's shouldFallBackToLegacy).
 *
 * `fs.existsSync` is mocked to simulate the native binding failing to *load*
 * (findPackageDir can't resolve @liendev/parser-native, e.g. an exotic
 * platform with no prebuilt package and no local build) -- following the
 * same real-fs-spy pattern chunk-only-index.test.ts uses for `fs.readFile`,
 * rather than vi.mock'ing the module.
 *
 * A real Parser.Tree instance (node-tree-sitter) vs. the native compat
 * backend's plain-object CompatTree is used throughout as the discriminator
 * for "which backend actually produced this result" -- see
 * ast/native/compat-node.ts's `export interface CompatTree`.
 *
 * Order matters within this file: loadNativeBinding() memoizes a
 * *successful* load in a module-level variable that clearParserCache() does
 * not (and must not, per its own doc comment) reset. The load-failure tests
 * must run before anything triggers a real successful native load, or the
 * memoized handle would short-circuit the fs.existsSync mock. Each test
 * file gets its own fresh module graph, so this only matters relative to
 * other tests in this file.
 */
describe('parseAST native-load fallback (ADR-013 Phase 4-A)', () => {
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

  it('explicit LIEN_PARSER=native + load failure: fails loud, does not fall back, does not warn', () => {
    process.env.LIEN_PARSER = 'native';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parseAST(VALID_TS, 'typescript');

    expect(result.tree).toBeNull();
    expect(result.error).toBeTruthy();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('default (LIEN_PARSER unset) + load failure: falls back to legacy, warns exactly once', () => {
    delete process.env.LIEN_PARSER;
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = parseAST(VALID_TS, 'typescript');
    const second = parseAST(VALID_TS, 'typescript');

    // A real Parser.Tree means the legacy (node-tree-sitter) path ran.
    expect(first.tree instanceof Parser.Tree).toBe(true);
    expect(second.tree instanceof Parser.Tree).toBe(true);
    expect(first.error).toBeUndefined();

    // Cached decision -- the failing load is only attempted once per process.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain(process.platform);
    expect(message).toContain('legacy');
    expect(message).toContain('LIEN_PARSER=legacy');
  });

  it('default (LIEN_PARSER unset) + native loads successfully: uses native, no warning', () => {
    delete process.env.LIEN_PARSER;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parseAST(VALID_TS, 'typescript');

    expect(result.tree).not.toBeNull();
    // Native compat trees are plain objects, never real Parser.Tree instances.
    expect(result.tree instanceof Parser.Tree).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a per-file parse error from an already-loaded native binding does not trigger fallback', () => {
    delete process.env.LIEN_PARSER;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parseAST(INVALID_TS, 'typescript');

    // Still native (a CompatTree), just with the normal hasError signal --
    // not a load failure, so no fallback and no warning.
    expect(result.tree).not.toBeNull();
    expect(result.tree instanceof Parser.Tree).toBe(false);
    expect(result.error).toBe('Parse completed with errors');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
