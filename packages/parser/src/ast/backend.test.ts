import { afterEach, describe, expect, it } from 'vitest';
import { resolveParserBackend, isBackendUnset } from './backend.js';

/**
 * LIEN_PARSER is read at call time (see backend.ts), so these tests flip it
 * per-assertion and always restore it afterward rather than relying on test
 * ordering.
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

  it('defaults to native when LIEN_PARSER is unset (ADR-013 Phase 4-A)', () => {
    delete process.env.LIEN_PARSER;
    expect(resolveParserBackend()).toBe('native');
  });

  it('returns native when LIEN_PARSER=native is set explicitly', () => {
    process.env.LIEN_PARSER = 'native';
    expect(resolveParserBackend()).toBe('native');
  });

  it('returns legacy when LIEN_PARSER=legacy is set explicitly (the transitional opt-out)', () => {
    process.env.LIEN_PARSER = 'legacy';
    expect(resolveParserBackend()).toBe('legacy');
  });

  it('throws listing valid options for an unknown value', () => {
    process.env.LIEN_PARSER = 'bogus';
    expect(() => resolveParserBackend()).toThrow(/Invalid LIEN_PARSER/);
    expect(() => resolveParserBackend()).toThrow(/'native', 'legacy'/);
  });
});

describe('isBackendUnset', () => {
  const original = process.env.LIEN_PARSER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.LIEN_PARSER;
    } else {
      process.env.LIEN_PARSER = original;
    }
  });

  it('is true when LIEN_PARSER is unset', () => {
    delete process.env.LIEN_PARSER;
    expect(isBackendUnset()).toBe(true);
  });

  it('is false when LIEN_PARSER is set explicitly, even to the default value', () => {
    process.env.LIEN_PARSER = 'native';
    expect(isBackendUnset()).toBe(false);
  });

  it('is false when LIEN_PARSER is set to legacy', () => {
    process.env.LIEN_PARSER = 'legacy';
    expect(isBackendUnset()).toBe(false);
  });
});
