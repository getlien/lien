import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools } from './tools.js';
import { toolHandlers } from './handlers/index.js';
import type { ToolContext, LogFn } from './types.js';
import { LienError, LienErrorCode } from '@liendev/core';

/**
 * Server configuration for MCP server.
 */
export interface MCPServerConfig {
  name: string;
  version: string;
  capabilities: {
    tools: Record<string, unknown>;
    logging?: Record<string, unknown>;
  };
}

/**
 * Create MCP server configuration.
 */
export function createMCPServerConfig(
  name: string,
  version: string
): MCPServerConfig {
  return {
    name,
    version,
    capabilities: {
      tools: {},
      logging: {},
    },
  };
}

/**
 * Register all MCP tool handlers on the server.
 */
export function registerMCPHandlers(
  server: Server,
  toolContext: ToolContext,
  log: LogFn
): void {
  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Handling tool call: ${name}`);

    const handler = toolHandlers[name];
    if (!handler) {
      const error = new LienError(
        `Unknown tool: ${name}`,
        LienErrorCode.INVALID_INPUT,
        { requestedTool: name, availableTools: tools.map(t => t.name) },
        'medium',
        false,
        false
      );
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(error.toJSON(), null, 2) }],
      };
    }

    try {
      return await handler(args, toolContext);
    } catch (error) {
      if (error instanceof LienError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(error.toJSON(), null, 2) }],
        };
      }
      console.error(`Unexpected error handling tool call ${name}:`, error);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: error instanceof Error ? error.message : 'Unknown error',
                code: LienErrorCode.INTERNAL_ERROR,
                tool: name,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });
}

