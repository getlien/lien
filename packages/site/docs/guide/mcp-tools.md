# MCP Tools

Lien exposes six powerful tools via the Model Context Protocol (MCP) that enable AI assistants to understand your codebase.

Lien exposes these tools through the Model Context Protocol (MCP), making them available in Cursor, Claude Code, and other MCP-compatible AI assistants.

## search_code

Full-text keyword search over your codebase (FTS5/BM25). Despite the name, this is
**lexical** search — it does not embed your query. It matches query terms against
symbol names, identifier-split symbol tokens, and chunk content (including
comments/docstrings), ranked by BM25.

::: warning Keyword search, not meaning search
Query with concrete keywords, identifiers, and domain terms that actually appear in
the code — not natural-language questions. A paraphrase that shares no words with
the code will not match (e.g. "auth" will not surface `login`/`hashPassword`). For
an exact symbol name, prefer `list_functions`. The tool keeps the `search_code`
name for backward compatibility.
:::

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Keyword search query (identifiers and domain terms that appear in the code) |
| `limit` | number | No | 5 | Maximum number of results to return |

### Usage

```
Search for "authenticate user session token"
```

```
Find code with terms: jwt token validation verify
```

### Response

```json
{
  "results": [
    {
      "content": "async function authenticateUser(credentials) { ... }",
      "file": "src/auth/authenticate.ts",
      "startLine": 23,
      "endLine": 45,
      "score": 0.94,
      "relevance": "highly_relevant"
    }
  ]
}
```

### Best Practices

- Query with keywords and identifiers that appear in the code, not questions
- Include several related terms — they are OR-joined, and BM25 ranks multi-term matches highest
- Lean on domain vocabulary the code actually uses ("token", "session", "retry", "backoff")
- For an exact symbol name, use `list_functions`; for exact literal strings, use `grep`
- Increase `limit` for broader exploration (up to 15)

### Examples

**Good queries:**
- "authenticate user session token"
- "validate email address regex"
- "payment transaction charge refund"
- "parse json response body"
- "authorization middleware guard"
- "harness evidence gate skip label" (also matches YAML config, e.g. a GitHub Actions workflow step)

**Poor queries:**
- "how does login work?" (a question — use the code's own terms instead)
- "is the user allowed in?" (paraphrase — no shared vocabulary with the code)
- "code" (way too generic)

## find_similar

Find code similar to a given snippet.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `code` | string | Yes | - | Code snippet to find similar implementations (min 24 chars) |
| `limit` | number | No | 5 | Maximum number of results to return |
| `language` | string | No | - | Filter by programming language (e.g., "typescript", "python") |
| `pathHint` | string | No | - | Filter by file path substring (e.g., "src/api", "components") |

### Usage

```
Find similar code to this function:
async function fetchUser(id: string) {
  return await db.users.findById(id);
}
```

```
Find similar TypeScript code in the API directory:
find_similar({
  code: "async function fetchUser(id: string) { ... }",
  language: "typescript",
  pathHint: "src/api"
})
```

### Response

Similar format to `search_code`. Matching is lexical (BM25 over the snippet's tokens), not semantic — it finds code that shares identifiers and keywords with your snippet.

When filters are applied or low-relevance results are pruned, the response includes:

```json
{
  "filtersApplied": {
    "language": "typescript",
    "pathHint": "src/api",
    "prunedLowRelevance": 3
  }
}
```

::: tip Automatic Pruning
Low-relevance results (`not_relevant` category) are automatically removed to reduce noise. The `prunedLowRelevance` count shows how many were removed.
:::

### Use Cases

- **Refactoring**: Find all similar implementations to update together
- **Consistency**: Ensure new code matches existing patterns
- **Duplication Detection**: Locate duplicated logic across the codebase
- **Language-Specific Search**: Focus on implementations in a specific language
- **Directory-Scoped Search**: Find similar code within a specific area of the codebase

## get_files_context

Get all chunks and related context for one or more files.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filepaths` | string \| string[] | Yes | - | Path(s) to file (relative to project root). Single path or array of paths (max 50). |
| `includeRelated` | boolean | No | true | Include related chunks from other files |

### Usage

```
Show context for src/utils/auth.ts
```

```
Get context for multiple files: ["src/auth.ts", "src/user.ts"]
```

```
Get file context for app/Models/User.php without related files
```

### Response

```json
{
  "file": "src/utils/auth.ts",
  "chunks": [
    {
      "content": "export function validateToken(token: string) { ... }",
      "startLine": 1,
      "endLine": 15,
      "score": 0.0
    }
  ],
  "testAssociations": [
    {
      "testFile": "src/utils/auth.test.ts",
      "confidence": "high"
    }
  ],
  "relatedChunks": [
    {
      "content": "import { validateToken } from './auth';",
      "file": "src/middleware/auth.ts",
      "startLine": 1,
      "endLine": 1,
      "score": 0.45,
      "relevance": "highly_relevant"
    }
  ]
}
```

### Features

- Returns all chunks from the specified file(s)
- Includes test associations (which tests cover this file)
- Optionally includes related chunks from other files
- Useful before editing a file to understand dependencies
- Supports batch operations for multiple files (up to 50)

### Response Format

For a single file, returns:
```json
{
  "indexInfo": { ... },
  "file": "src/utils/auth.ts",
  "chunks": [ ... ]
}
```

For multiple files, returns:
```json
{
  "indexInfo": { ... },
  "files": {
    "src/auth.ts": { "chunks": [ ... ] },
    "src/user.ts": { "chunks": [ ... ] }
  }
}
```

## list_functions

List functions, classes, and interfaces by name pattern.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | No | - | Regex pattern to match symbol names |
| `language` | string | No | - | Filter by language (e.g., "typescript", "python") |
| `symbolType` | enum | No | - | Filter by symbol type: `function`, `method`, `class`, or `interface` |
| `limit` | number | No | 50 | Number of results to return (max 200) |
| `offset` | number | No | 0 | Skip first N results for pagination |

### Usage

```
List all functions matching ".*Controller$"
```

```
Show all TypeScript classes
```

### Response

```json
{
  "indexInfo": { "indexVersion": 1234567890, "indexDate": "2025-12-19" },
  "results": [
    {
      "content": "...",
      "score": 0,
      "relevance": "not_relevant",
      "metadata": {
        "symbolName": "UserController",
        "symbolType": "class",
        "file": "src/controllers/UserController.ts",
        "startLine": 10,
        "endLine": 85,
        "language": "typescript"
      }
    }
  ],
  "method": "symbols",
  "hasMore": true,
  "nextOffset": 50
}
```

### Use Cases

- **Architecture Overview**: List all Controllers, Services, Models
- **Pattern Discovery**: Find functions matching naming conventions
- **Quick Navigation**: Locate specific classes or functions by name

### Examples

- Find all Controllers: `pattern: ".*Controller.*"`
- Find all Services: `pattern: ".*Service$"`
- Find all API handlers: `pattern: "handle.*"`
- Find all TypeScript utilities: `pattern: ".*", language: "typescript"`

## get_dependents

Find all files that depend on a given file (reverse dependency lookup). Essential for impact analysis before refactoring.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filepath` | string | Yes | - | Path to file (relative to project root) |
| `depth` | number | No | 1 | Dependency depth (currently only 1 supported) |
| `symbol` | string | No | - | Specific exported symbol to find usages of (returns call sites instead of just importing files) |

### Usage

```
What depends on src/utils/validate.ts?
```

```
Is it safe to change this file?
```

### Response

```json
{
  "indexInfo": { "indexVersion": 1234567890, "indexDate": "2025-12-19" },
  "filepath": "src/utils/validate.ts",
  "dependentCount": 12,
  "productionDependentCount": 9,
  "testDependentCount": 3,
  "riskLevel": "medium",
  "dependents": [
    { "filepath": "src/api/users.ts", "isTestFile": false },
    { "filepath": "src/api/auth.ts", "isTestFile": false },
    { "filepath": "src/__tests__/validate.test.ts", "isTestFile": true }
  ],
  "complexityMetrics": {
    "averageComplexity": 6.2,
    "maxComplexity": 15,
    "filesWithComplexityData": 10,
    "highComplexityDependents": [
      { "filepath": "src/api/users.ts", "maxComplexity": 15, "avgComplexity": 8.3 }
    ],
    "complexityRiskBoost": "medium"
  }
}
```

When `symbol` is provided, the response also includes `totalUsageCount` (number of tracked call sites across all files) and each dependent may include a `usages` array with `callerSymbol`, `line`, and `snippet` fields.

### Risk Levels

| Level | Dependent Count | Meaning |
|-------|-----------------|---------|
| `low` | 0-5 | Safe to change, few dependents |
| `medium` | 6-15 | Review dependents before changing |
| `high` | 16-30 | Careful planning needed |
| `critical` | 30+ | Major impact, extensive testing required |

::: tip Complexity-Aware Risk
Risk level is boosted if dependents have high complexity. A file with 10 dependents but complex dependent code may be rated "high" instead of "medium".
:::

### Use Cases

- **Impact Analysis**: "What breaks if I change this?"
- **Safe Deletion**: "Is this file still used?"
- **Refactoring Planning**: "How many files need updating?"
- **Code Review**: "What's affected by this PR?"

## get_complexity

Analyze code complexity for tech debt identification and refactoring prioritization. Tracks multiple complexity metrics:

- **Test paths**: Number of test cases needed (cyclomatic complexity)
- **Mental load**: How hard to follow (penalizes nesting)
- **Time to understand**: Estimated reading time (Halstead effort)
- **Estimated bugs**: Predicted bug count (Halstead effort-based)

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `files` | string[] | No | - | Specific files to analyze (analyzes all if omitted) |
| `top` | number | No | 10 | Return top N most complex functions |
| `threshold` | number | No | config | Only return functions above this complexity |

### Usage

```
What are the most complex functions in this codebase?
```

```
Show me tech debt hotspots
```

```
Analyze complexity of src/api/
```

### Response

```json
{
  "summary": {
    "filesAnalyzed": 156,
    "avgComplexity": 4.2,
    "maxComplexity": 23,
    "violationCount": 8,
    "bySeverity": { "error": 3, "warning": 5 }
  },
  "violations": [
    {
      "filepath": "src/parser/index.ts",
      "symbolName": "parseComplexExpression",
      "symbolType": "function",
      "startLine": 45,
      "endLine": 120,
      "complexity": 23,
      "threshold": 15,
      "severity": "error",
      "metricType": "cyclomatic",
      "language": "typescript",
      "message": "Cyclomatic complexity 23 exceeds threshold 15",
      "dependentCount": 5,
      "riskLevel": "high"
    },
    {
      "filepath": "src/parser/index.ts",
      "symbolName": "parseComplexExpression",
      "symbolType": "function",
      "startLine": 45,
      "endLine": 120,
      "complexity": 97200,
      "threshold": 64800,
      "severity": "warning",
      "metricType": "halstead_effort",
      "language": "typescript",
      "message": "Time to understand ~1h 30m exceeds threshold 1h",
      "dependentCount": 5,
      "riskLevel": "medium",
      "halsteadDetails": {
        "volume": 850.5,
        "difficulty": 45.2,
        "effort": 97200,
        "bugs": 0.283
      }
    }
  ]
}
```

### Metric Types

| metricType | Description |
|------------|-------------|
| `cyclomatic` | Test cases needed for full branch coverage |
| `cognitive` | Mental load - how hard to follow (penalizes nesting) |
| `halstead_effort` | Time to understand (shown as human-readable duration) |
| `halstead_bugs` | Estimated bug count (Effort^(2/3) / 3000) |

::: tip Halstead Metrics
Both Halstead metrics use intuitive thresholds:
- **Time to understand**: Configure with `timeToUnderstandMinutes` (default: 60 minutes = 1 hour)
- **Estimated bugs**: Configure with `estimatedBugs` (default: 1.5 — functions likely to have >1.5 bugs)
:::

### Severity Levels

| Severity | Complexity | Action |
|----------|------------|--------|
| `warning` | 15-29 | Consider refactoring |
| `error` | 30+ | Should refactor |

### Use Cases

- **Tech Debt Analysis**: "What needs refactoring?"
- **Code Review**: "Are there complexity issues in this PR?"
- **Prioritization**: "Which functions should I simplify first?"
- **Metrics Tracking**: Monitor complexity over time

### Examples

```
Get top 20 most complex functions
```

```
Analyze complexity of src/api/ directory
```

```
Show functions with complexity > 15
```

## Understanding Relevance Categories

All search tools include a **relevance category** alongside a numeric `score`. Both
are derived from the BM25 rank: each result's rank is compared to the best hit in
the result set, producing a category and a lower-is-better `score` (best hit ≈ 0).
An exact match on a symbol name is always promoted to `highly_relevant`.

| Category | Meaning |
|----------|---------|
| `highly_relevant` | Strong BM25 match relative to the best hit (or an exact symbol-name match) |
| `relevant` | Good match — useful context for the query |
| `loosely_related` | Weaker match — may provide background context |
| `not_relevant` | Weak match — automatically filtered out of results |

::: tip
Because bands are relative to the best hit in each result set, the top result is
always `highly_relevant`. Categories are keyword-match strength, not semantic
similarity — a match means your query terms appear in the code or its comments.
:::

## Test Associations

All search results include test association metadata:

```json
{
  "file": "src/auth/login.ts",
  "testAssociations": [
    {
      "testFile": "src/auth/login.test.ts",
      "confidence": "high",
      "method": "convention"
    }
  ]
}
```

### Confidence Levels

- **high**: Import-based detection or strong naming convention
- **medium**: Naming convention match
- **low**: Weak pattern match

### Detection Methods

- **import**: Test imports the source file (most reliable)
- **convention**: File naming patterns (e.g., `file.test.ts` for `file.ts`)
- **pattern**: Weak heuristic match

## Tool Selection Guide

### Use `search_code` when:
- Discovering code by keyword — identifiers and domain terms that appear in the source
- You need to find where a concept lives before editing (query with the code's own vocabulary)
- Looking for patterns, implementations, handlers, validators by their terminology

### Use `list_functions` when:
- User asks "show me all Controllers" or similar structural queries
- Looking for classes/functions matching a naming pattern
- Getting architectural overview

### Use `get_files_context` when:
- You identified a file via search and need to understand it
- About to edit a file (check dependencies first)
- Need to understand test coverage
- Reviewing multiple files together (e.g., PR review)

### Use `find_similar` when:
- Refactoring multiple similar pieces of code
- Ensuring new code matches existing patterns
- Finding duplicated logic

### Use `get_dependents` when:
- Checking impact before modifying a file
- Determining if a file is safe to delete
- Planning refactoring scope
- Understanding how changes will propagate

### Use `get_complexity` when:
- Identifying tech debt hotspots
- Prioritizing refactoring efforts
- Reviewing code quality in a PR
- Tracking codebase health over time

## Performance Tips

1. **Start broad**: Use `search_code` with a higher limit (10-15) for exploration
2. **Use the code's words**: query with identifiers and domain terms that appear in the source, not paraphrases
3. **Use context**: Check related files with `get_files_context` before editing
4. **Chain tools**: search → get context → check dependents → make changes is a powerful pattern

## Error Handling

### "Index not found"
The MCP server will automatically index your project on first use. If you see this error, try running `lien index` manually in your project directory.

### "No results found"
- Try broader queries
- Check if the code is indexed (not in exclude patterns)
- Rebuild the index: `lien index --force`

### "Invalid file path"
Use paths relative to project root, not absolute paths.

## Supported AI Assistants

Lien works with any MCP-compatible AI assistant:

- **Cursor** ✅ (per-project `.cursor/mcp.json`)
- **Claude Code** ✅ (per-project `.mcp.json`)
- **Windsurf** ✅ (global `~/.codeium/windsurf/mcp_config.json`)
- **OpenCode** ✅ (per-project `opencode.json`)
- **Kilo Code** ✅ (per-project `.kilocode/mcp.json`)
- **Antigravity** ✅ (manual config)
- **Other MCP clients** ✅ (see [Getting Started](/guide/getting-started) for setup)


