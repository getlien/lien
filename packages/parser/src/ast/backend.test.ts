import { afterEach, describe, expect, it } from 'vitest';
import { resolveParserBackend } from './backend.js';

/**
 * LIEN_PARSER is read at call time (see backend.ts), so these tests flip it
 * per-assertion and always restore it afterward rather than relying on test
 * ordering.
 *
 * ADR-013 Phase 4-B: 'native' is now the only backend -- 'legacy' was
 * retired (see RETIRED_BACKENDS in backend.ts) rather than simply becoming
 * invalid, so it gets its own specific error. isBackendUnset() was deleted
 * as dead code along with the transitional fallback that was its only
 * caller (see parser.ts).
 */
describe('resolveParserBackend', () => {
  const original = process.env.LIEN_PARSER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LIEN_PARSER;
    } else {
      process.env.LIEN_PARSER = original;
    }
  });

  it('defaults to native when LIEN_PARSER is unset', () => {
    delete process.env.LIEN_PARSER;
    expect(resolveParserBackend()).toBe('native');
  });

  it('returns native when LIEN_PARSER=native is set explicitly (a no-op)', () => {
    process.env.LIEN_PARSER = 'native';
    expect(resolveParserBackend()).toBe('native');
  });

  it('throws a specific retired-backend error for LIEN_PARSER=legacy', () => {
    process.env.LIEN_PARSER = 'legacy';
    expect(() => resolveParserBackend()).toThrow(/no longer supported/);
    expect(() => resolveParserBackend()).toThrow(/has been removed/);
    expect(() => resolveParserBackend()).toThrow(/ADR-013/);
    expect(() => resolveParserBackend()).toThrow(/pin @liendev\/parser/);
  });

  it('throws the generic invalid-value error for an unknown value', () => {
    process.env.LIEN_PARSER = 'bogus';
    expect(() => resolveParserBackend()).toThrow(/Invalid LIEN_PARSER/);
    expect(() => resolveParserBackend()).toThrow(/Valid values: 'native'/);
  });

  it('the generic invalid-value error does not mention the retired legacy backend', () => {
    process.env.LIEN_PARSER = 'bogus';
    expect(() => resolveParserBackend()).not.toThrow(/legacy/);
  });
});
