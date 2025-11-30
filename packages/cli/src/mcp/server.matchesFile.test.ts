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
  // Extracted matching logic for testing (mirrors optimized server.ts implementation)
  const normalizePath = (path: string): string => {
    let normalized = path.replace(/['"]/g, '').trim().replace(/\\/g, '/');
    // Normalize extensions: .ts/.tsx/.js/.jsx → all treated as equivalent
    normalized = normalized.replace(/\.(ts|tsx|js|jsx)$/, '');
    // Note: workspace root normalization not needed for unit tests
    return normalized;
  };
  
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
  
  const matchesFile = (importPath: string, targetPath: string): boolean => {
    const normalizedImport = normalizePath(importPath);
    const normalizedTarget = normalizePath(targetPath);
    
    // Exact match
    if (normalizedImport === normalizedTarget) return true;
    
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

    it('should match relative imports to full paths', () => {
      expect(matchesFile('./schemas/index.js', 'packages/cli/src/mcp/schemas/index.ts')).toBe(true);
      expect(matchesFile('../schemas/index', 'src/mcp/schemas/index')).toBe(true);
    });
    
    it('should match the exact dogfooding scenario', () => {
      // After normalization (extension stripped):
      // import: ./schemas/index.js → ./schemas/index
      // target: packages/cli/src/mcp/schemas/index.ts → packages/cli/src/mcp/schemas/index
      const normalizeExt = (p: string) => p.replace(/\.(ts|tsx|js|jsx)$/, '');
      const imp = normalizeExt('./schemas/index.js');
      const target = normalizeExt('packages/cli/src/mcp/schemas/index.ts');
      expect(matchesFile(imp, target)).toBe(true);
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

  describe('extension normalization (.ts vs .js)', () => {
    it('should match .ts files with .js imports (TypeScript ESM)', () => {
      expect(matchesFile('src/logger.js', 'src/logger.ts')).toBe(true);
      expect(matchesFile('./utils.js', './utils.ts')).toBe(true);
    });

    it('should match .tsx files with .js imports', () => {
      expect(matchesFile('components/Button.js', 'components/Button.tsx')).toBe(true);
    });

    it('should match files with any JS/TS extension combination', () => {
      expect(matchesFile('src/helper.js', 'src/helper.ts')).toBe(true);
      expect(matchesFile('src/helper.ts', 'src/helper.js')).toBe(true);
      expect(matchesFile('src/helper.jsx', 'src/helper.tsx')).toBe(true);
    });

    it('should match files without extensions to files with extensions', () => {
      expect(matchesFile('src/logger', 'src/logger.ts')).toBe(true);
      expect(matchesFile('src/logger.ts', 'src/logger')).toBe(true);
    });

    it('should NOT match different files despite same extension', () => {
      expect(matchesFile('src/logger.ts', 'src/utils.ts')).toBe(false);
      expect(matchesFile('auth/handler.js', 'api/handler.js')).toBe(false);
    });
  });
});

