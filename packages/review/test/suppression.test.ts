import { describe, it, expect } from 'vitest';
import { parseSuppressionComments, isFindingSuppressed } from '../src/suppression.js';
import type { LogicFinding } from '../src/types.js';

const createFinding = (overrides: Partial<LogicFinding> = {}): LogicFinding => ({
  filepath: 'src/auth.ts',
  symbolName: 'validateToken',
  line: 10,
  category: 'breaking_change',
  severity: 'error',
  message: 'Test finding',
  evidence: 'Test evidence',
  ...overrides,
});

describe('parseSuppressionComments', () => {
  it('parses lien-ignore single category suppression', () => {
    const code = '// lien-ignore: breaking-change\nfunction foo() {}';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
    expect(result[0].categories).toEqual(['breaking-change']);
  });

  it('parses lien-ignore comma-separated categories', () => {
    const code = '// lien-ignore: breaking-change, unchecked-return\nfunction foo() {}';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['breaking-change', 'unchecked-return']);
  });

  it('parses lien-ignore "all" suppression', () => {
    const code = '// lien-ignore: all\nfunction foo() {}';
    const result = parseSuppressionComments(code);
    expect(result[0].categories).toEqual(['all']);
  });

  it('parses lien-ignore Python-style comments', () => {
    const code = '# lien-ignore: missing-tests\ndef foo(): pass';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['missing-tests']);
  });

  // Backward compat: legacy veille-ignore still works
  it('parses legacy veille-ignore single category suppression', () => {
    const code = '// veille-ignore: breaking-change\nfunction foo() {}';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
    expect(result[0].categories).toEqual(['breaking-change']);
  });

  it('parses legacy veille-ignore comma-separated categories', () => {
    const code = '// veille-ignore: breaking-change, unchecked-return\nfunction foo() {}';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['breaking-change', 'unchecked-return']);
  });

  it('parses legacy veille-ignore Python-style comments', () => {
    const code = '# veille-ignore: missing-tests\ndef foo(): pass';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['missing-tests']);
  });

  it('returns empty for code without suppressions', () => {
    const code = 'function foo() { return 1; }';
    expect(parseSuppressionComments(code)).toHaveLength(0);
  });

  it('handles mixed lien-ignore and veille-ignore comments', () => {
    const code =
      '// lien-ignore: breaking-change\nfunction foo() {}\n// veille-ignore: missing-tests\nfunction bar() {}';
    const result = parseSuppressionComments(code);
    expect(result).toHaveLength(2);
  });
});

describe('isFindingSuppressed', () => {
  it('suppresses finding with lien-ignore on the same line', () => {
    const finding = createFinding({ line: 1 });
    const code = '// lien-ignore: breaking-change\nexport function validateToken() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  it('suppresses finding with lien-ignore on the next line', () => {
    const finding = createFinding({ line: 2 });
    const code = '// lien-ignore: breaking-change\nexport function validateToken() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  // Backward compat: legacy veille-ignore still suppresses
  it('suppresses finding with legacy veille-ignore on the same line', () => {
    const finding = createFinding({ line: 1 });
    const code = '// veille-ignore: breaking-change\nexport function validateToken() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  it('suppresses finding with legacy veille-ignore on the next line', () => {
    const finding = createFinding({ line: 2 });
    const code = '// veille-ignore: breaking-change\nexport function validateToken() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  it('does not suppress finding far from comment', () => {
    const finding = createFinding({ line: 5 });
    const code = '// lien-ignore: breaking-change\n\n\n\nexport function validateToken() {}';
    expect(isFindingSuppressed(finding, code)).toBe(false);
  });

  it('does not suppress with wrong category', () => {
    const finding = createFinding({ category: 'unchecked_return', line: 2 });
    const code = '// lien-ignore: breaking-change\nfunction foo() {}';
    expect(isFindingSuppressed(finding, code)).toBe(false);
  });

  it('suppresses with "all" category', () => {
    const finding = createFinding({ category: 'missing_tests', line: 2 });
    const code = '// lien-ignore: all\nfunction foo() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  it('converts underscore categories to hyphens for matching', () => {
    const finding = createFinding({ category: 'unchecked_return', line: 2 });
    const code = '// lien-ignore: unchecked-return\nfunction foo() {}';
    expect(isFindingSuppressed(finding, code)).toBe(true);
  });

  it('returns false when no suppression comments exist', () => {
    const finding = createFinding();
    const code = 'function foo() { return 1; }';
    expect(isFindingSuppressed(finding, code)).toBe(false);
  });
});
