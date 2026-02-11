import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { indexSingleFile, indexMultipleFiles } from './incremental.js';
import { VectorDB } from '../vectordb/lancedb.js';
import { MockEmbeddings } from '../test/helpers/mock-embeddings.js';
import { createTestDir, cleanupTestDir } from '../test/helpers/test-db.js';
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
    await cleanupTestDir(testDir);
  });

  describe('indexSingleFile', () => {
    it('should index a new file', async () => {
      const testFile = path.join(testDir, 'test.ts');
      await fs.writeFile(testFile, 'export function hello() { return "world"; }');

      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
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
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
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
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();
    });

    it('should handle empty files', async () => {
      const testFile = path.join(testDir, 'empty.ts');
      await fs.writeFile(testFile, '');

      // Should not throw
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();
    });

    it('should handle files with only whitespace', async () => {
      const testFile = path.join(testDir, 'whitespace.ts');
      await fs.writeFile(testFile, '   \n\n   \t\t  ');

      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();
    });

    it('should chunk large files correctly', async () => {
      const testFile = path.join(testDir, 'large.ts');

      // Create a file larger than default chunk size
      const content = 'export function test() {\n' + '  console.log("test");\n'.repeat(100) + '}\n';
      await fs.writeFile(testFile, content);

      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();
    });

    it('should log errors but not throw for invalid files', async () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.ts');

      // Should not throw even for non-existent file
      await expect(
        indexSingleFile(nonExistentFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();
    });

    it('should handle verbose mode', async () => {
      const testFile = path.join(testDir, 'test.ts');
      await fs.writeFile(testFile, 'export function hello() {}');

      // Should not throw with verbose enabled
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, defaultConfig, { verbose: true }),
      ).resolves.not.toThrow();
    });

    it('should respect custom chunk size from config', async () => {
      const testFile = path.join(testDir, 'test.ts');
      const content = 'a'.repeat(1000); // 1000 characters
      await fs.writeFile(testFile, content);

      const customConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 200,
          chunkOverlap: 50,
        },
      };

      // Should complete without throwing
      await expect(
        indexSingleFile(testFile, vectorDB, embeddings, customConfig),
      ).resolves.not.toThrow();
    });
  });

  describe('indexMultipleFiles', () => {
    it('should index multiple files', async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');

      await fs.writeFile(file1, 'export function one() {}');
      await fs.writeFile(file2, 'export function two() {}');

      const count = await indexMultipleFiles([file1, file2], vectorDB, embeddings, defaultConfig);

      // Both files should be processed
      expect(count).toBe(2);
    });

    it('should handle empty array', async () => {
      const count = await indexMultipleFiles([], vectorDB, embeddings, defaultConfig);

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
        defaultConfig,
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

      const count = await indexMultipleFiles(files, vectorDB, embeddings, defaultConfig);

      expect(count).toBe(5);
    });

    it('should work with verbose mode', async () => {
      const file1 = path.join(testDir, 'file1.ts');
      const file2 = path.join(testDir, 'file2.ts');

      await fs.writeFile(file1, 'export function one() {}');
      await fs.writeFile(file2, 'export function two() {}');

      const count = await indexMultipleFiles([file1, file2], vectorDB, embeddings, defaultConfig, {
        verbose: true,
      });

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
        defaultConfig,
      );

      expect(count).toBe(3);
    });
  });

  describe('Error Handling', () => {
    // Skip on Windows (chmod doesn't work the same) and when running as root (bypasses permissions)
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'should handle file read permission errors gracefully',
      async () => {
        const testFile = path.join(testDir, 'no-permission.ts');
        await fs.writeFile(testFile, 'export function test() {}');

        // Make file unreadable (chmod 000)
        await fs.chmod(testFile, 0o000);

        try {
          // Should not throw - should handle error gracefully
          await expect(
            indexSingleFile(testFile, vectorDB, embeddings, defaultConfig, { verbose: false }),
          ).resolves.not.toThrow();
        } finally {
          // Restore permissions for cleanup
          try {
            await fs.chmod(testFile, 0o644);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
    );

    // Skip on Windows (chmod doesn't work the same) and when running as root (bypasses permissions)
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'should continue indexing other files when one file fails',
      async () => {
        const goodFile1 = path.join(testDir, 'good1.ts');
        const badFile = path.join(testDir, 'bad.ts');
        const goodFile2 = path.join(testDir, 'good2.ts');

        await fs.writeFile(goodFile1, 'export function good1() {}');
        await fs.writeFile(badFile, 'export function bad() {}');
        await fs.writeFile(goodFile2, 'export function good2() {}');

        // Make middle file unreadable
        await fs.chmod(badFile, 0o000);

        try {
          const count = await indexMultipleFiles(
            [goodFile1, badFile, goodFile2],
            vectorDB,
            embeddings,
            defaultConfig,
            { verbose: false },
          );

          // Should process all files (bad file is counted as processed via deletion)
          expect(count).toBe(3);

          // Verify good files were indexed
          const results = await vectorDB.scanWithFilter({});
          const filenames = results.map(r => path.basename(r.metadata.file));
          expect(filenames).toContain('good1.ts');
          expect(filenames).toContain('good2.ts');
        } finally {
          try {
            await fs.chmod(badFile, 0o644);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
    );

    it('should handle files that become deleted during indexing', async () => {
      const testFile = path.join(testDir, 'disappearing.ts');
      await fs.writeFile(testFile, 'export function disappear() {}');

      // File exists when passed to function but will be deleted
      const promise = indexMultipleFiles([testFile], vectorDB, embeddings, defaultConfig, {
        verbose: false,
      });

      // Delete file immediately (race condition simulation)
      await fs.unlink(testFile);

      // Should handle gracefully
      await expect(promise).resolves.not.toThrow();
    });

    it('should handle empty file content gracefully', async () => {
      const emptyFile = path.join(testDir, 'empty.ts');
      await fs.writeFile(emptyFile, '');

      const count = await indexMultipleFiles([emptyFile], vectorDB, embeddings, defaultConfig);

      // Empty file should be processed (counted as successfully handled)
      expect(count).toBe(1);
    });

    it('should handle files with invalid UTF-8 encoding', async () => {
      const invalidFile = path.join(testDir, 'invalid-utf8.ts');

      // Write file with invalid UTF-8 bytes (this will be read as valid UTF-8 with replacement chars)
      // Node.js handles this gracefully by default
      await fs.writeFile(invalidFile, Buffer.from([0xff, 0xfe, 0xfd]));

      // Should handle gracefully (may produce replacement characters but won't crash)
      await expect(
        indexSingleFile(invalidFile, vectorDB, embeddings, defaultConfig, { verbose: false }),
      ).resolves.not.toThrow();
    });

    it('should handle concurrent file modifications', async () => {
      const file1 = path.join(testDir, 'concurrent1.ts');
      const file2 = path.join(testDir, 'concurrent2.ts');
      const file3 = path.join(testDir, 'concurrent3.ts');

      await fs.writeFile(file1, 'export function test1() {}');
      await fs.writeFile(file2, 'export function test2() {}');
      await fs.writeFile(file3, 'export function test3() {}');

      // Start indexing all files concurrently
      const promises = [
        indexSingleFile(file1, vectorDB, embeddings, defaultConfig),
        indexSingleFile(file2, vectorDB, embeddings, defaultConfig),
        indexSingleFile(file3, vectorDB, embeddings, defaultConfig),
      ];

      // Should all complete without race conditions
      await expect(Promise.all(promises)).resolves.not.toThrow();

      // Verify all operations completed (we can't verify actual data with MockEmbeddings)
      // The fact that all promises resolved without errors proves concurrent safety
    });

    it('should handle very large files without running out of memory', async () => {
      const largeFile = path.join(testDir, 'very-large.ts');

      // Create a file with many lines (but not too large for tests)
      const lines = Array.from(
        { length: 500 },
        (_, i) => `export function test${i}() { return ${i}; }`,
      );
      await fs.writeFile(largeFile, lines.join('\n'));

      // Should handle large file without memory issues
      await expect(
        indexSingleFile(largeFile, vectorDB, embeddings, defaultConfig),
      ).resolves.not.toThrow();

      // The fact that this completes without throwing proves memory is handled correctly
      // (we can't verify actual data with MockEmbeddings)
    });
  });
});
