import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { indexSingleFile, indexMultipleFiles } from './incremental.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { MockEmbeddings } from '../../test/helpers/mock-embeddings.js';
import { createTestDir, cleanupTestDir, createTestVectorDB } from '../../test/helpers/test-db.js';
import { defaultConfig } from '../config/schema.js';

describe('Incremental Indexing', () => {
  let testDir: string;
  let indexPath: string;
  let vectorDB: VectorDB;
  let embeddings: MockEmbeddings;
  
  beforeEach(async () => {
    testDir = await createTestDir();
    indexPath = path.join(testDir, '.lien');
    await fs.mkdir(indexPath, { recursive: true });
    
    embeddings = new MockEmbeddings();
    vectorDB = new VectorDB(indexPath);
    await vectorDB.initialize();
    await embeddings.initialize();
  });
  
  afterEach(async () => {
    // Close vectorDB if it has a close method
    if (vectorDB && typeof vectorDB.close === 'function') {
      try {
        await vectorDB.close();
      } catch {
        // Ignore errors on cleanup
      }
    }
    await cleanupTestDir(testDir);
  });
  
  describe('indexSingleFile', () => {
    it('should index a new file', async () => {
      const testFile = path.join(testDir, 'test.ts');
      await fs.writeFile(testFile, 'export function hello() { return "world"; }');
      
      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should update an existing file', async () => {
      const testFile = path.join(testDir, 'test.ts');
      
      // Index initial version
      await fs.writeFile(testFile, 'export function foo() { return 1; }');
      await indexSingleFile(testFile, vectorDB, embeddings, defaultConfig);
      
      // Update file
      await fs.writeFile(testFile, 'export function bar() { return 2; }');
      
      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should remove deleted file from index', async () => {
      const testFile = path.join(testDir, 'test.ts');
      
      // Index file
      await fs.writeFile(testFile, 'export function test() {}');
      await indexSingleFile(testFile, vectorDB, embeddings, defaultConfig);
      
      // Delete file
      await fs.unlink(testFile);
      
      // Should handle deleted file gracefully
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should handle empty files', async () => {
      const testFile = path.join(testDir, 'empty.ts');
      await fs.writeFile(testFile, '');
      
      // Should not throw
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should handle files with only whitespace', async () => {
      const testFile = path.join(testDir, 'whitespace.ts');
      await fs.writeFile(testFile, '   \n\n   \t\t  ');
      
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should chunk large files correctly', async () => {
      const testFile = path.join(testDir, 'large.ts');
      
      // Create a file larger than default chunk size
      const content = 'export function test() {\n' + '  console.log("test");\n'.repeat(100) + '}\n';
      await fs.writeFile(testFile, content);
      
      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should log errors but not throw for invalid files', async () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.ts');
      
      // Should not throw even for non-existent file
      await expect(
        indexSingleFile(nonExistentFile, vectorDB, embeddings, defaultConfig)
      ).resolves.not.toThrow();
    });
    
    it('should handle verbose mode', async () => {
      const testFile = path.join(testDir, 'test.ts');
      await fs.writeFile(testFile, 'export function hello() {}');
      
      // Should not throw with verbose enabled
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig, { verbose: true })
      ).resolves.not.toThrow();
    });
    
    it('should respect custom chunk size from config', async () => {
      const testFile = path.join(testDir, 'test.ts');
      const content = 'a'.repeat(1000); // 1000 characters
      await fs.writeFile(testFile, content);
      
      const customConfig = {
        ...defaultConfig,
        indexing: {
          ...defaultConfig.indexing,
          chunkSize: 200,
          chunkOverlap: 50,
        },
      };
      
      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, customConfig)
      ).resolves.not.toThrow();
    });
  });
  
  describe('indexMultipleFiles', () => {
    it('should index multiple files', async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      
      await fs.writeFile(file1, 'export function one() {}');
      await fs.writeFile(file2, 'export function two() {}');
      
      const count = await indexMultipleFiles(
        [file1, file2],
        vectorDB,
        embeddings,
        defaultConfig
      );
      
      // Both files should be processed
      expect(count).toBe(2);
    });
    
    it('should handle empty array', async () => {
      const count = await indexMultipleFiles(
        [],
        vectorDB,
        embeddings,
        defaultConfig
      );
      
      expect(count).toBe(0);
    });
    
    it('should continue on individual file errors', async () => {
      const validFile = path.join(testDir, 'valid.ts');
      const invalidFile = path.join(testDir, 'invalid.ts');
      
      await fs.writeFile(validFile, 'export function valid() {}');
      // Don't create invalidFile
      
      const count = await indexMultipleFiles(
        [validFile, invalidFile],
        vectorDB,
        embeddings,
        defaultConfig
      );
      
      // Should process both, even though one fails (deleted files are handled)
      expect(count).toBe(2);
    });
    
    it('should process files sequentially', async () => {
      const files = [];
      for (let i = 0; i < 5; i++) {
        const file = path.join(testDir, `file${i}.ts`);
        await fs.writeFile(file, `export function func${i}() {}`);
        files.push(file);
      }
      
      const count = await indexMultipleFiles(
        files,
        vectorDB,
        embeddings,
        defaultConfig
      );
      
      expect(count).toBe(5);
    });
    
    it('should work with verbose mode', async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');
      
      await fs.writeFile(file1, 'export function one() {}');
      await fs.writeFile(file2, 'export function two() {}');
      
      const count = await indexMultipleFiles(
        [file1, file2],
        vectorDB,
        embeddings,
        defaultConfig,
        { verbose: true }
      );
      
      expect(count).toBe(2);
    });
    
    it('should handle mixed existing and non-existing files', async () => {
      const existingFile = path.join(testDir, 'exists.ts');
      const nonExistentFile1 = path.join(testDir, 'not-exists-1.ts');
      const nonExistentFile2 = path.join(testDir, 'not-exists-2.ts');
      
      await fs.writeFile(existingFile, 'export function exists() {}');
      
      const count = await indexMultipleFiles(
        [existingFile, nonExistentFile1, nonExistentFile2],
        vectorDB,
        embeddings,
        defaultConfig
      );
      
      expect(count).toBe(3);
    });
  });
});

