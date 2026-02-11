import { describe, it, expect, vi } from 'vitest';
import { insertBatch } from './batch-insert.js';
import { DatabaseError } from '../errors/index.js';
import type { LanceDBConnection, LanceDBTable } from './lancedb-types.js';
import type { ChunkMetadata } from '../indexer/types.js';
import { VECTOR_DB_MAX_BATCH_SIZE, VECTOR_DB_MIN_BATCH_SIZE } from '../constants.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (obj: any) => obj as unknown as LanceDBConnection;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asTable = (obj: any) => obj as unknown as LanceDBTable;

// Helper to create mock metadata
function createMockMetadata(file: string, startLine: number = 1): ChunkMetadata {
  return {
    file,
    startLine,
    endLine: startLine + 10,
    type: 'function',
    language: 'typescript',
    symbols: {
      functions: ['testFunc'],
      classes: [],
      interfaces: [],
    },
    symbolName: 'testFunc',
    symbolType: 'function',
    complexity: 5,
    parameters: ['param1: string'],
    signature: 'function testFunc(param1: string)',
    imports: ['./utils.js'],
  };
}

// Helper to create test data
function createTestData(count: number) {
  const vectors: Float32Array[] = [];
  const metadatas: ChunkMetadata[] = [];
  const contents: string[] = [];

  for (let i = 0; i < count; i++) {
    vectors.push(new Float32Array([i, i + 1, i + 2]));
    metadatas.push(createMockMetadata(`file${i}.ts`, i * 10));
    contents.push(`content ${i}`);
  }

  return { vectors, metadatas, contents };
}

describe('batch-insert', () => {
  describe('insertBatch', () => {
    describe('validation', () => {
      it('should throw DatabaseError when db is not initialized', async () => {
        const { vectors, metadatas, contents } = createTestData(1);

        await expect(
          insertBatch(asDb(null), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow(new DatabaseError('Vector database not initialized'));
      });

      it('should throw DatabaseError when array lengths do not match', async () => {
        const mockDb = { createTable: vi.fn() };
        const vectors = [new Float32Array([1, 2, 3])];
        const metadatas = [createMockMetadata('test.ts'), createMockMetadata('test2.ts')];
        const contents = ['content'];

        await expect(
          insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow('Vectors, metadatas, and contents arrays must have the same length');
      });

      it('should throw DatabaseError when vectors and contents lengths differ', async () => {
        const mockDb = { createTable: vi.fn() };
        const vectors = [new Float32Array([1, 2, 3])];
        const metadatas = [createMockMetadata('test.ts')];
        const contents = ['content1', 'content2'];

        await expect(
          insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow('Vectors, metadatas, and contents arrays must have the same length');
      });
    });

    describe('empty batch handling', () => {
      it('should return null when batch is empty and table is null', async () => {
        const mockDb = { createTable: vi.fn() };

        const result = await insertBatch(asDb(mockDb), null, 'test_table', [], [], []);

        expect(result).toBeNull();
        expect(mockDb.createTable).not.toHaveBeenCalled();
      });

      it('should return existing table when batch is empty', async () => {
        const mockDb = { createTable: vi.fn() };
        const mockTable = { add: vi.fn() };

        const result = await insertBatch(
          asDb(mockDb),
          asTable(mockTable),
          'test_table',
          [],
          [],
          [],
        );

        expect(result).toBe(mockTable);
        expect(mockTable.add).not.toHaveBeenCalled();
      });
    });

    describe('table creation', () => {
      it('should create new table when table is null', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };
        const { vectors, metadatas, contents } = createTestData(1);

        const result = await insertBatch(
          asDb(mockDb),
          null,
          'test_table',
          vectors,
          metadatas,
          contents,
        );

        expect(mockDb.createTable).toHaveBeenCalledWith('test_table', expect.any(Array));
        expect(result).toBe(mockTable);
      });

      it('should add to existing table when table exists', async () => {
        const mockTable = {
          add: vi.fn().mockResolvedValue(undefined),
        };
        const mockDb = { createTable: vi.fn() };
        const { vectors, metadatas, contents } = createTestData(1);

        const result = await insertBatch(
          asDb(mockDb),
          asTable(mockTable),
          'test_table',
          vectors,
          metadatas,
          contents,
        );

        expect(mockDb.createTable).not.toHaveBeenCalled();
        expect(mockTable.add).toHaveBeenCalledWith(expect.any(Array));
        expect(result).toBe(mockTable);
      });
    });

    describe('record transformation', () => {
      it('should transform metadata correctly into records', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };

        const vectors = [new Float32Array([1, 2, 3])];
        const metadatas: ChunkMetadata[] = [
          {
            file: 'src/test.ts',
            startLine: 10,
            endLine: 20,
            type: 'function',
            language: 'typescript',
            symbols: {
              functions: ['myFunc', 'otherFunc'],
              classes: ['MyClass'],
              interfaces: ['MyInterface'],
            },
            symbolName: 'myFunc',
            symbolType: 'function',
            parentClass: 'MyClass',
            complexity: 15,
            cognitiveComplexity: 25,
            parameters: ['a: string', 'b: number'],
            signature: 'function myFunc(a: string, b: number): void',
            imports: ['./utils.js', './types.js'],
          },
        ];
        const contents = ['function myFunc() {}'];

        await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);

        const createdRecords = mockDb.createTable.mock.calls[0][1];
        expect(createdRecords).toHaveLength(1);
        expect(createdRecords[0]).toEqual({
          vector: [1, 2, 3],
          content: 'function myFunc() {}',
          file: 'src/test.ts',
          startLine: 10,
          endLine: 20,
          type: 'function',
          language: 'typescript',
          functionNames: ['myFunc', 'otherFunc'],
          classNames: ['MyClass'],
          interfaceNames: ['MyInterface'],
          symbolName: 'myFunc',
          symbolType: 'function',
          parentClass: 'MyClass',
          complexity: 15,
          cognitiveComplexity: 25,
          parameters: ['a: string', 'b: number'],
          signature: 'function myFunc(a: string, b: number): void',
          imports: ['./utils.js', './types.js'],
          // Halstead metrics (v0.19.0)
          halsteadVolume: 0,
          halsteadDifficulty: 0,
          halsteadEffort: 0,
          halsteadBugs: 0,
          // Symbol-level tracking (v0.23.0) - placeholders for missing data
          exports: [''],
          importedSymbolPaths: [''],
          importedSymbolNames: [''],
          callSiteSymbols: [''],
          callSiteLines: [0],
        });
      });

      it('should use empty string placeholders for missing array metadata', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };

        const vectors = [new Float32Array([1, 2, 3])];
        const metadatas: ChunkMetadata[] = [
          {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'block',
            language: 'typescript',
            // No symbols, parameters, imports
          },
        ];
        const contents = ['some code'];

        await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);

        const createdRecords = mockDb.createTable.mock.calls[0][1];
        expect(createdRecords[0].functionNames).toEqual(['']);
        expect(createdRecords[0].classNames).toEqual(['']);
        expect(createdRecords[0].interfaceNames).toEqual(['']);
        expect(createdRecords[0].parameters).toEqual(['']);
        expect(createdRecords[0].imports).toEqual(['']);
        expect(createdRecords[0].symbolName).toBe('');
        expect(createdRecords[0].symbolType).toBe('');
        expect(createdRecords[0].parentClass).toBe('');
        expect(createdRecords[0].complexity).toBe(0);
        expect(createdRecords[0].cognitiveComplexity).toBe(0);
        expect(createdRecords[0].signature).toBe('');
      });

      it('should handle empty arrays in metadata', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };

        const vectors = [new Float32Array([1, 2, 3])];
        const metadatas: ChunkMetadata[] = [
          {
            file: 'src/test.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            language: 'typescript',
            symbols: {
              functions: [],
              classes: [],
              interfaces: [],
            },
            parameters: [],
            imports: [],
          },
        ];
        const contents = ['some code'];

        await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);

        const createdRecords = mockDb.createTable.mock.calls[0][1];
        // Empty arrays should be replaced with [''] for Arrow type inference
        expect(createdRecords[0].functionNames).toEqual(['']);
        expect(createdRecords[0].classNames).toEqual(['']);
        expect(createdRecords[0].interfaceNames).toEqual(['']);
        expect(createdRecords[0].parameters).toEqual(['']);
        expect(createdRecords[0].imports).toEqual(['']);
      });
    });

    describe('large batch splitting', () => {
      it('should split batches larger than VECTOR_DB_MAX_BATCH_SIZE', async () => {
        const mockTable = { add: vi.fn().mockResolvedValue(undefined) };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };

        // Create batch larger than max size
        const batchSize = VECTOR_DB_MAX_BATCH_SIZE + 100;
        const { vectors, metadatas, contents } = createTestData(batchSize);

        await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);

        // First batch creates table, second batch adds to it
        expect(mockDb.createTable).toHaveBeenCalledTimes(1);
        expect(mockTable.add).toHaveBeenCalledTimes(1);
      });

      it('should handle exact max batch size without splitting', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };

        // Create batch exactly at max size
        const { vectors, metadatas, contents } = createTestData(VECTOR_DB_MAX_BATCH_SIZE);

        await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);

        // Should be processed in one batch
        expect(mockDb.createTable).toHaveBeenCalledTimes(1);
        expect(mockTable.add).not.toHaveBeenCalled();
      });
    });

    describe('retry logic', () => {
      it('should split and retry when batch insertion fails', async () => {
        let callCount = 0;
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // First call fails
              throw new Error('Batch too large');
            }
            // Subsequent calls succeed
            return Promise.resolve(mockTable);
          }),
        };

        // Create batch larger than min size so it can be split
        const batchSize = VECTOR_DB_MIN_BATCH_SIZE * 2 + 2;
        const { vectors, metadatas, contents } = createTestData(batchSize);

        const result = await insertBatch(
          asDb(mockDb),
          null,
          'test_table',
          vectors,
          metadatas,
          contents,
        );

        // Should have retried with smaller batches
        expect(mockDb.createTable).toHaveBeenCalledTimes(2);
        expect(result).toBe(mockTable);
      });

      it('should throw DatabaseError when small batches fail after retries', async () => {
        const mockDb = {
          createTable: vi.fn().mockRejectedValue(new Error('Persistent error')),
        };

        // Create batch at min size (cannot be split further)
        const { vectors, metadatas, contents } = createTestData(VECTOR_DB_MIN_BATCH_SIZE);

        await expect(
          insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow(/Failed to insert .* record\(s\) after retry attempts/);
      });

      it('should include error details when insertion fails', async () => {
        const mockDb = {
          createTable: vi.fn().mockRejectedValue(new Error('Persistent error')),
        };

        const { vectors, metadatas, contents } = createTestData(VECTOR_DB_MIN_BATCH_SIZE);

        try {
          await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DatabaseError);
          const dbError = error as DatabaseError;
          expect(dbError.context).toHaveProperty('failedBatches');
          expect(dbError.context).toHaveProperty('totalRecords');
          expect(dbError.context).toHaveProperty('sampleFile');
        }
      });

      it('should preserve the last error message for debugging', async () => {
        const mockDb = {
          createTable: vi.fn().mockRejectedValue(new Error('Schema mismatch: column type invalid')),
        };

        const { vectors, metadatas, contents } = createTestData(VECTOR_DB_MIN_BATCH_SIZE);

        try {
          await insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DatabaseError);
          const dbError = error as DatabaseError;
          expect(dbError.context).toHaveProperty('lastError');
          expect(dbError.context?.lastError).toBe('Schema mismatch: column type invalid');
        }
      });
    });

    describe('mixed success/failure scenarios', () => {
      it('should throw when all small batches ultimately fail after splitting', async () => {
        // This test verifies that when records can't be inserted even after
        // splitting down to minimum batch size, an error is thrown
        const mockDb = {
          createTable: vi.fn().mockRejectedValue(new Error('Always fails')),
        };

        // Create a batch that will be split multiple times before failing
        const batchSize = VECTOR_DB_MIN_BATCH_SIZE * 3;
        const { vectors, metadatas, contents } = createTestData(batchSize);

        // This should throw because all batches fail after splitting
        await expect(
          insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow(/Failed to insert .* record\(s\) after retry attempts/);
      });

      it('should continue processing after partial batch failures with splits', async () => {
        let _callCount = 0;
        const mockTable = { add: vi.fn().mockResolvedValue(undefined) };
        const mockDb = {
          createTable: vi.fn().mockImplementation((_name, records) => {
            _callCount++;
            // Fail on larger batches, succeed on smaller ones
            if (records.length > VECTOR_DB_MIN_BATCH_SIZE * 2) {
              throw new Error('Batch too large');
            }
            return Promise.resolve(mockTable);
          }),
        };

        // Create batch that needs splitting
        const batchSize = VECTOR_DB_MIN_BATCH_SIZE * 4;
        const { vectors, metadatas, contents } = createTestData(batchSize);

        const result = await insertBatch(
          asDb(mockDb),
          null,
          'test_table',
          vectors,
          metadatas,
          contents,
        );

        expect(result).toBe(mockTable);
        // Should have made multiple createTable calls
        expect(mockDb.createTable.mock.calls.length).toBeGreaterThan(1);
      });
    });

    describe('edge cases', () => {
      it('should handle single record batch', async () => {
        const mockTable = { add: vi.fn() };
        const mockDb = {
          createTable: vi.fn().mockResolvedValue(mockTable),
        };
        const { vectors, metadatas, contents } = createTestData(1);

        const result = await insertBatch(
          asDb(mockDb),
          null,
          'test_table',
          vectors,
          metadatas,
          contents,
        );

        expect(mockDb.createTable).toHaveBeenCalledTimes(1);
        expect(result).toBe(mockTable);
      });

      it('should throw when table creation fails with no existing table', async () => {
        const mockDb = {
          createTable: vi.fn().mockRejectedValue(new Error('Creation failed')),
        };
        const { vectors, metadatas, contents } = createTestData(1);

        await expect(
          insertBatch(asDb(mockDb), null, 'test_table', vectors, metadatas, contents),
        ).rejects.toThrow(DatabaseError);
      });
    });
  });
});
