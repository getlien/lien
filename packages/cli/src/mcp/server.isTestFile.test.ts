import { describe, it, expect } from 'vitest';
import { isTestFile } from './utils/path-matching.js';

/**
 * Test cases for test file detection in get_dependents tool.
 * 
 * Bug: Simple string matching produced false positives:
 * - "contest.ts" matched ".test." ❌
 * - "latest/config.ts" matched "/test/" ❌
 * - "protest.ts" matched ".test." ❌
 * 
 * Fix: Use precise regex patterns
 */
describe('isTestFile - Precise Test Detection', () => {

  describe('should correctly identify test files', () => {
    it('should match .test. files', () => {
      expect(isTestFile('src/auth.test.ts')).toBe(true);
      expect(isTestFile('components/Button.test.tsx')).toBe(true);
      expect(isTestFile('utils/validator.test.js')).toBe(true);
    });

    it('should match .spec. files', () => {
      expect(isTestFile('src/auth.spec.ts')).toBe(true);
      expect(isTestFile('e2e/login.spec.js')).toBe(true);
      expect(isTestFile('components/Button.spec.tsx')).toBe(true);
    });

    it('should match files in test/ directories', () => {
      expect(isTestFile('test/auth.ts')).toBe(true);
      expect(isTestFile('src/test/helper.ts')).toBe(true);
      expect(isTestFile('packages/cli/test/fixtures.ts')).toBe(true);
    });

    it('should match files in tests/ directories', () => {
      expect(isTestFile('tests/auth.ts')).toBe(true);
      expect(isTestFile('src/tests/helper.ts')).toBe(true);
    });

    it('should match files in __tests__/ directories', () => {
      expect(isTestFile('__tests__/auth.ts')).toBe(true);
      expect(isTestFile('src/__tests__/helper.ts')).toBe(true);
    });

    it('should match Windows paths', () => {
      expect(isTestFile('src\\auth.test.ts')).toBe(true);
      expect(isTestFile('test\\helper.ts')).toBe(true);
      expect(isTestFile('src\\__tests__\\utils.ts')).toBe(true);
    });
  });

  describe('should NOT match false positives (the bug)', () => {
    it('should NOT match files with "test" in the name', () => {
      expect(isTestFile('contest.ts')).toBe(false);
      expect(isTestFile('manifest.json')).toBe(false);
      expect(isTestFile('attest.js')).toBe(false);
      expect(isTestFile('protest-handler.ts')).toBe(false);
    });

    it('should NOT match directories with "test" in the path', () => {
      expect(isTestFile('latest/config.ts')).toBe(false);
      expect(isTestFile('greatest/helper.js')).toBe(false);
      expect(isTestFile('fastest-route/index.ts')).toBe(false);
    });

    it('should NOT match files where test is not a path component', () => {
      expect(isTestFile('mytest.ts')).toBe(false);
      expect(isTestFile('testing.js')).toBe(false);
      expect(isTestFile('testimonial.tsx')).toBe(false);
    });

    it('should NOT match regular source files', () => {
      expect(isTestFile('src/auth.ts')).toBe(false);
      expect(isTestFile('components/Button.tsx')).toBe(false);
      expect(isTestFile('utils/validator.js')).toBe(false);
      expect(isTestFile('index.ts')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle files at root level', () => {
      expect(isTestFile('auth.test.ts')).toBe(true);
      expect(isTestFile('auth.ts')).toBe(false);
    });

    it('should handle deeply nested test files', () => {
      expect(isTestFile('packages/cli/src/mcp/tools.test.ts')).toBe(true);
      expect(isTestFile('a/b/c/d/e/test/helper.ts')).toBe(true);
    });

    it('should handle mixed separators', () => {
      expect(isTestFile('src/test\\helper.ts')).toBe(true);
      expect(isTestFile('src\\auth.test.ts')).toBe(true);
    });
  });
});

