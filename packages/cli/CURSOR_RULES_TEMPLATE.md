---
description: MANDATORY code search rules - use Lien MCP tools instead of grep
globs: ["**/*"]
alwaysApply: true
---

# MANDATORY: Use Lien MCP for Code Search

You have access to Lien semantic search tools. USE THEM INSTEAD OF grep/ripgrep/built-in search.

## Tool Selection (FOLLOW THIS)

| User wants... | Use this | NOT this |
|---------------|----------|----------|
| "Where is X implemented?" | `semantic_search` | grep |
| "How does X work?" | `semantic_search` | reading random files |
| "Find all Controllers" | `list_functions` | grep |
| Edit a file | `get_files_context` FIRST | direct edit |
| Find similar code | `find_similar` | manual search |
| "What depends on this file?" | `get_dependents` | manual grep |
| "What's complex?" / "Tech debt?" | `get_complexity` | manual analysis |

## Before ANY Code Change

REQUIRED sequence:
1. `semantic_search` → find relevant files
2. `get_files_context` → understand the file + check `testAssociations`
3. Make changes
4. Remind user to run affected tests

## Tool Reference

**`semantic_search({ query: "what the code does", limit: 5 })`**
- Use natural language: "handles authentication", "validates email"
- NOT function names (use grep for exact names)
- Returns relevance category: `highly_relevant`, `relevant`, `loosely_related`, `not_relevant`

**`get_files_context({ filepaths: "path/to/file.ts" })`** or **`get_files_context({ filepaths: ["file1.ts", "file2.ts"] })`**
- MANDATORY before editing any file
- Returns `testAssociations`: which tests import/cover this file (reverse dependency lookup)
- Shows file dependencies and relationships
- Accepts single filepath or array of filepaths for batch operations
- Single file returns: `{ file: string, chunks: [], testAssociations: [] }`
- Multiple files returns: `{ files: { [path]: { chunks: [], testAssociations: [] } } }`

**`list_functions({ pattern: ".*Controller.*" })`**
- Fast symbol lookup by naming pattern
- Use for structural queries: "show all services", "find handlers"
- 10x faster than semantic_search for name-based lookups

**`find_similar({ code: "snippet to match" })`**
- Find similar implementations for consistency
- Use when refactoring or detecting duplication

**`get_dependents({ filepath: "path/to/file.ts", depth: 1 })`**
- Find all files that import/depend on a target file
- Use for impact analysis: "What breaks if I change this?"
- Returns risk level (low/medium/high/critical) based on:
  - Dependency count (how many files import it)
  - Complexity metrics (how complex the dependent code is)
- Highlights top 5 most complex dependents when complexity data available

**`get_complexity({ top: 10 })`**
- Find most complex functions in the codebase
- Analyzes multiple complexity metrics:
  - **Test paths**: Number of test cases needed for full coverage (cyclomatic)
  - **Mental load**: How hard to follow - penalizes nesting (cognitive)
  - **Time to understand**: Estimated reading time (Halstead effort)
  - **Estimated bugs**: Predicted bug count (Halstead volume / 3000)
- Use for tech debt analysis and refactoring prioritization
- Returns `metricType` ('cyclomatic', 'cognitive', 'halstead_effort', or 'halstead_bugs')
- Human-readable output: "23 (needs ~23 tests)", "🧠 45", "~2h 30m", "2.27 bugs"
- Optional: `files` to filter specific files, `threshold` to set minimum complexity

## Test Associations

`get_files_context` returns `testAssociations` showing which tests import/cover the file.
- Uses reverse dependency lookup to find test files that import the source file
- Returns array of test file paths for each requested file
- ALWAYS check this before modifying source code
- After changes, remind the user: "This file is covered by [test files] - run these to verify."

Example:
```typescript
get_files_context({ filepaths: "src/auth.ts" })
// Returns: { file: "src/auth.ts", chunks: [...], testAssociations: ["src/__tests__/auth.test.ts"] }

get_files_context({ filepaths: ["src/auth.ts", "src/user.ts"] })
// Returns: { files: { "src/auth.ts": { chunks: [...], testAssociations: [...] }, ... } }
```

## Workflow Patterns

### Pattern 1: "Where is X?" / "How does X work?"
```
1. semantic_search({ query: "X implementation" })
2. Review results (check relevance scores)
3. get_files_context({ filepaths: "identified/file.ts" })
4. Answer with specific code locations
```

### Pattern 2: Edit or Change Code
```
1. semantic_search({ query: "area being modified" })
2. get_files_context({ filepaths: "target/file.ts" })
3. Check testAssociations in response
4. Make changes
5. Tell user which tests to run
```

### Pattern 3: Impact Analysis Before Refactoring
```
1. get_dependents({ filepath: "target/file.ts" })
2. Review risk level and dependent count
3. Check highComplexityDependents (if any)
4. Use get_files_context on high-risk dependents
5. Plan refactoring strategy based on impact
```

## Query Construction

### Good Queries (DO THIS)
- "handles user authentication"
- "validates email addresses"
- "processes payment transactions"
- "React components with form state"
- "API endpoints for user data"

### Bad Queries (DON'T DO THIS)
- "auth" (too vague)
- "validateEmail" (use grep for exact names)
- "code" (way too generic)

**Formula:** `[action verb] + [domain object] + [optional context]`

## AST Metadata

Results include rich metadata: `symbolName`, `symbolType`, `complexity`, `cognitiveComplexity`, `halsteadVolume`, `halsteadDifficulty`, `halsteadEffort`, `halsteadBugs`, `parameters`, `signature`.

Use for filtering:
- Complex functions (cyclomatic): `results.filter(r => r.metadata.complexity > 10)`
- Complex functions (cognitive): `results.filter(r => r.metadata.cognitiveComplexity > 15)`
- Long to understand (>1 hour): `results.filter(r => r.metadata.halsteadEffort > 64800)`
- Methods only: `results.filter(r => r.metadata.symbolType === 'method')`

## When to Use grep Instead

ONLY use grep/ripgrep when:
- User provides an exact string/function name to find
- Looking for specific imports or string literals
- Semantic search returned no results

For everything else: **Lien first.**

---

REMINDER: semantic_search and get_files_context FIRST. grep is the fallback, not the default.