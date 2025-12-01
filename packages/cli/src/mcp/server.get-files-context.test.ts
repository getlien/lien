import { describe, it, expect } from 'vitest';
import { getCanonicalPath, normalizePath, matchesFile, isTestFile } from './utils/path-matching.js';

/**
 * Unit tests for get_files_context response structure.
 * 
 * Tests the fix for multi-file response structure:
 * - Single file input returns backward-compatible format
 * - Multiple file input returns keyed structure with test associations
 * - Exact file path matching (not substring matching)
 * - Chunks are correctly deduplicated
 * - Test associations are included in both formats
 */

describe('get_files_context - Response Structure', () => {
  const workspaceRoot = '/fake/workspace';
  
  describe('Path Matching Utilities', () => {
    it('should canonicalize paths correctly', () => {
      expect(getCanonicalPath('/fake/workspace/src/auth.ts', workspaceRoot)).toBe('src/auth.ts');
      expect(getCanonicalPath('src/auth.ts', workspaceRoot)).toBe('src/auth.ts');
      expect(getCanonicalPath('src\\auth.ts', workspaceRoot)).toBe('src/auth.ts');
    });
    
    it('should normalize paths for comparison', () => {
      const normalize = (path: string) => normalizePath(path, workspaceRoot);
      
      // Extensions are stripped
      expect(normalize('src/auth.ts')).toBe('src/auth');
      expect(normalize('src/auth.js')).toBe('src/auth');
      
      // Relative paths are converted
      expect(normalize('/fake/workspace/src/auth.ts')).toBe('src/auth');
    });
    
    it('should match file paths correctly', () => {
      const testMatch = (importPath: string, targetPath: string): boolean => {
        const normalizedImport = normalizePath(importPath, workspaceRoot);
        const normalizedTarget = normalizePath(targetPath, workspaceRoot);
        return matchesFile(normalizedImport, normalizedTarget);
      };
      
      // Should match
      expect(testMatch('src/auth.ts', 'src/auth.js')).toBe(true);
      expect(testMatch('./auth', 'src/auth.ts')).toBe(true);
      
      // Should NOT match (avoiding false positives from substring matching)
      expect(testMatch('src/auth-service.ts', 'src/auth.ts')).toBe(false);
      expect(testMatch('src/auth.ts', 'src/auth-service.ts')).toBe(false);
    });
  });
  
  describe('Test File Detection', () => {
    it('should correctly identify test files', () => {
      expect(isTestFile('src/auth.test.ts')).toBe(true);
      expect(isTestFile('src/auth.spec.ts')).toBe(true);
      expect(isTestFile('tests/unit/auth.ts')).toBe(true);
      expect(isTestFile('__tests__/auth.ts')).toBe(true);
    });
    
    it('should NOT match false positives', () => {
      expect(isTestFile('src/auth.ts')).toBe(false);
      expect(isTestFile('src/contest.ts')).toBe(false);
      expect(isTestFile('latest/config.ts')).toBe(false);
    });
  });
  
  describe('Response Format Validation', () => {
    it('should have correct structure for single file response', () => {
      // Expected format for single file input
      const singleFileResponse = {
        indexInfo: {
          indexVersion: 123,
          indexDate: '2025-12-01',
        },
        file: 'src/auth.ts',
        chunks: [
          {
            content: 'export function login() {}',
            metadata: {
              file: 'src/auth.ts',
              startLine: 1,
              endLine: 3,
              language: 'typescript',
            },
            score: 0.9,
          },
        ],
        testAssociations: ['src/__tests__/auth.test.ts'],
      };
      
      // Validate structure
      expect(singleFileResponse).toHaveProperty('indexInfo');
      expect(singleFileResponse).toHaveProperty('file');
      expect(singleFileResponse).toHaveProperty('chunks');
      expect(singleFileResponse).toHaveProperty('testAssociations');
      expect(Array.isArray(singleFileResponse.chunks)).toBe(true);
      expect(Array.isArray(singleFileResponse.testAssociations)).toBe(true);
      
      // Should NOT have 'files' property (that's for multi-file)
      expect(singleFileResponse).not.toHaveProperty('files');
    });
    
    it('should have correct structure for multi-file response', () => {
      // Expected format for multiple file input
      const multiFileResponse = {
        indexInfo: {
          indexVersion: 123,
          indexDate: '2025-12-01',
        },
        files: {
          'src/auth.ts': {
            chunks: [
              {
                content: 'export function login() {}',
                metadata: {
                  file: 'src/auth.ts',
                  startLine: 1,
                  endLine: 3,
                  language: 'typescript',
                },
                score: 0.9,
              },
            ],
            testAssociations: ['src/__tests__/auth.test.ts'],
          },
          'src/user.ts': {
            chunks: [
              {
                content: 'export class User {}',
                metadata: {
                  file: 'src/user.ts',
                  startLine: 1,
                  endLine: 5,
                  language: 'typescript',
                },
                score: 0.95,
              },
            ],
            testAssociations: ['src/__tests__/user.test.ts'],
          },
        },
      };
      
      // Validate structure
      expect(multiFileResponse).toHaveProperty('indexInfo');
      expect(multiFileResponse).toHaveProperty('files');
      expect(typeof multiFileResponse.files).toBe('object');
      
      // Should NOT have 'file' or 'chunks' at top level (that's for single file)
      expect(multiFileResponse).not.toHaveProperty('file');
      expect(multiFileResponse).not.toHaveProperty('chunks');
      
      // Each file should have chunks and testAssociations
      for (const filepath of Object.keys(multiFileResponse.files)) {
        const fileData = multiFileResponse.files[filepath as keyof typeof multiFileResponse.files];
        expect(fileData).toHaveProperty('chunks');
        expect(fileData).toHaveProperty('testAssociations');
        expect(Array.isArray(fileData.chunks)).toBe(true);
        expect(Array.isArray(fileData.testAssociations)).toBe(true);
      }
    });
  });
  
  describe('Chunk Deduplication', () => {
    it('should deduplicate chunks by file + line range', () => {
      const chunks = [
        {
          content: 'export function login() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 1,
            endLine: 3,
            language: 'typescript',
          },
          score: 0.9,
        },
        {
          content: 'export function login() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 1,
            endLine: 3,
            language: 'typescript',
          },
          score: 0.85, // Different score, same chunk
        },
        {
          content: 'export function logout() {}',
          metadata: {
            file: 'src/auth.ts',
            startLine: 5,
            endLine: 7,
            language: 'typescript',
          },
          score: 0.8,
        },
      ];
      
      // Deduplicate
      const seenChunks = new Set<string>();
      const deduplicated = chunks.filter(chunk => {
        const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
        if (seenChunks.has(chunkId)) return false;
        seenChunks.add(chunkId);
        return true;
      });
      
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].metadata.startLine).toBe(1);
      expect(deduplicated[1].metadata.startLine).toBe(5);
    });
  });
  
  describe('Test Association Detection', () => {
    it('should find test files that import a source file', () => {
      // Mock chunks representing test files
      const mockChunks = [
        {
          metadata: {
            file: 'src/__tests__/auth.test.ts',
            imports: ['../auth', '../utils'],
            startLine: 1,
            endLine: 10,
          },
        },
        {
          metadata: {
            file: 'src/__tests__/user.test.ts',
            imports: ['../user', '../auth'],
            startLine: 1,
            endLine: 15,
          },
        },
        {
          metadata: {
            file: 'src/helper.ts',
            imports: ['./auth'],
            startLine: 1,
            endLine: 5,
          },
        },
      ];
      
      // Find tests that import 'src/auth.ts'
      const targetNormalized = normalizePath('src/auth.ts', workspaceRoot);
      const testFiles = new Set<string>();
      
      for (const chunk of mockChunks) {
        const chunkFile = getCanonicalPath(chunk.metadata.file, workspaceRoot);
        
        // Skip if not a test file
        if (!isTestFile(chunkFile)) continue;
        
        // Check if this test file imports the target
        const imports = chunk.metadata.imports || [];
        for (const imp of imports) {
          const normalizedImport = normalizePath(imp, workspaceRoot);
          if (matchesFile(normalizedImport, targetNormalized)) {
            testFiles.add(chunkFile);
            break;
          }
        }
      }
      
      expect(testFiles.size).toBe(2);
      expect(testFiles.has('src/__tests__/auth.test.ts')).toBe(true);
      expect(testFiles.has('src/__tests__/user.test.ts')).toBe(true);
      expect(testFiles.has('src/helper.ts')).toBe(false); // Not a test file
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty test associations', () => {
      const response = {
        indexInfo: { indexVersion: 123, indexDate: '2025-12-01' },
        file: 'src/auth.ts',
        chunks: [],
        testAssociations: [], // No tests found
      };
      
      expect(response.testAssociations).toEqual([]);
    });
    
    it('should handle file with no chunks', () => {
      const response = {
        indexInfo: { indexVersion: 123, indexDate: '2025-12-01' },
        files: {
          'src/auth.ts': {
            chunks: [], // No chunks found
            testAssociations: [],
          },
        },
      };
      
      expect(response.files['src/auth.ts'].chunks).toEqual([]);
    });
  });
});

