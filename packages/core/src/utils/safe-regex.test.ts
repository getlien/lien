import { describe, it, expect } from 'vitest';
import { safeRegex } from './safe-regex.js';

describe('safeRegex', () => {
  it('should compile valid patterns', () => {
    expect(safeRegex('.*Controller.*')).toBeInstanceOf(RegExp);
    expect(safeRegex('handle.*')).toBeInstanceOf(RegExp);
    expect(safeRegex('^test$')).toBeInstanceOf(RegExp);
    expect(safeRegex('foo|bar')).toBeInstanceOf(RegExp);
  });

  it('should return case-insensitive regex', () => {
    const regex = safeRegex('hello');
    expect(regex).not.toBeNull();
    expect(regex!.flags).toBe('i');
  });

  it('should return null for invalid syntax', () => {
    expect(safeRegex('[unterminated')).toBeNull();
    expect(safeRegex('(unclosed')).toBeNull();
    expect(safeRegex('*invalid')).toBeNull();
    expect(safeRegex('(?P<bad')).toBeNull();
  });

  it('should reject ReDoS-prone nested quantifier patterns', () => {
    expect(safeRegex('(a+)+$')).toBeNull();
    expect(safeRegex('(a*)*$')).toBeNull();
    expect(safeRegex('(.*)*$')).toBeNull();
    expect(safeRegex('(a+)+b')).toBeNull();
    expect(safeRegex('(a+)?')).toBeNull();
    expect(safeRegex('(a*){2,}')).toBeNull();
    expect(safeRegex('(a+){1,3}')).toBeNull();
  });

  it('should allow normal patterns with quantifiers', () => {
    expect(safeRegex('.*Controller.*')).toBeInstanceOf(RegExp);
    expect(safeRegex('a+')).toBeInstanceOf(RegExp);
    expect(safeRegex('(foo|bar)+')).toBeInstanceOf(RegExp);
    expect(safeRegex('\\w+')).toBeInstanceOf(RegExp);
  });

  // Regression coverage for a confirmed live repro: the old hand-rolled
  // heuristic only looked for a quantifier immediately before a closing
  // paren (catching nested quantifiers like `(a+)+`), so alternation-based
  // ReDoS sailed straight through. `safeRegex('(a|a)+$')` used to return a
  // live RegExp whose `.test()` hung on a 30-char input. Assert rejection
  // only — never execute a pattern under test against a real string here.
  it('should reject ReDoS-prone duplicate-alternation patterns', () => {
    expect(safeRegex('(a|a)+$')).toBeNull();
    expect(safeRegex('(a|a)+')).toBeNull();
    expect(safeRegex('(a|A)+$')).toBeNull(); // duplicate once case-folded (regex compiles with 'i')
    expect(safeRegex('(?:a|a)+$')).toBeNull(); // non-capturing group variant
    expect(safeRegex('(ab|ab)*')).toBeNull();
  });

  it('should still reject nested-quantifier patterns via safe-regex2', () => {
    expect(safeRegex('(a+)+')).toBeNull();
    expect(safeRegex('(a+)+$')).toBeNull();
  });

  it('should allow benign patterns that merely contain an alternation', () => {
    expect(safeRegex('^get.*Service$')).toBeInstanceOf(RegExp);
    expect(safeRegex('foo|bar')).toBeInstanceOf(RegExp);
    expect(safeRegex('(foo|bar)+')).toBeInstanceOf(RegExp);
    expect(safeRegex('(get|set)Value')).toBeInstanceOf(RegExp);
  });

  it('should enforce a hard pattern length cap before any analysis runs', () => {
    const atLimit = 'a'.repeat(256);
    const overLimit = 'a'.repeat(257);
    expect(safeRegex(atLimit)).toBeInstanceOf(RegExp);
    expect(safeRegex(overLimit)).toBeNull();
  });
});
