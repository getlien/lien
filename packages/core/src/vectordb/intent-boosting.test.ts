import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from './lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Intent-Specific Boosting Integration Tests', () => {
  let testDir: string;
  let vectorDB: VectorDB;
  let embeddings: LocalEmbeddings;
  
  beforeEach(async () => {
    // Create temporary directory for test database
    testDir = path.join(os.tmpdir(), `lien-intent-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Initialize embeddings and vector DB
    embeddings = new LocalEmbeddings();
    await embeddings.initialize();
    
    vectorDB = new VectorDB(testDir);
    await vectorDB.initialize();
  });
  
  afterEach(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  describe('LOCATION Intent Boosting', () => {
    it('should strongly boost files with exact filename matches', async () => {
      const chunks = [
        {
          content: 'export const server = {};',
          file: 'packages/cli/src/mcp/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const config = {};',
          file: 'packages/cli/src/config/server-config.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const handler = {};',
          file: 'packages/cli/src/api/handler.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      // Insert chunks
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      // LOCATION query: "where is the server"
      const query = 'where is the server';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // The exact match "server.ts" should rank higher than "server-config.ts"
      const serverIndex = results.findIndex(r => r.metadata.file.includes('mcp/server.ts'));
      const serverConfigIndex = results.findIndex(r => r.metadata.file.includes('server-config.ts'));
      
      expect(serverIndex).toBeGreaterThanOrEqual(0);
      expect(serverIndex).toBeLessThan(serverConfigIndex);
    });
    
    it('should penalize test files for LOCATION queries', async () => {
      const chunks = [
        {
          content: 'export const handler = { process() { /* main handler logic */ } };',
          file: 'packages/cli/src/api/handler.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'describe("handler", () => { it("should process requests", () => {}); });',
          file: 'packages/cli/src/api/handler.test.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'where is the handler';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 2, query);
      
      // Source file should rank higher than test file for LOCATION queries
      const sourceIndex = results.findIndex(r => r.metadata.file === 'packages/cli/src/api/handler.ts');
      const testIndex = results.findIndex(r => r.metadata.file.includes('.test.ts'));
      
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      // Either source ranks higher, or they're very close (test penalty is working)
      if (testIndex >= 0) {
        expect(sourceIndex).toBeLessThanOrEqual(testIndex);
      }
    });
    
    it('should boost path matches for LOCATION queries', async () => {
      const chunks = [
        {
          content: 'export const controller = {};',
          file: 'packages/cli/src/mcp/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const tools = {};',
          file: 'packages/cli/src/mcp/tools.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const config = {};',
          file: 'packages/cli/src/config/main.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'where is the mcp code';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Files in mcp/ directory should rank higher
      const mcpFiles = results.filter(r => r.metadata.file.includes('/mcp/'));
      expect(mcpFiles.length).toBeGreaterThan(0);
      
      // At least one mcp file should be in top 2
      const topTwo = results.slice(0, 2);
      const hasMcpInTopTwo = topTwo.some(r => r.metadata.file.includes('/mcp/'));
      expect(hasMcpInTopTwo).toBe(true);
    });
  });
  
  describe('CONCEPTUAL Intent Boosting', () => {
    it('should strongly boost documentation files', async () => {
      const chunks = [
        {
          content: 'Authentication process explained',
          file: 'docs/architecture/authentication.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'export class AuthService {}',
          file: 'packages/cli/src/auth/service.ts',
          startLine: 1,
          endLine: 1,
          type: 'class' as const,
          language: 'typescript',
        },
        {
          content: 'describe("AuthService", () => {});',
          file: 'packages/cli/src/auth/service.test.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'how does authentication work';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Documentation file should rank at or near the top
      const docIndex = results.findIndex(r => r.metadata.file.includes('docs/'));
      expect(docIndex).toBeGreaterThanOrEqual(0);
      expect(docIndex).toBeLessThanOrEqual(1); // Should be #1 or #2
    });
    
    it('should extra boost architecture documentation', async () => {
      const chunks = [
        {
          content: 'System architecture overview',
          file: 'docs/architecture/system-overview.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'User guide for the system',
          file: 'docs/guides/user-guide.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'export const system = {};',
          file: 'packages/cli/src/system/main.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'how does the system architecture work';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Architecture doc should rank highest
      const archIndex = results.findIndex(r => r.metadata.file.includes('architecture'));
      expect(archIndex).toBe(0); // Should be #1
    });
    
    it('should penalize utility files for CONCEPTUAL queries', async () => {
      const chunks = [
        {
          content: 'Validation process documentation',
          file: 'docs/validation.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'export class Validator {}',
          file: 'packages/cli/src/validators/main.ts',
          startLine: 1,
          endLine: 1,
          type: 'class' as const,
          language: 'typescript',
        },
        {
          content: 'export function isString() {}',
          file: 'packages/cli/src/utils/validation-utils.ts',
          startLine: 1,
          endLine: 1,
          type: 'function' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'how does validation work';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Utility file should rank lower than main validator
      const utilsIndex = results.findIndex(r => r.metadata.file.includes('utils'));
      const mainIndex = results.findIndex(r => r.metadata.file.includes('validators/main'));
      
      if (utilsIndex >= 0 && mainIndex >= 0) {
        expect(utilsIndex).toBeGreaterThan(mainIndex);
      }
    });
    
    it('should boost README files for CONCEPTUAL queries', async () => {
      const chunks = [
        {
          content: 'README: How the system works',
          file: 'README.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'export const system = {};',
          file: 'packages/cli/src/system/index.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'what is the system';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 2, query);
      
      // README should rank at or near top
      const readmeIndex = results.findIndex(r => r.metadata.file.includes('README'));
      expect(readmeIndex).toBeGreaterThanOrEqual(0);
      expect(readmeIndex).toBeLessThanOrEqual(1);
    });
  });
  
  describe('IMPLEMENTATION Intent Boosting', () => {
    it('should use balanced boosting for implementation queries', async () => {
      const chunks = [
        {
          content: 'export class AuthService { async login(username: string, password: string) { /* authentication logic with JWT tokens */ } }',
          file: 'packages/cli/src/auth/service.ts',
          startLine: 1,
          endLine: 1,
          type: 'class' as const,
          language: 'typescript',
        },
        {
          content: '# Authentication\n\nThe authentication system provides secure user login.',
          file: 'docs/auth.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'how is authentication implemented';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 2, query);
      
      // Implementation file should rank at or near top for IMPLEMENTATION queries
      const implIndex = results.findIndex(r => r.metadata.file.includes('service.ts'));
      
      expect(implIndex).toBeGreaterThanOrEqual(0);
      expect(implIndex).toBeLessThanOrEqual(1); // Should be in top 2
    });
    
    it('should boost test files moderately for IMPLEMENTATION queries', async () => {
      const chunks = [
        {
          content: 'export class Service {}',
          file: 'packages/cli/src/service.ts',
          startLine: 1,
          endLine: 1,
          type: 'class' as const,
          language: 'typescript',
        },
        {
          content: 'it("should call service.method()", () => { service.method(); })',
          file: 'packages/cli/src/service.test.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'Service usage documentation',
          file: 'docs/service.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'how is the service implemented';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Test file should rank reasonably high (shows real usage)
      const testIndex = results.findIndex(r => r.metadata.file.includes('.test.ts'));
      expect(testIndex).toBeGreaterThanOrEqual(0);
      expect(testIndex).toBeLessThan(3); // Should be in top 3
    });
  });
  
  describe('Real-World Dogfooding Queries', () => {
    it('should handle "how does X work" queries (CONCEPTUAL)', async () => {
      const chunks = [
        {
          content: 'Indexing process documentation',
          file: 'docs/architecture/indexing-flow.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'export async function indexCodebase() {}',
          file: 'packages/cli/src/indexer/index.ts',
          startLine: 1,
          endLine: 1,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          content: 'Configuration for indexing',
          file: 'packages/cli/src/config/indexing.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'How does the indexing process work from start to finish?';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Documentation should be prioritized for conceptual queries
      const docIndex = results.findIndex(r => r.metadata.file.includes('docs/'));
      expect(docIndex).toBeGreaterThanOrEqual(0);
      expect(docIndex).toBeLessThanOrEqual(1); // Should be in top 2
    });
    
    it('should handle "where is X" queries (LOCATION)', async () => {
      const chunks = [
        {
          content: 'export async function indexCodebase() { /* main indexing implementation with file scanning and chunking */ }',
          file: 'packages/cli/src/indexer/index.ts',
          startLine: 1,
          endLine: 1,
          type: 'function' as const,
          language: 'typescript',
        },
        {
          content: '# Indexing\n\nDocumentation about how indexing works in the system.',
          file: 'docs/indexing.md',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'markdown',
        },
        {
          content: 'describe("indexCodebase", () => { it("should index files", () => {}); });',
          file: 'packages/cli/src/indexer/index.test.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vectors: Float32Array[] = [];
      const contents: string[] = [];
      for (const chunk of chunks) {
        const vector = await embeddings.embed(chunk.content);
        vectors.push(vector);
        contents.push(chunk.content);
      }
      await vectorDB.insertBatch(vectors, chunks, contents);
      
      const query = 'Where is the main indexing logic located?';
      const queryVector = await embeddings.embed(query);
      const results = await vectorDB.search(queryVector, 3, query);
      
      // Source file should rank at or near top, definitely above test file
      const sourceIndex = results.findIndex(r => r.metadata.file === 'packages/cli/src/indexer/index.ts');
      const testIndex = results.findIndex(r => r.metadata.file.includes('.test.ts'));
      
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      expect(sourceIndex).toBeLessThanOrEqual(1); // Should be #1 or #2
      
      // Test file should be penalized (rank lower than source)
      if (testIndex >= 0) {
        expect(sourceIndex).toBeLessThan(testIndex);
      }
    });
  });
  
  describe('Backward Compatibility', () => {
    it('should handle searches without query parameter', async () => {
      const chunks = [
        {
          content: 'export const handler = {};',
          file: 'packages/cli/src/handler.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const vector = await embeddings.embed(chunks[0].content);
      await vectorDB.insertBatch([vector], chunks, [chunks[0].content]);
      
      // Search without query parameter (should not crash)
      const queryVector = await embeddings.embed('handler');
      const results = await vectorDB.search(queryVector, 1);
      
      expect(results.length).toBe(1);
      expect(results[0].metadata.file).toBe('packages/cli/src/handler.ts');
    });
  });
});

