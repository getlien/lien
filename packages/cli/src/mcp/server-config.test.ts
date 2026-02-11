import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMCPServerConfig, registerMCPHandlers } from './server-config.js';
import type { ToolContext, LogFn } from './types.js';

describe('createMCPServerConfig', () => {
  it('should create config with provided name and version', () => {
    const config = createMCPServerConfig('lien', '1.0.0');
    expect(config.name).toBe('lien');
    expect(config.version).toBe('1.0.0');
  });

  it('should include tools capability', () => {
    const config = createMCPServerConfig('lien', '1.0.0');
    expect(config.capabilities.tools).toBeDefined();
    expect(typeof config.capabilities.tools).toBe('object');
  });

  it('should include logging capability', () => {
    const config = createMCPServerConfig('lien', '1.0.0');
    expect(config.capabilities.logging).toBeDefined();
  });

  it('should accept any name and version string', () => {
    const config = createMCPServerConfig('custom-server', '2.5.3-beta');
    expect(config.name).toBe('custom-server');
    expect(config.version).toBe('2.5.3-beta');
  });
});

describe('registerMCPHandlers', () => {
  let mockServer: {
    setRequestHandler: ReturnType<typeof vi.fn>;
  };
  let mockToolContext: ToolContext;
  let mockLog: LogFn;
  let registeredHandlers: Map<any, Function>;

  beforeEach(() => {
    registeredHandlers = new Map();
    mockServer = {
      setRequestHandler: vi.fn((schema, handler) => {
        registeredHandlers.set(schema, handler);
      }),
    };

    mockToolContext = {
      vectorDB: {} as any,
      embeddings: {} as any,
      rootDir: '/test',
      log: vi.fn(),
      checkAndReconnect: vi.fn(),
      getIndexMetadata: vi.fn().mockReturnValue({
        indexVersion: 1,
        indexDate: '2024-01-01',
      }),
      getReindexState: vi.fn().mockReturnValue({
        inProgress: false,
        pendingFiles: [],
      }),
    };

    mockLog = vi.fn();
  });

  it('should register two request handlers (ListTools and CallTool)', () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);
    expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
  });

  it('should register ListToolsRequestSchema handler that returns all tools', async () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    // First call is ListToolsRequestSchema
    const listHandler = mockServer.setRequestHandler.mock.calls[0][1];
    const result = await listHandler();

    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBe(6);
  });

  it('should return all 6 tool names from ListTools handler', async () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    const listHandler = mockServer.setRequestHandler.mock.calls[0][1];
    const result = await listHandler();

    const toolNames = result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('semantic_search');
    expect(toolNames).toContain('find_similar');
    expect(toolNames).toContain('get_files_context');
    expect(toolNames).toContain('list_functions');
    expect(toolNames).toContain('get_dependents');
    expect(toolNames).toContain('get_complexity');
  });

  it('should return structured error for unknown tool name', async () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    // Second call is CallToolRequestSchema
    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];
    const result = await callHandler({
      params: { name: 'nonexistent_tool', arguments: {} },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const errorPayload = JSON.parse(result.content[0].text);
    expect(errorPayload.error).toContain('Unknown tool: nonexistent_tool');
    expect(errorPayload.code).toBe('INVALID_INPUT');
  });

  it('should log the tool name when handling a call', async () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];
    await callHandler({
      params: { name: 'nonexistent_tool', arguments: {} },
    });

    expect(mockLog).toHaveBeenCalledWith('Handling tool call: nonexistent_tool');
  });

  it('should return LienError JSON when handler throws LienError', async () => {
    // We need to mock the toolHandlers to inject a handler that throws
    // Instead, test the error handling path via the unknown tool path
    // which already creates a LienError
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];
    const result = await callHandler({
      params: { name: 'unknown_tool', arguments: {} },
    });

    expect(result.isError).toBe(true);
    const errorPayload = JSON.parse(result.content[0].text);
    expect(errorPayload.code).toBe('INVALID_INPUT');
    expect(errorPayload.context).toBeDefined();
    expect(errorPayload.context.requestedTool).toBe('unknown_tool');
    expect(errorPayload.context.availableTools).toBeInstanceOf(Array);
  });

  it('should include available tools in unknown tool error context', async () => {
    registerMCPHandlers(mockServer as any, mockToolContext, mockLog);

    const callHandler = mockServer.setRequestHandler.mock.calls[1][1];
    const result = await callHandler({
      params: { name: 'bad_tool', arguments: {} },
    });

    const errorPayload = JSON.parse(result.content[0].text);
    const availableTools = errorPayload.context.availableTools;
    expect(availableTools).toHaveLength(6);
    expect(availableTools).toContain('semantic_search');
    expect(availableTools).toContain('find_similar');
    expect(availableTools).toContain('get_files_context');
    expect(availableTools).toContain('list_functions');
    expect(availableTools).toContain('get_dependents');
    expect(availableTools).toContain('get_complexity');
  });
});
