import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { indexCodebase, NullEmbeddings, VectorDB, WorkerEmbeddings } from '@liendev/core';
import { createTestDir, cleanupTestDir, createTestFile } from '@liendev/core/test';
import { createMCPServerConfig, registerMCPHandlers } from '../../src/mcp/server-config.js';
import { createReindexStateManager } from '../../src/mcp/reindex-state-manager.js';
import type { ToolContext } from '../../src/mcp/types.js';

/**
 * Real MCP protocol round trip proving structural-only mode end to end:
 *
 * - The real `indexCodebase({ skipEmbeddings: true })` path builds a real
 *   LanceDB index of a tiny fixture repo, without ever touching a real
 *   embedding model.
 * - The 4 structural tools (get_files_context, get_dependents,
 *   list_functions, get_complexity) are exercised over a real MCP
 *   client/server round trip and must return correct data, exactly as they
 *   would with embeddings enabled — they only read structural columns via
 *   scanAll/scanWithFilter, never vectors.
 * - semantic_search and find_similar must report the "disabled" note
 *   instead of crashing or silently returning misleading empty results.
 *
 * Uses `NullEmbeddings` (no real model) so, unlike test/e2e/mcp-roundtrip.test.ts,
 * this doesn't need the local embedding model and can run in the default
 * fast suite.
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

describe('Structural-only mode (embeddings disabled) — real MCP round trip', () => {
  let fixtureDir: string;
  let vectorDB: VectorDB;
  let client: Client;
  let server: Server;
  let workerInitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    workerInitSpy = vi.spyOn(WorkerEmbeddings.prototype, 'initialize');

    fixtureDir = await createTestDir();
    for (const [name, content] of Object.entries(FIXTURE_FILES)) {
      await createTestFile(fixtureDir, name, content);
    }

    // The real indexing path with embeddings explicitly off — same flag
    // `lien index --no-embeddings` and a disabled project config route to.
    const indexResult = await indexCodebase({ rootDir: fixtureDir, skipEmbeddings: true });
    if (!indexResult.success) {
      throw new Error(`Fixture indexing failed: ${indexResult.error}`);
    }

    vectorDB = new VectorDB(fixtureDir);
    await vectorDB.initialize();

    const reindexStateManager = createReindexStateManager();
    const toolContext: ToolContext = {
      vectorDB,
      embeddings: new NullEmbeddings(),
      rootDir: fixtureDir,
      log: () => {},
      checkAndReconnect: async () => {},
      getIndexMetadata: () => ({
        indexVersion: vectorDB.getCurrentVersion(),
        indexDate: vectorDB.getVersionDate(),
      }),
      getReindexState: () => reindexStateManager.getState(),
      embeddingsEnabled: false,
    };

    const serverConfig = createMCPServerConfig('lien', '0.0.0-test');
    server = new Server(
      { name: serverConfig.name, version: serverConfig.version },
      { capabilities: serverConfig.capabilities, instructions: serverConfig.instructions },
    );
    registerMCPHandlers(server, toolContext, () => {});

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'lien-structural-only-test-client', version: '0.0.0' }, {});

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, TIMEOUT);

  afterAll(async () => {
    workerInitSpy.mockRestore();
    await client?.close();
    await server?.close();
    if (vectorDB) {
      await fs.rm(vectorDB.dbPath, { recursive: true, force: true }).catch(() => {});
    }
    if (fixtureDir) {
      await cleanupTestDir(fixtureDir);
    }
  });

  it('indexed the fixture without ever initializing a real embedding worker', () => {
    expect(workerInitSpy).not.toHaveBeenCalled();
  });

  describe('structural tools still work correctly', () => {
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
      'get_dependents finds the real importer of math-utils.ts',
      async () => {
        const response = await client.callTool({
          name: 'get_dependents',
          arguments: { filepath: 'math-utils.ts' },
        });

        expect(response.isError).not.toBe(true);
        const payload = parseToolResponse(response as CallToolResult);

        expect(payload.dependentCount).toBeGreaterThan(0);
        expect(payload.dependents.some((d: any) => d.filepath === 'main.ts')).toBe(true);
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

    it(
      'get_complexity analyzes the real indexed functions without crashing',
      async () => {
        const response = await client.callTool({
          name: 'get_complexity',
          arguments: { files: ['main.ts'] },
        });

        expect(response.isError).not.toBe(true);
        const payload = parseToolResponse(response as CallToolResult);

        expect(payload.summary).toBeDefined();
        expect(payload.summary.filesAnalyzed).toBeGreaterThan(0);
      },
      TIMEOUT,
    );
  });

  describe('semantic tools report disabled instead of crashing or lying', () => {
    it(
      'semantic_search returns a clear disabled note, not an error or misleading empty result',
      async () => {
        const response = await client.callTool({
          name: 'semantic_search',
          arguments: { query: 'function that adds two numbers together' },
        });

        expect(response.isError).not.toBe(true);
        const payload = parseToolResponse(response as CallToolResult);

        expect(payload.results).toEqual([]);
        expect(payload.note).toContain('disabled');
        expect(payload.note).toContain('structural-only mode');
      },
      TIMEOUT,
    );

    it(
      'find_similar returns a clear disabled note, not an error or misleading empty result',
      async () => {
        const response = await client.callTool({
          name: 'find_similar',
          arguments: { code: 'function addNumbers(a, b) { return a + b; }' },
        });

        expect(response.isError).not.toBe(true);
        const payload = parseToolResponse(response as CallToolResult);

        expect(payload.results).toEqual([]);
        expect(payload.note).toContain('disabled');
      },
      TIMEOUT,
    );
  });
});
