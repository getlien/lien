import { describe, it, expect } from 'vitest';
import { normalizePath, matchesFile } from './utils/path-matching.js';

/**
 * Test cases for path matching logic in get_dependents tool.
 * 
 * Ensures path matching respects component boundaries to avoid false positives:
 * - "src/logger" should NOT match "src/logger-utils" ✓
 * - "logger" should NOT match "some-logger-package" ✓
 * - Matches occur only at proper boundaries (/, .)
 * 
 * Covers extension normalization (.ts vs .js), relative imports,
 * and various edge cases for robust dependency detection.
 */
describe('matchesFile - Path Boundary Checking', () => {
  // Test helper: normalize paths without workspace root (not needed for unit tests)
  const normalize = (path: string): string => normalizePath(path, '/fake/workspace');
  
  const testMatchesFile = (importPath: string, targetPath: string): boolean => {
    const normalizedImport = normalize(importPath);
    const normalizedTarget = normalize(targetPath);
    return matchesFile(normalizedImport, normalizedTarget);
  };

  describe('should match valid imports', () => {
    it('should match exact path', () => {
      expect(testMatchesFile('src/logger', 'src/logger')).toBe(true);
      expect(testMatchesFile('src/logger.ts', 'src/logger')).toBe(true);
      expect(testMatchesFile('src/logger', 'src/logger.ts')).toBe(true);
    });

    it('should match path with extension', () => {
      expect(testMatchesFile('src/utils/logger.ts', 'src/utils/logger')).toBe(true);
      expect(testMatchesFile('src/utils/logger', 'src/utils/logger.ts')).toBe(true);
    });

    it('should match relative imports', () => {
      expect(testMatchesFile('./logger', 'logger')).toBe(true);
      expect(testMatchesFile('../logger', 'logger')).toBe(true);
      expect(testMatchesFile('./utils/logger', 'utils/logger')).toBe(true);
    });

    it('should match relative imports to full paths', () => {
      expect(testMatchesFile('./schemas/index.js', 'packages/cli/src/mcp/schemas/index.ts')).toBe(true);
      expect(testMatchesFile('../schemas/index', 'src/mcp/schemas/index')).toBe(true);
    });
    
    it('should match the exact dogfooding scenario', () => {
      // After normalization (extension stripped):
      // import: ./schemas/index.js → ./schemas/index
      // target: packages/cli/src/mcp/schemas/index.ts → packages/cli/src/mcp/schemas/index
      const normalizeExt = (p: string) => p.replace(/\.(ts|tsx|js|jsx)$/, '');
      const imp = normalizeExt('./schemas/index.js');
      const target = normalizeExt('packages/cli/src/mcp/schemas/index.ts');
      expect(testMatchesFile(imp, target)).toBe(true);
    });

    it('should match nested paths', () => {
      expect(testMatchesFile('src/utils/logger', 'utils/logger')).toBe(true);
      expect(testMatchesFile('packages/cli/src/logger', 'src/logger')).toBe(true);
    });
  });

  describe('should NOT match false positives (the bug)', () => {
    it('should NOT match paths with similar prefixes', () => {
      expect(testMatchesFile('src/logger-utils', 'src/logger')).toBe(false);
      expect(testMatchesFile('src/logger', 'src/logger-utils')).toBe(false);
    });

    it('should NOT match paths with similar suffixes', () => {
      expect(testMatchesFile('some-logger-package', 'logger')).toBe(false);
      expect(testMatchesFile('my-logger', 'logger')).toBe(false);
    });

    it('should NOT match paths where pattern appears mid-component', () => {
      expect(testMatchesFile('src/mylogger', 'logger')).toBe(false);
      expect(testMatchesFile('src/loggerservice', 'logger')).toBe(false);
    });

    it('should NOT match package names with similar strings', () => {
      expect(testMatchesFile('@company/logger-service', 'logger')).toBe(false);
      expect(testMatchesFile('winston-logger', 'logger')).toBe(false);
    });

    it('should NOT match completely different files', () => {
      expect(testMatchesFile('src/database.ts', 'src/logger.ts')).toBe(false);
      expect(testMatchesFile('auth/handler', 'logger')).toBe(false);
    });

    it('should NOT match same filename in different directories', () => {
      expect(testMatchesFile('src/utils/validator.ts', 'lib/validator.ts')).toBe(false);
      expect(testMatchesFile('components/Button.tsx', 'ui/Button.tsx')).toBe(false);
      expect(testMatchesFile('auth/handler.ts', 'api/handler.ts')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle quoted imports', () => {
      expect(testMatchesFile('"src/logger"', 'src/logger')).toBe(true);
      expect(testMatchesFile("'src/logger'", 'src/logger')).toBe(true);
    });

    it('should handle Windows paths', () => {
      expect(testMatchesFile('src\\logger', 'src/logger')).toBe(true);
      expect(testMatchesFile('src\\utils\\logger', 'src/utils/logger')).toBe(true);
    });

    it('should handle whitespace', () => {
      expect(testMatchesFile(' src/logger ', 'src/logger')).toBe(true);
    });
  });

  describe('extension normalization (.ts vs .js)', () => {
    it('should match .ts files with .js imports (TypeScript ESM)', () => {
      expect(testMatchesFile('src/logger.js', 'src/logger.ts')).toBe(true);
      expect(testMatchesFile('./utils.js', './utils.ts')).toBe(true);
    });

    it('should match .tsx files with .js imports', () => {
      expect(testMatchesFile('components/Button.js', 'components/Button.tsx')).toBe(true);
    });

    it('should match files with any JS/TS extension combination', () => {
      expect(testMatchesFile('src/helper.js', 'src/helper.ts')).toBe(true);
      expect(testMatchesFile('src/helper.ts', 'src/helper.js')).toBe(true);
      expect(testMatchesFile('src/helper.jsx', 'src/helper.tsx')).toBe(true);
    });

    it('should match files without extensions to files with extensions', () => {
      expect(testMatchesFile('src/logger', 'src/logger.ts')).toBe(true);
      expect(testMatchesFile('src/logger.ts', 'src/logger')).toBe(true);
    });

    it('should NOT match different files despite same extension', () => {
      expect(testMatchesFile('src/logger.ts', 'src/utils.ts')).toBe(false);
      expect(testMatchesFile('auth/handler.js', 'api/handler.js')).toBe(false);
    });
  });

  describe('test file boundary checking', () => {
    it('should NOT match test files when searching for source file', () => {
      // After normalization: logger.test.ts → logger.test, logger.ts → logger
      // "logger" should NOT match "logger.test" 
      expect(testMatchesFile('logger', 'logger.test')).toBe(false);
      expect(testMatchesFile('src/logger', 'src/logger.test')).toBe(false);
      expect(testMatchesFile('utils/validator', 'utils/validator.spec')).toBe(false);
    });

    it('should NOT match test files with extensions', () => {
      // These get normalized but should still not match
      expect(testMatchesFile('logger.ts', 'logger.test.ts')).toBe(false);
      expect(testMatchesFile('src/auth.ts', 'src/auth.spec.ts')).toBe(false);
    });
  });

  describe('PHP namespace matching', () => {
    it('should match PHP namespace to file path', () => {
      // PHP uses namespaces like App\Models\User which map to app/Models/User.php
      expect(testMatchesFile('App\\Models\\User', 'app/Models/User.php')).toBe(true);
      expect(testMatchesFile('App\\Models\\Collection', 'web/app/Models/Collection.php')).toBe(true);
    });

    it('should match nested PHP namespaces', () => {
      expect(testMatchesFile('Domain\\Hobbii\\Collections\\Services\\CollectionManager', 'web/Domain/Hobbii/Collections/Services/CollectionManager.php')).toBe(true);
    });

    it('should match case-insensitively for App namespace', () => {
      // Laravel convention: App namespace maps to app directory
      expect(testMatchesFile('App\\Http\\Controllers\\UserController', 'app/Http/Controllers/UserController.php')).toBe(true);
    });

    it('should NOT match unrelated PHP namespaces', () => {
      expect(testMatchesFile('App\\Models\\User', 'app/Models/Product.php')).toBe(false);
      expect(testMatchesFile('App\\Services\\Auth', 'app/Models/User.php')).toBe(false);
    });

    it('should NOT apply PHP matching to non-namespace imports', () => {
      // Regular file paths should not use PHP namespace matching
      expect(testMatchesFile('src/models/user', 'src/models/product')).toBe(false);
    });
  });
});

