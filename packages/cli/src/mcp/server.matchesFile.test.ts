import { describe, it, expect } from 'vitest';

/**
 * Test cases for path matching logic in get_dependents tool.
 * This is a temporary test file to verify the fix for false positives.
 * 
 * Bug: Substring matching produced false positives like:
 * - "src/logger" matched "src/logger-utils" ❌
 * - "logger" matched "some-logger-package" ❌
 * 
 * Fix: Now checks for path boundaries (/ or . separators)
 */
describe('matchesFile - Path Boundary Checking', () => {
  // Extracted matching logic for testing
  const matchesFile = (importPath: string, targetPath: string): boolean => {
    const cleanImport = importPath.replace(/['"]/g, '').trim();
    const cleanTarget = targetPath.trim();
    
    const normalizedImport = cleanImport.replace(/\\/g, '/');
    const normalizedTarget = cleanTarget.replace(/\\/g, '/');
    
    const matchesAtBoundary = (str: string, pattern: string): boolean => {
      const index = str.indexOf(pattern);
      if (index === -1) return false;
      
      const charBefore = index > 0 ? str[index - 1] : '/';
      if (charBefore !== '/' && index !== 0) return false;
      
      const endIndex = index + pattern.length;
      if (endIndex === str.length) return true;
      const charAfter = str[endIndex];
      return charAfter === '/' || charAfter === '.';
    };
    
    if (matchesAtBoundary(normalizedImport, normalizedTarget)) {
      return true;
    }
    
    if (matchesAtBoundary(normalizedTarget, normalizedImport)) {
      return true;
    }
    
    const cleanedImport = normalizedImport.replace(/^(\.\.?\/)+/, '');
    if (matchesAtBoundary(cleanedImport, normalizedTarget) || 
        matchesAtBoundary(normalizedTarget, cleanedImport)) {
      return true;
    }
    
    return false;
  };

  describe('should match valid imports', () => {
    it('should match exact path', () => {
      expect(matchesFile('src/logger', 'src/logger')).toBe(true);
      expect(matchesFile('src/logger.ts', 'src/logger')).toBe(true);
      expect(matchesFile('src/logger', 'src/logger.ts')).toBe(true);
    });

    it('should match path with extension', () => {
      expect(matchesFile('src/utils/logger.ts', 'src/utils/logger')).toBe(true);
      expect(matchesFile('src/utils/logger', 'src/utils/logger.ts')).toBe(true);
    });

    it('should match relative imports', () => {
      expect(matchesFile('./logger', 'logger')).toBe(true);
      expect(matchesFile('../logger', 'logger')).toBe(true);
      expect(matchesFile('./utils/logger', 'utils/logger')).toBe(true);
    });

    it('should match nested paths', () => {
      expect(matchesFile('src/utils/logger', 'utils/logger')).toBe(true);
      expect(matchesFile('packages/cli/src/logger', 'src/logger')).toBe(true);
    });
  });

  describe('should NOT match false positives (the bug)', () => {
    it('should NOT match paths with similar prefixes', () => {
      expect(matchesFile('src/logger-utils', 'src/logger')).toBe(false);
      expect(matchesFile('src/logger', 'src/logger-utils')).toBe(false);
    });

    it('should NOT match paths with similar suffixes', () => {
      expect(matchesFile('some-logger-package', 'logger')).toBe(false);
      expect(matchesFile('my-logger', 'logger')).toBe(false);
    });

    it('should NOT match paths where pattern appears mid-component', () => {
      expect(matchesFile('src/mylogger', 'logger')).toBe(false);
      expect(matchesFile('src/loggerservice', 'logger')).toBe(false);
    });

    it('should NOT match package names with similar strings', () => {
      expect(matchesFile('@company/logger-service', 'logger')).toBe(false);
      expect(matchesFile('winston-logger', 'logger')).toBe(false);
    });

    it('should NOT match completely different files', () => {
      expect(matchesFile('src/database.ts', 'src/logger.ts')).toBe(false);
      expect(matchesFile('auth/handler', 'logger')).toBe(false);
    });

    it('should NOT match same filename in different directories', () => {
      expect(matchesFile('src/utils/validator.ts', 'lib/validator.ts')).toBe(false);
      expect(matchesFile('components/Button.tsx', 'ui/Button.tsx')).toBe(false);
      expect(matchesFile('auth/handler.ts', 'api/handler.ts')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle quoted imports', () => {
      expect(matchesFile('"src/logger"', 'src/logger')).toBe(true);
      expect(matchesFile("'src/logger'", 'src/logger')).toBe(true);
    });

    it('should handle Windows paths', () => {
      expect(matchesFile('src\\logger', 'src/logger')).toBe(true);
      expect(matchesFile('src\\utils\\logger', 'src/utils/logger')).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(matchesFile(' src/logger ', 'src/logger')).toBe(true);
    });
  });
});

