/**
 * Anthropic tool definitions and dispatch for the agent review plugin.
 *
 * Defines 5 chunk-based tools (no embeddings required):
 * - get_files_context: retrieve all chunks for specific files
 * - get_dependents: find callers/importers of a symbol
 * - list_functions: search symbols by pattern
 * - get_complexity: complexity metrics for files
 * - read_file: read file contents from the cloned repo
 */

import type { AgentToolContext } from './types.js';
import {
  getFilesContext,
  getDependents,
  listFunctions,
  getComplexity,
  readFile,
} from './agent-tools.js';

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic format)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS = [
  {
    name: 'get_files_context',
    description:
      'Get all code chunks for specific files, including symbol metadata, imports, exports, ' +
      'and call sites. Use this to understand the full structure of a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepaths: {
          oneOf: [
            { type: 'string', description: 'Single file path.' },
            { type: 'array', items: { type: 'string' }, description: 'Array of file paths.' },
          ],
          description: 'File path(s) to retrieve context for (max 20 files).',
        },
      },
      required: ['filepaths'],
    },
  },
  {
    name: 'get_dependents',
    description:
      'Find all callers and importers of a file or specific exported symbol. ' +
      'Returns dependent count, risk level, and caller details. ' +
      'Use this to assess the impact of changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'File path to find dependents for.',
        },
        symbol: {
          type: 'string',
          description:
            'Specific exported symbol name to find callers of. If omitted, finds all callers of any export from the file.',
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'list_functions',
    description:
      'Search for symbols (functions, methods, classes, interfaces) by name pattern. ' +
      'Supports regex-like pattern matching. Use this to find specific symbols or explore the codebase structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Name pattern to match (supports regex). Example: "validate", "^handle".',
        },
        symbolType: {
          type: 'string',
          enum: ['function', 'method', 'class', 'interface'],
          description: 'Filter by symbol type.',
        },
        language: {
          type: 'string',
          description: 'Filter by language (e.g., "typescript", "python").',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 30, max 100).',
        },
      },
    },
  },
  {
    name: 'get_complexity',
    description:
      'Get complexity metrics (cyclomatic, cognitive, Halstead) for files. ' +
      'Returns violations sorted by severity. Use this to identify complexity hotspots.',
    input_schema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to analyze. If omitted, analyzes all files.',
        },
        top: {
          type: 'number',
          description: 'Number of top violations to return (default 10).',
        },
      },
    },
  },
  {
    name: 'read_file',
    description:
      'Read file contents from the cloned repo with line numbers. ' +
      'Use this to read files not included in the diff, or to read specific line ranges. ' +
      'Max 500 lines per read; use startLine/endLine to paginate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'Relative file path from repo root.',
        },
        startLine: {
          type: 'number',
          description: 'Start line (1-based, inclusive). Default: 1.',
        },
        endLine: {
          type: 'number',
          description: 'End line (1-based, inclusive). Default: startLine + 499.',
        },
      },
      required: ['filepath'],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  switch (name) {
    case 'get_files_context':
      return getFilesContext(input, ctx);
    case 'get_dependents':
      return getDependents(input, ctx);
    case 'list_functions':
      return listFunctions(input, ctx);
    case 'get_complexity':
      return getComplexity(input, ctx);
    case 'read_file':
      return readFile(input, ctx);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
