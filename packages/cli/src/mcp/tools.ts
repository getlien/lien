import { toMCPToolSchema } from './utils/zod-to-json-schema.js';
import {
  SemanticSearchSchema,
  FindSimilarSchema,
  GetFilesContextSchema,
  ListFunctionsSchema,
  GetDependentsSchema,
  GetComplexitySchema,
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
    `Search codebase by MEANING, not text. Complements grep - use this for discovery and understanding, grep for exact matches.

Examples:
- "Where is authentication handled?" → semantic_search({ query: "How does the code handle user authentication?" })
- "How does payment work?" → semantic_search({ query: "How are payment transactions processed and validated?" })

IMPORTANT: Phrase queries as full questions starting with "How", "Where", "What", etc. Full questions produce significantly better relevance than keyword phrases.

Use natural language describing what the code DOES, not function names. For exact string matching, use grep instead.

Returns:
- results[]: { content, score, relevance, metadata: { file, startLine, endLine, language?, symbolName?, symbolType?, signature? } }
- relevance: "highly_relevant" | "relevant" | "loosely_related" | "not_relevant"
- groupedByRepo?: Record<repoId, results[]> (when crossRepo=true)`
  ),
  toMCPToolSchema(
    FindSimilarSchema,
    'find_similar',
    `Find code structurally similar to a given snippet. Use for:
- Ensuring consistency when adding new code
- Finding duplicate implementations
- Refactoring similar patterns together

Provide at least 24 characters of code to match against. Results include a relevance category for each match.

Optional filters:
- language: Filter by programming language (e.g., "typescript", "python")
- pathHint: Filter by file path substring (e.g., "src/api", "components")

Low-relevance results (not_relevant) are automatically pruned.

Returns:
- results[]: { content, score, relevance, metadata: { file, startLine, endLine, language?, symbolName?, symbolType?, signature? } }
- relevance: "highly_relevant" | "relevant" | "loosely_related" | "not_relevant"
- filtersApplied?: { language?, pathHint?, prunedLowRelevance: number }`
  ),
  toMCPToolSchema(
    GetFilesContextSchema,
    'get_files_context',
    `Get context for one or more files including dependencies and test coverage.

MANDATORY: Call this BEFORE editing any file. Accepts single path or array of paths.

Single file:
  get_files_context({ filepaths: "src/auth.ts" })
  
  Returns:
  {
    file: "src/auth.ts",
    chunks: [...],
    testAssociations: ["src/__tests__/auth.test.ts"]
  }

Multiple files (batch):
  get_files_context({ filepaths: ["src/auth.ts", "src/user.ts"] })
  
  Returns:
  {
    files: {
      "src/auth.ts": {
        chunks: [...],
        testAssociations: ["src/__tests__/auth.test.ts"]
      },
      "src/user.ts": {
        chunks: [...],
        testAssociations: ["src/__tests__/user.test.ts"]
      }
    }
  }

Returns for each file:
- All chunks and related code
- testAssociations: Array of test files that import this file (reverse dependency lookup)
- Relevance scoring

ALWAYS check testAssociations before modifying source code.
After changes, remind the user to run the associated tests.

Batch calls are more efficient than multiple single-file calls.`
  ),
  toMCPToolSchema(
    ListFunctionsSchema,
    'list_functions',
    `Fast symbol lookup by naming pattern. Use when searching by NAME, not behavior.

Examples:
- "Show all controllers" → list_functions({ pattern: ".*Controller.*" })
- "Find service classes" → list_functions({ pattern: ".*Service$" })
- "List all class methods" → list_functions({ symbolType: "method" })
- "Find standalone functions" → list_functions({ symbolType: "function" })

Filter by symbol type (function, method, class, interface) to narrow results.

10x faster than semantic_search for structural/architectural queries. Use semantic_search instead when searching by what code DOES.

Results are paginated (default: 50, max: 200). Use \`offset\` to page through large result sets.

Returns:
- results[]: { content, metadata: { file, startLine, endLine, language?, symbolName?, symbolType?, signature? } }
- method: "symbols" | "content" (query method used)
- hasMore: boolean (more results available)
- nextOffset?: number (offset for next page, when hasMore=true)`
  ),
  toMCPToolSchema(
    GetDependentsSchema,
    'get_dependents',
    `Find all code that depends on a file (reverse dependency lookup). Use for impact analysis:
- "What breaks if I change this?"
- "Is this safe to delete?"
- "What imports this module?"

Example: get_dependents({ filepath: "src/utils/validate.ts" })

Returns:
- dependentCount / productionDependentCount / testDependentCount
- riskLevel: "low" | "medium" | "high" | "critical"
- dependents[]: { filepath, isTestFile, usages[]? }
- complexityMetrics: { avgComplexity, maxComplexity, highComplexityDependents[] }
- totalUsageCount?: number (when symbol parameter provided)
- groupedByRepo?: Record<repoId, dependents[]> (when crossRepo=true)`
  ),
  toMCPToolSchema(
    GetComplexitySchema,
    'get_complexity',
    `Get complexity analysis for files or the entire codebase.

Analyzes multiple complexity metrics:
- **Test paths**: Number of test cases needed for full coverage (cyclomatic)
- **Mental load**: How hard to follow - penalizes nesting (cognitive)
- **Time to understand**: Estimated reading time based on Halstead effort
- **Estimated bugs**: Predicted bug count based on Halstead volume

Use for tech debt analysis and refactoring prioritization:
- "What are the most complex functions?"
- "Show me tech debt hotspots"
- "What should I refactor?"

Examples:
  get_complexity({ top: 10 })
  get_complexity({ files: ["src/auth.ts", "src/api/user.ts"] })
  get_complexity({ threshold: 15 })

Returns:
- summary: { filesAnalyzed, avgComplexity, maxComplexity, violationCount, bySeverity: { error, warning } }
- violations[]: { filepath, symbolName, symbolType, complexity, metricType, threshold, severity, riskLevel, dependentCount }
- metricType: "cyclomatic" | "cognitive" | "halstead_effort" | "halstead_bugs"
- severity: "error" | "warning"
- groupedByRepo?: Record<repoId, violations[]> (when crossRepo=true)`
  ),
];