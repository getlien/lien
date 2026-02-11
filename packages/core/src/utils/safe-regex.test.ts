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
  });

  it('should allow normal patterns with quantifiers', () => {
    expect(safeRegex('.*Controller.*')).toBeInstanceOf(RegExp);
    expect(safeRegex('a+')).toBeInstanceOf(RegExp);
    expect(safeRegex('(foo|bar)+')).toBeInstanceOf(RegExp);
    expect(safeRegex('\\w+')).toBeInstanceOf(RegExp);
  });
});
