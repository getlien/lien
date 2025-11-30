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
- Returns `testAssociations`: which tests cover this file
- Shows file dependencies and relationships
- Accepts single filepath or array of filepaths for batch operations

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

## Test Associations

`get_files_context` returns `testAssociations` showing which tests cover the file.
ALWAYS check this before modifying source code.
After changes, remind the user: "This file is covered by [test files] - run these to verify."

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

Results include rich metadata: `symbolName`, `symbolType`, `complexity`, `parameters`, `signature`.

Use for filtering:
- Complex functions: `results.filter(r => r.metadata.complexity > 5)`
- Methods only: `results.filter(r => r.metadata.symbolType === 'method')`

## When to Use grep Instead

ONLY use grep/ripgrep when:
- User provides an exact string/function name to find
- Looking for specific imports or string literals
- Semantic search returned no results

For everything else: **Lien first.**

---

REMINDER: semantic_search and get_files_context FIRST. grep is the fallback, not the default.