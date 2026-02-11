import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clear, deleteByFile, updateFile } from './maintenance.js';
import { DatabaseError } from '../errors/index.js';
import fs from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    rm: vi.fn(),
  },
}));

describe('VectorDB Maintenance Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('clear', () => {
    it('should drop table if it exists', async () => {
      const mockTable = {
        name: 'test_table',
      };
      const mockDb = {
        dropTable: vi.fn().mockResolvedValue(undefined),
      };

      await clear(mockDb, mockTable, 'test_table');

      expect(mockDb.dropTable).toHaveBeenCalledWith('test_table');
    });

    it('should do nothing when table is null', async () => {
      const mockDb = {
        dropTable: vi.fn().mockResolvedValue(undefined),
      };

      await clear(mockDb, null, 'test_table');

      expect(mockDb.dropTable).not.toHaveBeenCalled();
    });

    it('should throw DatabaseError if db is not initialized', async () => {
      await expect(clear(null, { name: 'test' }, 'test_table')).rejects.toThrow(DatabaseError);
      await expect(clear(null, { name: 'test' }, 'test_table')).rejects.toThrow(
        'Vector database not initialized',
      );
    });

    it('should wrap errors when dropTable fails', async () => {
      const mockDb = {
        dropTable: vi.fn().mockRejectedValue(new Error('Drop failed')),
      };

      await expect(clear(mockDb, { name: 'test' }, 'test_table')).rejects.toThrow(
        'Failed to clear vector database',
      );
    });

    it('should clean up .lance directory when dbPath is provided', async () => {
      const mockTable = { name: 'test_table' };
      const mockDb = { dropTable: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(fs.rm).mockResolvedValue(undefined);

      await clear(mockDb, mockTable, 'test_table', '/path/to/db');

      expect(fs.rm).toHaveBeenCalledWith('/path/to/db/test_table.lance', {
        recursive: true,
        force: true,
      });
    });

    it('should skip directory cleanup when dbPath is undefined', async () => {
      const mockTable = { name: 'test_table' };
      const mockDb = { dropTable: vi.fn().mockResolvedValue(undefined) };

      await clear(mockDb, mockTable, 'test_table');

      expect(fs.rm).not.toHaveBeenCalled();
    });

    it('should silently ignore errors when directory cleanup fails', async () => {
      const mockTable = { name: 'test_table' };
      const mockDb = { dropTable: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(fs.rm).mockRejectedValue(new Error('Directory not found'));

      // Should not throw
      await expect(clear(mockDb, mockTable, 'test_table', '/path/to/db')).resolves.toBeUndefined();
    });
  });

  describe('deleteByFile', () => {
    it('should delete records for specified file', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
      };

      await deleteByFile(mockTable, 'src/test.ts');

      expect(mockTable.delete).toHaveBeenCalledWith('file = "src/test.ts"');
    });

    it('should throw DatabaseError if table is null', async () => {
      await expect(deleteByFile(null, 'src/test.ts')).rejects.toThrow(DatabaseError);
      await expect(deleteByFile(null, 'src/test.ts')).rejects.toThrow(
        'Vector database not initialized',
      );
    });

    it('should handle deletion errors gracefully', async () => {
      const mockTable = {
        delete: vi.fn().mockRejectedValue(new Error('Delete failed')),
      };

      await expect(deleteByFile(mockTable, 'src/test.ts')).rejects.toThrow(
        'Failed to delete file from vector database',
      );
    });
  });

  describe('updateFile', () => {
    it('should delete old chunks and insert new ones', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
        add: vi.fn().mockResolvedValue(undefined),
      };
      const mockDb = {
        createTable: vi.fn(),
      };

      const vectors = [new Float32Array([1, 2, 3])];
      const metadatas = [
        {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['function test() {}'];

      const result = await updateFile(
        mockDb,
        mockTable,
        'test_table',
        '/path/to/db',
        'src/test.ts',
        vectors,
        metadatas,
        contents,
      );

      expect(mockTable.delete).toHaveBeenCalledWith('file = "src/test.ts"');
      expect(result).toBe(mockTable);
    });

    it('should throw DatabaseError if table is null', async () => {
      const vectors = [new Float32Array([1, 2, 3])];
      const metadatas = [
        {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['function test() {}'];

      await expect(
        updateFile(
          {},
          null,
          'test_table',
          '/path/to/db',
          'src/test.ts',
          vectors,
          metadatas,
          contents,
        ),
      ).rejects.toThrow(DatabaseError);
    });

    it('should handle empty vectors (delete only)', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const mockDb = {};

      const result = await updateFile(
        mockDb,
        mockTable,
        'test_table',
        '/path/to/db',
        'src/test.ts',
        [],
        [],
        [],
      );

      expect(mockTable.delete).toHaveBeenCalledWith('file = "src/test.ts"');
      expect(result).toBe(mockTable);
    });

    it('should handle insertBatch errors', async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const mockDb = {
        createTable: vi.fn().mockRejectedValue(new Error('Insert failed')),
      };

      const vectors = [new Float32Array([1, 2, 3])];
      const metadatas = [
        {
          file: 'src/test.ts',
          startLine: 1,
          endLine: 5,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      const contents = ['function test() {}'];

      await expect(
        updateFile(
          mockDb,
          mockTable,
          'test_table',
          '/path/to/db',
          'src/test.ts',
          vectors,
          metadatas,
          contents,
        ),
      ).rejects.toThrow('Failed to update file in vector database');
    });
  });
});
