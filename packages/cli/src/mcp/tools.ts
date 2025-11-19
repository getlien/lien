export const tools = [
  {
    name: 'semantic_search',
    description: 'Search the codebase semantically for relevant code using natural language. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.',
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
    description: 'Find code similar to a given code snippet. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.',
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
    description: 'Get all chunks and related context for a specific file. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.',
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
    description: 'List functions, classes, and interfaces by name pattern and language',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to match symbol names (e.g., ".*Service$", "handle.*")',
        },
        language: {
          type: 'string',
          description: 'Language filter (e.g., "typescript", "python", "php")',
        },
      },
    },
  },
];

