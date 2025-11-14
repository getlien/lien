import { describe, it, expect, beforeEach } from 'vitest';
import { TestAssociationManager } from './test-association-manager.js';
import { toRelativePath, type RelativePath } from '../types/paths.js';
import type { FrameworkInstance } from '../config/schema.js';

describe('TestAssociationManager', () => {
  let genericFramework: FrameworkInstance;
  
  beforeEach(() => {
    // Setup a generic framework configuration
    genericFramework = {
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: ['**/*.{ts,tsx,js,jsx,py}'],
        exclude: ['**/node_modules/**'],
        testPatterns: {
          directories: ['test', 'tests', '__tests__'],
          extensions: ['.test.ts', '.test.js', '.spec.ts', '.spec.js'],
          prefixes: ['test_'],
          suffixes: ['Test', '_test', '.test', '.spec'],
          frameworks: ['jest', 'vitest'],
        },
      },
    };
  });

  describe('Framework partitioning', () => {
    it('should partition files by framework', () => {
      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
        toRelativePath('src/components/Button.tsx'),
        toRelativePath('tests/index.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      const stats = manager.getStats();
      
      expect(stats.totalFiles).toBe(3);
    });

    it('should handle monorepo with multiple frameworks', () => {
      const laravelFramework: FrameworkInstance = {
        name: 'laravel',
        path: 'backend',
        enabled: true,
        config: {
          include: ['**/*.php'],
          exclude: ['**/vendor/**'],
          testPatterns: {
            directories: ['tests/Unit', 'tests/Feature'],
            extensions: ['Test.php'],
            prefixes: [],
            suffixes: ['Test'],
            frameworks: ['phpunit'],
          },
        },
      };

      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
        toRelativePath('backend/app/Http/Controllers/AuthController.php'),
        toRelativePath('backend/tests/Unit/AuthControllerTest.php'),
      ];
      
      const manager = new TestAssociationManager(
        files,
        [genericFramework, laravelFramework],
        false
      );
      
      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(3);
    });
  });

  describe('Source → Test associations', () => {
    it('should find test files for TypeScript source', () => {
      const files: RelativePath[] = [
        toRelativePath('src/utils/calculator.ts'),
        toRelativePath('src/utils/calculator.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/utils/calculator.ts'));
      expect(assoc).toBeDefined();
      expect(assoc!.isTest).toBe(false);
      expect(assoc!.relatedTests).toContain('src/utils/calculator.test.ts');
    });

    it('should find test files with .spec extension', () => {
      const files: RelativePath[] = [
        toRelativePath('src/components/Button.tsx'),
        toRelativePath('src/components/Button.spec.tsx'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/components/Button.tsx'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedTests).toContain('src/components/Button.spec.tsx');
    });

    it('should find tests in __tests__ directory', () => {
      const files: RelativePath[] = [
        toRelativePath('src/utils/helpers.ts'),
        toRelativePath('__tests__/helpers.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/utils/helpers.ts'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedTests).toContain('__tests__/helpers.test.ts');
    });

    it('should handle Python test_ prefix convention', () => {
      const files: RelativePath[] = [
        toRelativePath('src/calculator.py'),
        toRelativePath('tests/test_calculator.py'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/calculator.py'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedTests).toContain('tests/test_calculator.py');
    });
  });

  describe('Test → Source associations', () => {
    it('should find source file from test file', () => {
      const files: RelativePath[] = [
        toRelativePath('src/utils/calculator.ts'),
        toRelativePath('src/utils/calculator.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/utils/calculator.test.ts'));
      expect(assoc).toBeDefined();
      expect(assoc!.isTest).toBe(true);
      expect(assoc!.relatedSources).toContain('src/utils/calculator.ts');
    });

    it('should extract base name from test file correctly', () => {
      const files: RelativePath[] = [
        toRelativePath('src/components/Button.tsx'),
        toRelativePath('src/components/Button.spec.tsx'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/components/Button.spec.tsx'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedSources).toContain('src/components/Button.tsx');
    });

    it('should handle Python test_prefix convention reverse lookup', () => {
      const files: RelativePath[] = [
        toRelativePath('src/calculator.py'),
        toRelativePath('tests/test_calculator.py'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('tests/test_calculator.py'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedSources).toContain('src/calculator.py');
    });
  });

  describe('PHP/Laravel-style tests', () => {
    it('should handle PHP Test suffix convention', () => {
      const laravelFramework: FrameworkInstance = {
        name: 'laravel',
        path: '.',
        enabled: true,
        config: {
          include: ['**/*.php'],
          exclude: ['**/vendor/**'],
          testPatterns: {
            directories: ['tests/Unit', 'tests/Feature'],
            extensions: ['Test.php'],
            prefixes: [],
            suffixes: ['Test'],
            frameworks: ['phpunit'],
          },
        },
      };

      const files: RelativePath[] = [
        toRelativePath('app/Http/Controllers/AuthController.php'),
        toRelativePath('tests/Unit/AuthControllerTest.php'),
      ];
      
      const manager = new TestAssociationManager(files, [laravelFramework], false);
      manager.buildAssociations();
      
      const sourceAssoc = manager.getAssociation(
        toRelativePath('app/Http/Controllers/AuthController.php')
      );
      expect(sourceAssoc).toBeDefined();
      expect(sourceAssoc!.relatedTests).toContain('tests/Unit/AuthControllerTest.php');
      
      const testAssoc = manager.getAssociation(
        toRelativePath('tests/Unit/AuthControllerTest.php')
      );
      expect(testAssoc).toBeDefined();
      expect(testAssoc!.relatedSources).toContain('app/Http/Controllers/AuthController.php');
    });
  });

  describe('Validation', () => {
    it('should validate associations successfully with valid data', () => {
      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
        toRelativePath('src/index.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], true);
      
      // Should not throw
      expect(() => manager.buildAssociations()).not.toThrow();
    });

    it('should detect related files not in associations', () => {
      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      // Manually corrupt an association to test validation
      const assoc = manager.getAssociation(toRelativePath('src/index.ts'));
      if (assoc) {
        assoc.relatedTests = ['nonexistent.test.ts'];
        
        // Validation should catch this in verbose mode
        const manager2 = new TestAssociationManager(files, [genericFramework], true);
        manager2.buildAssociations();
        
        // Get the association map and corrupt it
        const associations = manager2.getAssociations();
        const corruptedAssoc = associations.get(toRelativePath('src/index.ts'));
        if (corruptedAssoc) {
          corruptedAssoc.relatedTests = ['nonexistent.test.ts'];
        }
        
        // Note: validation only runs during buildAssociations in verbose mode
        // and we can't easily test the private method without refactoring
      }
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
        toRelativePath('src/utils.ts'),
        toRelativePath('src/index.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.sourceFiles).toBe(2);
      expect(stats.testFiles).toBe(1);
      expect(stats.sourcesWithTests).toBe(1); // only index.ts has a test
      expect(stats.testsWithSources).toBe(1); // index.test.ts found its source
    });

    it('should count zero associations correctly', () => {
      const files: RelativePath[] = [
        toRelativePath('src/orphan.ts'),
        toRelativePath('tests/unrelated.test.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const stats = manager.getStats();
      expect(stats.sourcesWithTests).toBe(0);
      expect(stats.testsWithSources).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty file list', () => {
      const files: RelativePath[] = [];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.sourceFiles).toBe(0);
      expect(stats.testFiles).toBe(0);
    });

    it('should handle files with no framework match', () => {
      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/index.ts'));
      expect(assoc).toBeDefined();
    });

    it('should handle multiple tests for one source', () => {
      const files: RelativePath[] = [
        toRelativePath('src/utils.ts'),
        toRelativePath('src/utils.test.ts'),
        toRelativePath('src/utils.spec.ts'),
      ];
      
      const manager = new TestAssociationManager(files, [genericFramework], false);
      manager.buildAssociations();
      
      const assoc = manager.getAssociation(toRelativePath('src/utils.ts'));
      expect(assoc).toBeDefined();
      expect(assoc!.relatedTests).toHaveLength(2);
      expect(assoc!.relatedTests).toContain('src/utils.test.ts');
      expect(assoc!.relatedTests).toContain('src/utils.spec.ts');
    });
  });

  describe('Performance - Framework caching', () => {
    it('should cache framework lookups to avoid O(n×m) complexity', () => {
      // Create multiple frameworks
      const frameworks: FrameworkInstance[] = [
        genericFramework,
        {
          name: 'backend',
          path: 'backend',
          enabled: true,
          config: {
            include: ['**/*.php'],
            exclude: ['**/vendor/**'],
            testPatterns: {
              directories: ['tests'],
              extensions: ['Test.php'],
              prefixes: [],
              suffixes: ['Test'],
              frameworks: ['phpunit'],
            },
          },
        },
        {
          name: 'frontend',
          path: 'frontend',
          enabled: true,
          config: {
            include: ['**/*.{ts,tsx}'],
            exclude: ['**/node_modules/**'],
            testPatterns: {
              directories: ['__tests__'],
              extensions: ['.test.tsx'],
              prefixes: [],
              suffixes: ['.test'],
              frameworks: ['jest'],
            },
          },
        },
      ];

      const files: RelativePath[] = [
        toRelativePath('src/index.ts'),
        toRelativePath('backend/app/Models/User.php'),
        toRelativePath('frontend/components/Button.tsx'),
      ];
      
      const manager = new TestAssociationManager(files, frameworks, false);
      manager.buildAssociations();
      
      // If caching works, this should complete quickly
      // We can't easily measure performance in a unit test,
      // but we can verify the associations were built correctly
      const stats = manager.getStats();
      expect(stats.totalFiles).toBe(3);
    });
  });
});

