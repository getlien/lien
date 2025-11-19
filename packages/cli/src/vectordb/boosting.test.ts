import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorDB } from './lancedb.js';
import { LocalEmbeddings } from '../embeddings/local.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Search Relevance Boosting', () => {
  let testDir: string;
  let vectorDB: VectorDB;
  let embeddings: LocalEmbeddings;
  
  beforeEach(async () => {
    // Create temporary directory for test database
    testDir = path.join(os.tmpdir(), `lien-boost-test-${Date.now()}`);
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
  
  describe('Path-Based Boosting', () => {
    it('should rank files with matching path segments higher', async () => {
      // Insert test chunks with different paths
      const chunks = [
        {
          content: 'const server = new Server();',
          file: 'packages/cli/src/mcp/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'const client = new Client();',
          file: 'packages/cli/src/utils/helper.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'const config = loadConfig();',
          file: 'packages/cli/src/config/loader.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      // Generate embeddings and insert
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(c => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        language: c.language,
      }));
      
      await vectorDB.insertBatch(vectors, metadatas, texts);
      
      // Search with query mentioning "mcp server"
      const query = 'How is the MCP server implemented?';
      const queryEmbedding = await embeddings.embed(query);
      const results = await vectorDB.search(queryEmbedding, 3, query);
      
      // The file in mcp/ directory should rank higher than others
      expect(results.length).toBeGreaterThan(0);
      const topFile = results[0].metadata.file;
      expect(topFile).toContain('mcp');
      expect(topFile).toContain('server');
    });
    
    it('should boost multiple path segments when they match', async () => {
      const chunks = [
        {
          content: 'export const tools = [];',
          file: 'packages/cli/src/mcp/tools.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const types = [];',
          file: 'packages/cli/src/types/index.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(c => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        language: c.language,
      }));
      
      await vectorDB.insertBatch(vectors, metadatas, texts);
      
      // Query mentioning both "mcp" and "tools"
      const query = 'MCP tools definitions';
      const queryEmbedding = await embeddings.embed(query);
      const results = await vectorDB.search(queryEmbedding, 2, query);
      
      // Should rank mcp/tools.ts highest
      expect(results[0].metadata.file).toContain('mcp/tools.ts');
    });
  });
  
  describe('Filename Boosting', () => {
    it('should rank files with matching filenames higher', async () => {
      const chunks = [
        {
          content: 'export const tools = [];',
          file: 'packages/cli/src/mcp/tools.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'import { tools } from "./tools";',
          file: 'packages/cli/src/mcp/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'const helper = () => {};',
          file: 'packages/cli/src/utils/helper.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(c => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        language: c.language,
      }));
      
      await vectorDB.insertBatch(vectors, metadatas, texts);
      
      // Query asking specifically about "tools"
      const query = 'Where are the tools defined?';
      const queryEmbedding = await embeddings.embed(query);
      const results = await vectorDB.search(queryEmbedding, 3, query);
      
      // tools.ts should rank at or near the top
      const toolsFileIndex = results.findIndex(r => r.metadata.file.includes('tools.ts'));
      expect(toolsFileIndex).toBeLessThanOrEqual(1); // Should be #1 or #2
    });
  });
  
  describe('Combined Boosting', () => {
    it('should apply both path and filename boosting together', async () => {
      const chunks = [
        {
          content: 'export async function startMCPServer() {}',
          file: 'packages/cli/src/mcp/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const serverConfig = {};',
          file: 'packages/cli/src/config/server.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
        {
          content: 'export const tools = [];',
          file: 'packages/cli/src/mcp/tools.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(c => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        language: c.language,
      }));
      
      await vectorDB.insertBatch(vectors, metadatas, texts);
      
      // Query that should match both path (mcp) and filename (server)
      const query = 'How is the MCP server implemented?';
      const queryEmbedding = await embeddings.embed(query);
      const results = await vectorDB.search(queryEmbedding, 3, query);
      
      // mcp/server.ts should rank #1 due to both boosts
      expect(results[0].metadata.file).toBe('packages/cli/src/mcp/server.ts');
    });
  });
  
  describe('Backward Compatibility', () => {
    it('should work without query parameter (no boosting)', async () => {
      const chunks = [
        {
          content: 'const test = 1;',
          file: 'test.ts',
          startLine: 1,
          endLine: 1,
          type: 'block' as const,
          language: 'typescript',
        },
      ];
      
      const texts = chunks.map(c => c.content);
      const vectors = await embeddings.embedBatch(texts);
      const metadatas = chunks.map(c => ({
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        type: c.type,
        language: c.language,
      }));
      
      await vectorDB.insertBatch(vectors, metadatas, texts);
      
      // Search without query parameter
      const queryEmbedding = await embeddings.embed('test code');
      const results = await vectorDB.search(queryEmbedding, 1);
      
      // Should still return results
      expect(results).toHaveLength(1);
      expect(results[0].metadata.file).toBe('test.ts');
    });
  });
});

