import { describe, it, expect, vi } from 'vitest';
import { search, scanWithFilter, querySymbols, scanPaginated } from './query.js';
import type { SearchResult } from './types.js';
import { DatabaseError } from '../errors/index.js';

describe('VectorDB Query Operations', () => {
  describe('search', () => {
    it('should throw DatabaseError if table is null', async () => {
      const queryVector = new Float32Array([1, 2, 3]);

      await expect(search(null, queryVector, 5)).rejects.toThrow(DatabaseError);
      await expect(search(null, queryVector, 5)).rejects.toThrow('Vector database not initialized');
    });

    it('should perform vector search with query boosting', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
              symbolType: 'function',
              _distance: 0.5,
            },
          ]),
        }),
      };

      const queryVector = new Float32Array([1, 2, 3]);
      const results = await search(mockTable, queryVector, 5, 'test function');

      expect(mockTable.search).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('function test() {}');
      expect(results[0].metadata.file).toBe('src/test.ts');
    });

    it('should include complexity metrics in search results', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function complex() { /* nested loops */ }',
              file: 'src/complex.ts',
              startLine: 1,
              endLine: 20,
              type: 'function',
              language: 'typescript',
              symbolName: 'complex',
              symbolType: 'function',
              complexity: 15,
              cognitiveComplexity: 25,
              _distance: 0.3,
            },
          ]),
        }),
      };

      const queryVector = new Float32Array([1, 2, 3]);
      const results = await search(mockTable, queryVector, 5, 'complex function');

      expect(results).toHaveLength(1);
      expect(results[0].metadata.complexity).toBe(15);
      expect(results[0].metadata.cognitiveComplexity).toBe(25);
    });

    it('should handle missing complexity metrics gracefully', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function simple() {}',
              file: 'src/simple.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'simple',
              symbolType: 'function',
              // No complexity or cognitiveComplexity fields
              _distance: 0.4,
            },
          ]),
        }),
      };

      const queryVector = new Float32Array([1, 2, 3]);
      const results = await search(mockTable, queryVector, 5, 'simple function');

      expect(results).toHaveLength(1);
      expect(results[0].metadata.complexity).toBeUndefined();
      expect(results[0].metadata.cognitiveComplexity).toBeUndefined();
    });

    it('should filter out empty content', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: '',
              file: 'src/empty.ts',
              startLine: 1,
              endLine: 1,
              type: 'block',
              language: 'typescript',
              _distance: 0.5,
            },
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              _distance: 0.6,
            },
          ]),
        }),
      };

      const queryVector = new Float32Array([1, 2, 3]);
      const results = await search(mockTable, queryVector, 5);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('function test() {}');
    });
  });

  describe('scanWithFilter', () => {
    it('should throw DatabaseError if table is null', async () => {
      await expect(scanWithFilter(null, {})).rejects.toThrow(DatabaseError);
    });

    it('should filter by language', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
            },
          ]),
        }),
      };

      const results = await scanWithFilter(mockTable, { language: 'typescript', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.language).toBe('typescript');
    });

    it('should filter by pattern', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function testHelper() {}',
              file: 'src/test-helper.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'testHelper',
            },
            {
              content: 'function otherFunction() {}',
              file: 'src/other.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'otherFunction',
            },
          ]),
        }),
      };

      const results = await scanWithFilter(mockTable, { pattern: 'test', limit: 10 });

      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by symbolType', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
              symbolType: 'function',
            },
            {
              content: 'class TestClass {}',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 10,
              type: 'class',
              language: 'typescript',
              symbolName: 'TestClass',
              symbolType: 'class',
            },
            {
              content: 'getName() { return this.name; }',
              file: 'src/test.ts',
              startLine: 12,
              endLine: 14,
              type: 'function',
              language: 'typescript',
              symbolName: 'getName',
              symbolType: 'method',
            },
          ]),
        }),
      };

      const classResults = await scanWithFilter(mockTable, { symbolType: 'class', limit: 10 });
      expect(classResults).toHaveLength(1);
      expect(classResults[0].metadata.symbolType).toBe('class');

      const funcResults = await scanWithFilter(mockTable, { symbolType: 'function', limit: 10 });
      // symbolType 'function' matches both 'function' and 'method'
      expect(funcResults).toHaveLength(2);
      expect(funcResults.map(r => r.metadata.symbolType)).toEqual(['function', 'method']);
    });

    it('should filter by single file path', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function foo() {}',
              file: 'src/foo.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
            },
            {
              content: 'function bar() {}',
              file: 'src/bar.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
            },
          ]),
        }),
      };

      const results = await scanWithFilter(mockTable, { file: 'src/foo.ts', limit: 10 });

      // Verify WHERE clause uses file = "..." instead of file != ""
      const whereCall = mockTable.search().where;
      expect(whereCall).toHaveBeenCalledWith('file = "src/foo.ts"');

      // Both records pass isValidRecord; file filtering is done by the WHERE clause in LanceDB
      expect(results).toHaveLength(2);
    });

    it('should filter by multiple file paths', async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function foo() {}',
              file: 'src/foo.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
            },
          ]),
        }),
      };

      const results = await scanWithFilter(mockTable, {
        file: ['src/foo.ts', 'src/bar.ts'],
        limit: 10,
      });

      const whereCall = mockTable.search().where;
      expect(whereCall).toHaveBeenCalledWith('file IN ("src/foo.ts", "src/bar.ts")');
      expect(results).toHaveLength(1);
    });

    it('should not call countRows when file filter is provided', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };

      await scanWithFilter(mockTable, { file: 'src/foo.ts', limit: 10 });

      expect(mockTable.countRows).not.toHaveBeenCalled();
    });

    it('should filter out empty string arrays from AST metadata', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              functionNames: [''],
              classNames: [''],
              interfaceNames: [''],
              parameters: [''],
              imports: [''],
            },
          ]),
        }),
      };

      const results = await scanWithFilter(mockTable, { limit: 10 });

      expect(results).toHaveLength(1);
      // Should filter out empty arrays and return undefined
      expect(results[0].metadata.parameters).toBeUndefined();
      expect(results[0].metadata.imports).toBeUndefined();
    });
  });

  describe('querySymbols', () => {
    it('should throw DatabaseError if table is null', async () => {
      await expect(querySymbols(null, {})).rejects.toThrow(DatabaseError);
    });

    it('should filter by language', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
              symbolType: 'function',
            },
            {
              content: 'def test(): pass',
              file: 'src/test.py',
              startLine: 1,
              endLine: 1,
              type: 'function',
              language: 'python',
              symbolName: 'test',
              symbolType: 'function',
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { language: 'typescript', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.language).toBe('typescript');
    });

    it('should filter by symbolType (function)', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
              symbolType: 'function',
              functionNames: ['test'],
            },
            {
              content: 'class TestClass {}',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 7,
              type: 'class',
              language: 'typescript',
              symbolName: 'TestClass',
              symbolType: 'class',
              classNames: ['TestClass'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'function', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbolType).toBe('function');
    });

    it('should filter by symbolType (class)', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'class TestClass {}',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 7,
              type: 'class',
              language: 'typescript',
              symbolName: 'TestClass',
              symbolType: 'class',
              classNames: ['TestClass'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'class', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbolType).toBe('class');
    });

    it('should filter by symbolType (interface)', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'interface ITest {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'interface',
              language: 'typescript',
              symbolName: 'ITest',
              symbolType: 'interface',
              interfaceNames: ['ITest'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'interface', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbolType).toBe('interface');
    });

    it('should filter by symbolType (method)', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function standalone() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'standalone',
              symbolType: 'function',
              functionNames: ['standalone'],
            },
            {
              content: 'getName() { return this.name; }',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 7,
              type: 'function',
              language: 'typescript',
              symbolName: 'getName',
              symbolType: 'method',
              functionNames: ['getName'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'method', limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbolType).toBe('method');
    });

    it('should include methods when filtering by symbolType function', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function standalone() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'standalone',
              symbolType: 'function',
              functionNames: ['standalone'],
            },
            {
              content: 'getName() { return this.name; }',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 7,
              type: 'function',
              language: 'typescript',
              symbolName: 'getName',
              symbolType: 'method',
              functionNames: ['getName'],
            },
            {
              content: 'class TestClass {}',
              file: 'src/test.ts',
              startLine: 9,
              endLine: 11,
              type: 'class',
              language: 'typescript',
              symbolName: 'TestClass',
              symbolType: 'class',
              classNames: ['TestClass'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'function', limit: 10 });

      expect(results).toHaveLength(2);
      expect(results.map(r => r.metadata.symbolType)).toEqual(['function', 'method']);
    });

    it('should filter by pattern', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function testHelper() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'testHelper',
              symbolType: 'function',
              functionNames: ['testHelper'],
            },
            {
              content: 'function otherFunction() {}',
              file: 'src/other.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'otherFunction',
              symbolType: 'function',
              functionNames: ['otherFunction'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { pattern: 'test', limit: 10 });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.metadata.symbolName?.includes('test'))).toBe(true);
    });

    it('should filter by pattern and symbolType together', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function testHelper() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'testHelper',
              symbolType: 'function',
              functionNames: ['testHelper'],
            },
            {
              content: 'class TestClass {}',
              file: 'src/test.ts',
              startLine: 5,
              endLine: 7,
              type: 'class',
              language: 'typescript',
              symbolName: 'TestClass',
              symbolType: 'class',
              classNames: ['TestClass'],
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, {
        pattern: 'test',
        symbolType: 'function',
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.symbolType).toBe('function');
    });

    it('should handle Arrow Vector array columns when filtering by symbolType', async () => {
      // Simulate Arrow Vector objects returned by LanceDB for array columns
      const makeArrowVector = (arr: string[]) => ({
        length: arr.length,
        toArray: () => arr,
        // Arrow Vectors don't have .some(), .filter(), etc.
      });

      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'class MyService {}',
              file: 'src/service.ts',
              startLine: 1,
              endLine: 10,
              type: 'class',
              language: 'typescript',
              symbolName: 'MyService',
              symbolType: 'class',
              functionNames: makeArrowVector(['']),
              classNames: makeArrowVector(['MyService']),
              interfaceNames: makeArrowVector(['']),
            },
            {
              content: 'function helper() {}',
              file: 'src/helper.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'helper',
              symbolType: 'function',
              functionNames: makeArrowVector(['helper']),
              classNames: makeArrowVector(['']),
              interfaceNames: makeArrowVector(['']),
            },
            {
              // Record with empty symbolType placeholder (batch-insert)
              content: 'const x = 1;',
              file: 'src/const.ts',
              startLine: 1,
              endLine: 1,
              type: 'block',
              language: 'typescript',
              symbolName: '',
              symbolType: '',
              functionNames: makeArrowVector(['']),
              classNames: makeArrowVector(['']),
              interfaceNames: makeArrowVector(['']),
            },
          ]),
        }),
      };

      const classResults = await querySymbols(mockTable, { symbolType: 'class', limit: 10 });
      expect(classResults).toHaveLength(1);
      expect(classResults[0].metadata.symbolName).toBe('MyService');

      const funcResults = await querySymbols(mockTable, { symbolType: 'function', limit: 10 });
      expect(funcResults).toHaveLength(1);
      expect(funcResults[0].metadata.symbolName).toBe('helper');
    });

    it('should handle records with no symbolType (fallback to pre-AST symbols)', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              functionNames: ['test'],
              classNames: [],
              interfaceNames: [],
              symbolName: '',
              symbolType: '',
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { symbolType: 'function', limit: 10 });

      expect(results).toHaveLength(1);
    });

    it('should filter out records with empty content', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: '',
              file: 'src/empty.ts',
              startLine: 1,
              endLine: 1,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
            },
            {
              content: 'function test() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
              symbolType: 'function',
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('function test() {}');
    });

    it('should filter out records with empty file paths', async () => {
      const mockTable = {
        countRows: vi.fn().mockResolvedValue(10),
        search: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([
            {
              content: 'function test() {}',
              file: '',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test',
            },
            {
              content: 'function test2() {}',
              file: 'src/test.ts',
              startLine: 1,
              endLine: 3,
              type: 'function',
              language: 'typescript',
              symbolName: 'test2',
              symbolType: 'function',
            },
          ]),
        }),
      };

      const results = await querySymbols(mockTable, { limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].metadata.file).toBe('src/test.ts');
    });
  });

  describe('scanPaginated', () => {
    it('should yield pages of results', async () => {
      const page1 = [
        {
          content: 'fn a() {}',
          file: 'a.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
        {
          content: 'fn b() {}',
          file: 'b.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
      ];
      const mockTable = {
        query: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce([]),
        }),
      };

      const pages: SearchResult[][] = [];
      for await (const page of scanPaginated(mockTable, { pageSize: 2 })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(2);
      expect(pages[0][0].content).toBe('fn a() {}');
      expect(pages[0][0].score).toBe(0);
      expect(pages[0][0].relevance).toBe('not_relevant');
    });

    it('should paginate across multiple pages', async () => {
      const page1 = [
        {
          content: 'fn a() {}',
          file: 'a.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
        {
          content: 'fn b() {}',
          file: 'b.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
      ];
      const page2 = [
        {
          content: 'fn c() {}',
          file: 'c.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
      ];
      const mockTable = {
        query: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2),
        }),
      };

      const pages: SearchResult[][] = [];
      for await (const page of scanPaginated(mockTable, { pageSize: 2 })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
    });

    it('should stop when empty page is returned', async () => {
      const mockTable = {
        query: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValueOnce([]),
        }),
      };

      const pages: SearchResult[][] = [];
      for await (const page of scanPaginated(mockTable)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(0);
    });

    it('should throw DatabaseError if table is null', async () => {
      const gen = scanPaginated(null);
      await expect(gen.next()).rejects.toThrow(DatabaseError);
    });

    it('should use custom filter when provided', async () => {
      const mockQueryBuilder = {
        where: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValueOnce([]),
      };
      const mockTable = {
        query: vi.fn().mockReturnValue(mockQueryBuilder),
      };

      const pages: SearchResult[][] = [];
      for await (const page of scanPaginated(mockTable, { filter: 'language = "typescript"' })) {
        pages.push(page);
      }

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('language = "typescript"');
    });

    it('should skip pages where all records are invalid', async () => {
      const invalidPage = [
        { content: '', file: '', startLine: 1, endLine: 1, type: 'block', language: 'typescript' },
      ];
      const validPage = [
        {
          content: 'fn a() {}',
          file: 'a.ts',
          startLine: 1,
          endLine: 3,
          type: 'function',
          language: 'typescript',
        },
      ];
      const mockTable = {
        query: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi
            .fn()
            .mockResolvedValueOnce(invalidPage)
            .mockResolvedValueOnce(validPage)
            .mockResolvedValueOnce([]),
        }),
      };

      const pages: SearchResult[][] = [];
      for await (const page of scanPaginated(mockTable, { pageSize: 1 })) {
        pages.push(page);
      }

      // invalidPage has 1 result (length === pageSize), so pagination continues
      // but the invalid records are filtered out, so that page is not yielded.
      // validPage also has 1 result (length === pageSize), so the loop advances
      // offset and queries again, getting an empty page which breaks the loop.
      expect(pages).toHaveLength(1);
      expect(pages[0][0].content).toBe('fn a() {}');
    });
  });
});
