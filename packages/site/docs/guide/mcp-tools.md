# MCP Tools

Lien exposes six tools through the Model Context Protocol (MCP), available in Cursor, Claude Code, and other MCP-compatible AI assistants.

## search_code

Full-text keyword search over your codebase (FTS5/BM25). Despite the name, this is
**lexical** search: it does not embed your query. It matches query terms against
symbol names, identifier-split symbol tokens, and chunk content (including
comments/docstrings), ranked by BM25.

::: warning Keyword search, not meaning search
Query with concrete keywords and identifiers that appear in the code, not natural-language
questions. A paraphrase that shares no words with the code will not match (e.g. "auth" will
not surface `login`/`hashPassword`). See [How It Works](/how-it-works#why-lexical-structural-not-semantic)
for why Lien is lexical rather than semantic. For an exact symbol name, prefer `list_functions`.
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
      "score": 0.94,
      "relevance": "highly_relevant",
      "metadata": {
        "file": "src/auth/authenticate.ts",
        "startLine": 23,
        "endLine": 45,
        "symbolName": "authenticateUser",
        "dependentCount": 12
      }
    }
  ]
}
```

### Ranking, and what `dependentCount` means

Results are ordered by BM25, then nudged by structural importance: a file that
more other files import ranks slightly higher among similarly-relevant matches.
The nudge is capped and usually only breaks ties, but a very well-connected hub
file can outrank a marginally better lexical match. Each result's own
`score`/`relevance` always describe its **pure lexical** match quality and are
never recomputed from the nudge, so list order and an individual result's
`relevance` label can legitimately disagree — trust the order for "what to look
at first", `relevance` for "how good is this specific match". Set
`LIEN_STRUCTURAL_RANKING=off` to disable the nudge and fall back to pure BM25.

`dependentCount` is how many other indexed files import this file, resolved with
the same import-matching rules `get_dependents` uses. It is a **floor**, not
`get_dependents`' authoritative count: it is file-level only and does not follow
re-export/barrel chains, so a module fronted by a barrel can read lower than its
real blast radius.

A `0` means "no import edge resolved", which is not the same as "nothing depends
on this file". Some languages' import forms name no specific file at all —
Swift's whole-module `import Foundation` style being the clearest case — so every
file in such a codebase reads `0`.

The counts are precomputed at index time, not per query, and are refreshed by a
full index run (and, in a linked worktree, by an overlay rebuild) rather than by
every incremental single-file update. Two consequences worth knowing: an index
written before this field existed reports `0` for everything until its next full
`lien index`, so if *every* result shows `0` you should suspect a stale index
rather than an unusually disconnected codebase; and a count can lag the working
tree by at most one full index run.

Unlike `get_dependents`, this field carries no `attributionCaveat`, so treat a
`0` here as "unknown", never as a verified clear.

### Best Practices

- Query with keywords and identifiers that appear in the code, not questions
- Include several related terms: they are OR-joined, and BM25 ranks multi-term matches highest
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
- "how does login work?" (a question: use the code's own terms instead)
- "is the user allowed in?" (paraphrase: no shared vocabulary with the code)
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

Similar format to `search_code`. Matching is lexical (BM25 over the snippet's tokens), not semantic: it finds code that shares identifiers and keywords with your snippet.

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
- When a function in the file is at or above 80% of its cyclomatic or cognitive complexity threshold, the response also includes a `complexityHeadroom` array (each entry has `symbol`, `metric`, `value`, `threshold`; capped at 5 per file, with `complexityHeadroomMore` giving the overflow count) plus a `complexityHeadroomWarning` string, a one-line imperative summary of the same data that appears before `complexityHeadroom` in the response. Both fields are omitted when nothing is near budget.

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

### `attributionCaveat`

Five unrelated situations can each make `dependentCount`/`riskLevel` untrustworthy as a verified clear. Rather than five differently-named flags, the response carries a single optional field:

```json
{
  "attributionCaveat": {
    "reason": "unresolved-target",
    "note": "..."
  }
}
```

`reason` is one of:

- **`unresolved-target`** — `filepath` isn't resolvable in the index at all: never indexed, misspelled, or a typo'd directory prefix. `dependentCount: 0` / `riskLevel: "low"` then means "the path is unresolved," not "confirmed zero dependents." (Two independent checks can produce this — the index manifest has no entry for the path at all, or the path resolves in the manifest but has zero chunks in the current scan — but only one `attributionCaveat` is ever returned, never two competing explanations of the same zero.)
- **`symbol-attribution-degraded`** — `symbol` also accepts a method or constructor name (e.g. `__construct`, `moveUp`); those aren't top-level exports, so when call sites for one can't be confirmed, the response widens `dependentCount`/`riskLevel` to the file-level answer (every file that imports `filepath`) rather than asserting an unverifiable symbol-scoped count. The unconfirmed symbol may genuinely be a method/constructor, or it may be a typo'd/hallucinated/removed name — the `note` field says which.
- **`type-symbol-attribution-incomplete`** — `symbol` IS a top-level export of `filepath`, but it names a class/struct/interface/enum declaration rather than a function or method (#1015). Usage attribution is call-site-driven, and nothing "calls" a type by its own name the way a function call does — constructor calls, type hints, `extends`/`implements` clauses, generic type arguments, and dependency-injected property access don't reliably surface as a tracked call site. `totalUsageCount`/`usages` are a partial, best-effort floor — often `0` even when real usages exist — never a verified total; `dependentCount`/`dependents` (which files import the symbol) remain reliable.
- **`dependent-attribution-partial`** — a file-level query (no `symbol`) found zero import-based dependents, but a lower-confidence text-matching fallback (matching a uniquely-declared type name against other files' source text — today only for C#) recovered one or more dependents anyway. Those entries carry `confidence: "inferred"` in `dependents[]`. Treat `dependentCount`/`riskLevel` as a recovered floor, not a verified/complete answer — the fallback can still miss a real dependent reached via an alias, a generic type argument, or reflection.
- **`dependent-attribution-incomplete`** — a file-level query (no `symbol`) found zero dependents in a language where the import graph structurally can't see every real usage — C#'s enclosing-namespace access, where a `global using` lets a real caller reach `filepath`'s exports with no per-file import at all (#930); or Java/Kotlin's same-package visibility and Swift's whole-module access (#1005) — even after the `dependent-attribution-partial` fallback above also found nothing. `dependentCount: 0` / `riskLevel: "low"` here means "the import graph found nothing," not "nothing depends on this file."

At most one reason ever applies to a given response. Always check for `attributionCaveat` before treating a low (especially zero) `dependentCount` as a verified all-clear.

### Risk Levels

| Level | Dependent Count | Meaning |
|-------|-----------------|---------|
| `low` | 0-5 | Safe to change, few dependents |
| `medium` | 6-15 | Review dependents before changing |
| `high` | 16-30 | Careful planning needed |
| `critical` | 30+ | Major impact, extensive testing required |

::: tip Complexity-Aware Risk
Risk level is boosted if dependents have high complexity. A file with 10 dependents but complex dependent code may be rated "high" instead of "medium". A high/critical complexity signal among dependents always lifts the level above "low", even when every dependent is fully tested — test coverage lowers the odds of a *silent* break, it doesn't shrink the blast radius.
:::

## get_complexity

Analyze code complexity for tech debt identification and refactoring prioritization. Tracks four
metrics (cyclomatic, cognitive, Halstead effort, Halstead bugs). See
[Configuration](/guide/configuration#complexity-analysis) for what each one measures and how to
set thresholds.

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
      "complexityRiskLevel": "high"
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
      "complexityRiskLevel": "medium",
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

::: tip `complexityRiskLevel` is not `get_dependents`' `riskLevel`
`complexityRiskLevel` is this file's OWN complexity severity, boosted (never
downgraded) by its dependent count/complexity — there's no test-coverage
term in the formula at all. [`get_dependents`](#get_dependents)'s (and `lien
annotate`'s, and `lien api-delta`'s) `riskLevel` is a different metric —
blast-radius risk, which weighs dependents' test coverage and applies a
complexity floor instead. The two can disagree for the same file at the
same moment by design; don't assume they should match.
:::

### Metric Types

| metricType | Description |
|------------|-------------|
| `cyclomatic` | Test cases needed for full branch coverage |
| `cognitive` | Mental load - how hard to follow (penalizes nesting) |
| `halstead_effort` | Time to understand (shown as human-readable duration) |
| `halstead_bugs` | Estimated bug count (Effort^(2/3) / 3000) |

::: tip Halstead Metrics
Both Halstead metrics have configurable thresholds (`timeToUnderstandMinutes`, `estimatedBugs`). See
[Configuration](/guide/configuration#thresholds) for defaults and how to set them.
:::

### Severity Levels

| Severity | Complexity | Action |
|----------|------------|--------|
| `warning` | 15-29 | Consider refactoring |
| `error` | 30+ | Should refactor |

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
| `relevant` | Good match, useful context for the query |
| `loosely_related` | Weaker match, may provide background context |
| `not_relevant` | Weak match, automatically filtered out of results |

::: tip
Because bands are relative to the best hit in each result set, the top result is
always `highly_relevant`. Categories are keyword-match strength, not semantic
similarity: a match means your query terms appear in the code or its comments.
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
- Discovering code by keyword: identifiers and domain terms that appear in the source
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

Lien works with any MCP-compatible AI assistant. See [Getting Started](/guide/getting-started)
for the per-editor setup table (Cursor, Claude Code, Windsurf, OpenCode, Kilo Code, Antigravity,
and other MCP clients).


