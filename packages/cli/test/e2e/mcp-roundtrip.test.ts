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
 * Real MCP protocol round-trip test.
 *
 * server.test.ts mocks the SDK's `Server`/`StdioServerTransport` classes and
 * only asserts that setup functions were *called*. The handler unit tests
 * (e.g. semantic-search.test.ts, get-files-context.test.ts) mock the vector
 * DB underneath. Neither half ever proves that a real MCP client can
 * connect to a real server and get a real tool response back — this test
 * closes that gap.
 *
 * It stands up:
 * - a real fixture repo on disk (temp dir, cleaned up in afterAll)
 * - a real SQLite index built via the real `indexCodebase()` path (no
 *   embeddings are ever computed)
 * - the real `Server` + the real `registerMCPHandlers` (nothing mocked)
 * - a real `Client` from the MCP SDK, connected over
 *   `InMemoryTransport.createLinkedPair()` (the SDK's in-process transport
 *   pair — faster and more hermetic than spawning a stdio subprocess, and
 *   exercises the exact same request/response wire format)
 *
 * `semantic_search` runs a real FTS5 lexical query — no model, no worker.
 * Run directly with `npm run test:e2e:mcp -w @liendev/lien`.
 */
const TIMEOUT = 60_000;

const FIXTURE_FILES: Record<string, string> = {
  'math-utils.ts': `export function addNumbers(a: number, b: number): number {
  return a + b;
}

export function multiplyNumbers(a: number, b: number): number {
  return a * b;
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
  'greeter.py': `def greet_user(name: str) -> str:
    """Return a friendly greeting for the given user name."""
    return f"Hello, {name}!"
`,
};

/** Parse the JSON text payload out of a real tools/call response. */
function parseToolResponse(result: CallToolResult): any {
  const [first] = result.content as Array<{ type: string; text: string }>;
  expect(first?.type).toBe('text');
  return JSON.parse(first.text);
}

describe('MCP protocol round trip (real server, real client, real index)', () => {
  let fixtureDir: string;
  let vectorDB: VectorDBInterface;
  let client: Client;
  let server: Server;

  beforeAll(async () => {
    fixtureDir = await createTestDir();
    for (const [name, content] of Object.entries(FIXTURE_FILES)) {
      await createTestFile(fixtureDir, name, content);
    }

    // The real indexing path — same function the CLI's `lien index` and the
    // MCP server's auto-indexing call. No embeddings are computed.
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
      // No live file watcher/version-file churn in this test, so reconnect
      // is a real no-op function rather than a mock assertion target.
      log: () => {},
      checkAndReconnect: async () => {},
      getIndexMetadata: () => ({
        indexVersion: vectorDB.getCurrentVersion(),
        indexDate: vectorDB.getVersionDate(),
      }),
      getReindexState: () => reindexStateManager.getState(),
    };

    // Real server config + real handler registration — the exact function
    // startMCPServer calls in production.
    const serverConfig = createMCPServerConfig('lien', '0.0.0-test');
    server = new Server(
      { name: serverConfig.name, version: serverConfig.version },
      { capabilities: serverConfig.capabilities, instructions: serverConfig.instructions },
    );
    registerMCPHandlers(server, toolContext, () => {});

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'lien-roundtrip-test-client', version: '0.0.0' }, {});

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

  it('lists the real registered tools over the wire', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'semantic_search',
        'get_files_context',
        'find_similar',
        'list_functions',
      ]),
    );
  });

  it(
    'semantic_search round-trips through the real handler to real indexed chunks (lexical FTS5)',
    async () => {
      const response = await client.callTool({
        name: 'semantic_search',
        arguments: { query: 'addNumbers', limit: 10 },
      });

      expect(response.isError).not.toBe(true);
      const payload = parseToolResponse(response as CallToolResult);

      expect(Array.isArray(payload.results)).toBe(true);
      expect(payload.results.length).toBeGreaterThan(0);

      // Real chunk content from the real fixture file, produced by a real
      // FTS5 lexical query against a real index — not a mocked stand-in.
      const symbolNames = payload.results.map((r: any) => r.metadata.symbolName).filter(Boolean);
      expect(symbolNames).toContain('addNumbers');

      const mathResult = payload.results.find((r: any) => r.metadata.symbolName === 'addNumbers');
      expect(mathResult.metadata.file).toBe('math-utils.ts');
      expect(mathResult.content).toContain('return a + b');
    },
    TIMEOUT,
  );

  it(
    'get_files_context round-trips through the real handler for a specific fixture file',
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

      // Proves the real test-association scan (a full real chunk scan, not a
      // mocked DB) found the real fixture test file that imports this one.
      expect(payload.testAssociations).toContain('math-utils.test.ts');
    },
    TIMEOUT,
  );

  it('returns a real MCP tool error for an unregistered tool name', async () => {
    const response = await client.callTool({ name: 'not_a_real_tool', arguments: {} });

    expect(response.isError).toBe(true);
    const payload = parseToolResponse(response as CallToolResult);
    expect(payload.message ?? payload.error).toMatch(/unknown tool/i);
  });
});
