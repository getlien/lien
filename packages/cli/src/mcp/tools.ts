import { toMCPToolSchema } from './utils/zod-to-json-schema.js';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
  ListFunctionsSchema,
  GetDependentsSchema,
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

MANDATORY: Call this BEFORE editing any file. Accepts single path or array of paths.

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
  toMCPToolSchema(
    GetDependentsSchema,
    'get_dependents',
    `Find all code that depends on a file (reverse dependency lookup). Use for impact analysis:
- "What breaks if I change this file?"
- "Is this file safe to delete?"
- "What code imports this module?"

Returns list of files that import the target file, plus risk assessment based on:
1. **Dependency count** (how many files depend on it)
2. **Complexity metrics** (how complex the dependent code is)

Risk Levels (hybrid: count + complexity):
- low: Few dependents (≤5) with simple code
- medium: Moderate dependents (6-15) or some complex code
- high: Many dependents (16-30) or highly complex code
- critical: 30+ dependents OR very high complexity (avg>15, max>25)

Complexity Analysis (when available):
- Average/max cyclomatic complexity of dependents
- Highlights top 5 most complex dependents
- Risk boost: High complexity → higher risk level

Example: get_dependents({ filepath: "src/utils/validate.ts", depth: 1 })`
  ),
];