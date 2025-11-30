import { toMCPToolSchema } from './utils/zod-to-json-schema.js';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
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
    `Search codebase by MEANING, not text. USE THIS INSTEAD OF grep/ripgrep for finding implementations, features, or understanding how code works.

Examples:
- "Where is authentication handled?" → semantic_search({ query: "handles user authentication" })
- "How does payment work?" → semantic_search({ query: "processes payment transactions" })

Use natural language describing what the code DOES, not function names. For exact string matching, use grep instead.

Results include a relevance category (highly_relevant, relevant, loosely_related, not_relevant) for each match.`
  ),
  toMCPToolSchema(
    FindSimilarSchema,
    'find_similar',
    `Find code structurally similar to a given snippet. Use for:
- Ensuring consistency when adding new code
- Finding duplicate implementations
- Refactoring similar patterns together

Provide at least 10 characters of code to match against. Results include a relevance category for each match.`
  ),
  toMCPToolSchema(
    GetFilesContextSchema,
    'get_files_context',
    `Get context for one or more files including dependencies and test coverage.

MANDATORY before editing files. Accepts single path or array of paths.

Single file:
  get_files_context({ filepaths: "src/auth.ts" })

Multiple files (batch):
  get_files_context({ filepaths: ["src/auth.ts", "src/user.ts"] })

Returns for each file:
- All chunks and related code
- testAssociations (which tests cover this file)
- Relevance scoring

Batch calls are more efficient than multiple single-file calls.`
  ),
  toMCPToolSchema(
    ListFunctionsSchema,
    'list_functions',
    `Fast symbol lookup by naming pattern. Use when searching by NAME, not behavior.

Examples:
- "Show all controllers" → list_functions({ pattern: ".*Controller.*" })
- "Find service classes" → list_functions({ pattern: ".*Service$" })

10x faster than semantic_search for structural/architectural queries. Use semantic_search instead when searching by what code DOES.`
  ),
];