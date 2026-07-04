import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { indexCodebase, createVectorDB, type VectorDBInterface } from '@liendev/core';
import { createTestDir, cleanupTestDir, createTestFile } from '@liendev/core/test';
import { createMCPServerConfig, registerMCPHandlers } from '../../src/mcp/server-config.js';
import { createReindexStateManager } from '../../src/mcp/reindex-state-manager.js';
import type { ToolContext } from '../../src/mcp/types.js';

/**
 * Real MCP protocol round trip proving lexical (FTS5) search end to end:
 *
 * - `indexCodebase()` builds a real SQLite index of a tiny fixture repo
 *   without ever computing embeddings (no model, no worker thread).
 * - `search_code` runs a real FTS5 keyword query against that index and
 *   returns real chunks with a populated relevance category — proving the
 *   lexical path is live (not the old "embeddings disabled" stub).
 * - The structural tools (get_files_context, list_functions) return correct
 *   data over the same real round trip.
 *
 * Uses the default sqlite backend, so this runs in the
 * fast suite (no model download) — unlike test/e2e/mcp-roundtrip.test.ts.
 */
const TIMEOUT = 30_000;

const FIXTURE_FILES: Record<string, string> = {
  'math-utils.ts': `export function addNumbers(a: number, b: number): number {
  return a + b;
}

export function multiplyNumbers(a: number, b: number): number {
  return a * b;
}
`,
  'main.ts': `import { addNumbers } from './math-utils.js';

export function sumAll(values: number[]): number {
  return values.reduce((total, v) => addNumbers(total, v), 0);
}
`,
  'math-utils.test.ts': `import { describe, it, expect } from 'vitest';
import { addNumbers } from './math-utils';

describe('addNumbers', () => {
  it('adds two numbers', () => {
    expect(addNumbers(2, 3)).toBe(5);
  });
});
`,
};

/** Parse the JSON text payload out of a real tools/call response. */
function parseToolResponse(result: CallToolResult): any {
  const [first] = result.content as Array<{ type: string; text: string }>;
  expect(first?.type).toBe('text');
  return JSON.parse(first.text);
}

describe('Lexical FTS5 search — real MCP round trip', () => {
  let fixtureDir: string;
  let vectorDB: VectorDBInterface;
  let client: Client;
  let server: Server;

  beforeAll(async () => {
    fixtureDir = await createTestDir();
    for (const [name, content] of Object.entries(FIXTURE_FILES)) {
      await createTestFile(fixtureDir, name, content);
    }

    // Real indexing path — never computes embeddings.
    const indexResult = await indexCodebase({ rootDir: fixtureDir });
    if (!indexResult.success) {
      throw new Error(`Fixture indexing failed: ${indexResult.error}`);
    }

    // Read back through the configured backend (sqlite by default).
    vectorDB = await createVectorDB(fixtureDir);
    await vectorDB.initialize();

    const reindexStateManager = createReindexStateManager();
    const toolContext: ToolContext = {
      vectorDB,
      rootDir: fixtureDir,
      log: () => {},
      checkAndReconnect: async () => {},
      getIndexMetadata: () => ({
        indexVersion: vectorDB.getCurrentVersion(),
        indexDate: vectorDB.getVersionDate(),
      }),
      getReindexState: () => reindexStateManager.getState(),
    };

    const serverConfig = createMCPServerConfig('lien', '0.0.0-test');
    server = new Server(
      { name: serverConfig.name, version: serverConfig.version },
      { capabilities: serverConfig.capabilities, instructions: serverConfig.instructions },
    );
    registerMCPHandlers(server, toolContext, () => {});

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'lien-lexical-roundtrip-test-client', version: '0.0.0' }, {});

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, TIMEOUT);

  afterAll(async () => {
    await client?.close();
    await server?.close();
    // SqliteBackend owns a file handle; release it before removing the store.
    (vectorDB as unknown as { close?: () => void }).close?.();
    if (vectorDB) {
      await fs.rm(vectorDB.dbPath, { recursive: true, force: true }).catch(() => {});
    }
    if (fixtureDir) {
      await cleanupTestDir(fixtureDir);
    }
  });

  it(
    'search_code returns real FTS5 results with a populated relevance category',
    async () => {
      const response = await client.callTool({
        name: 'search_code',
        arguments: { query: 'addNumbers', limit: 10 },
      });

      expect(response.isError).not.toBe(true);
      const payload = parseToolResponse(response as CallToolResult);

      expect(Array.isArray(payload.results)).toBe(true);
      expect(payload.results.length).toBeGreaterThan(0);

      // Real chunk content produced by a real FTS5 query over a real index.
      const symbolNames = payload.results.map((r: any) => r.metadata.symbolName).filter(Boolean);
      expect(symbolNames).toContain('addNumbers');

      const match = payload.results.find((r: any) => r.metadata.symbolName === 'addNumbers');
      expect(match.metadata.file).toBe('math-utils.ts');
      expect(match.content).toContain('return a + b');
      // Relevance must be a real category (not the not_relevant that the
      // handler filters out).
      expect(['highly_relevant', 'relevant', 'loosely_related']).toContain(match.relevance);
    },
    TIMEOUT,
  );

  it(
    'get_files_context returns real chunks and test associations',
    async () => {
      const response = await client.callTool({
        name: 'get_files_context',
        arguments: { filepaths: 'math-utils.ts' },
      });

      expect(response.isError).not.toBe(true);
      const payload = parseToolResponse(response as CallToolResult);

      expect(payload.file).toBe('math-utils.ts');
      expect(payload.chunks.length).toBeGreaterThan(0);
      expect(payload.chunks.some((c: any) => c.content.includes('addNumbers'))).toBe(true);
      expect(payload.testAssociations).toContain('math-utils.test.ts');
    },
    TIMEOUT,
  );

  it(
    'list_functions finds the real exported functions by pattern',
    async () => {
      const response = await client.callTool({
        name: 'list_functions',
        arguments: { pattern: '.*Numbers$' },
      });

      expect(response.isError).not.toBe(true);
      const payload = parseToolResponse(response as CallToolResult);

      const symbolNames = payload.results.map((r: any) => r.metadata.symbolName);
      expect(symbolNames).toEqual(expect.arrayContaining(['addNumbers', 'multiplyNumbers']));
    },
    TIMEOUT,
  );
});
