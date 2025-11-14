export const tools = [
  {
    name: 'semantic_search',
    description: 'Search the codebase semantically for relevant code using natural language',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "authentication logic", "database connection handling")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar',
    description: 'Find code similar to a given code snippet',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code snippet to find similar implementations',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 5,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_file_context',
    description: 'Get all chunks and related context for a specific file',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file (relative to project root)',
        },
        includeRelated: {
          type: 'boolean',
          description: 'Include semantically related chunks from other files',
          default: true,
        },
      },
      required: ['filepath'],
    },
  },
  {
    name: 'list_functions',
    description: 'List indexed code chunks filtered by language and/or regex pattern (Beta: searches content, not extracted symbols)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Optional regex pattern to filter content (e.g., ".*Service$", "class.*Controller")',
        },
        language: {
          type: 'string',
          description: 'Optional language filter (e.g., "typescript", "python", "php")',
        },
      },
    },
  },
];

