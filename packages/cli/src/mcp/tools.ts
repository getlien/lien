import { toMCPToolSchema } from './utils/zod-to-json-schema.js';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFileContextSchema,
  ListFunctionsSchema,
} from './schemas/index.js';

/**
 * MCP tool definitions with Zod-generated schemas.
 * 
 * All schemas are automatically generated from Zod definitions,
 * providing type safety and rich validation at runtime.
 */
export const tools = [
  toMCPToolSchema(
    SemanticSearchSchema,
    'semantic_search',
    'Search the codebase semantically for relevant code using natural language. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.'
  ),
  toMCPToolSchema(
    FindSimilarSchema,
    'find_similar',
    'Find code similar to a given code snippet. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.'
  ),
  toMCPToolSchema(
    GetFileContextSchema,
    'get_file_context',
    'Get all chunks and related context for a specific file. Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) based on semantic similarity.'
  ),
  toMCPToolSchema(
    ListFunctionsSchema,
    'list_functions',
    'List functions, classes, and interfaces by name pattern and language'
  ),
];

