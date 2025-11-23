# MCP Tools

Lien exposes four powerful tools via the Model Context Protocol (MCP) that enable AI assistants to understand your codebase.

## semantic_search

Search your codebase using natural language queries.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Natural language search query |
| `limit` | number | No | 5 | Maximum number of results to return |

### Usage

```
Search for "user authentication flow"
```

```
Find code that handles JWT token validation
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

- Use full sentences describing what the code does
- Focus on behavior: "handles user login", "validates email addresses"
- Avoid exact function names (use `grep` for that)
- Increase `limit` for broader exploration (up to 15)

### Examples

**Good queries:**
- "handles user authentication"
- "validates email addresses"
- "processes payment transactions"
- "parses JSON responses"
- "middleware for authorization"

**Poor queries:**
- "auth" (too vague)
- "validateEmail" (use grep for exact names)
- "code" (way too generic)

## find_similar

Find code similar to a given snippet.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `code` | string | Yes | - | Code snippet to find similar implementations |
| `limit` | number | No | 5 | Maximum number of results to return |

### Usage

```
Find similar code to this function:
async function fetchUser(id: string) {
  return await db.users.findById(id);
}
```

### Response

Similar format to `semantic_search`, returns semantically similar code chunks.

### Use Cases

- **Refactoring**: Find all similar implementations to update together
- **Consistency**: Ensure new code matches existing patterns
- **Duplication Detection**: Locate duplicated logic across the codebase

## get_file_context

Get all chunks and related context for a specific file.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filepath` | string | Yes | - | Path to file (relative to project root) |
| `includeRelated` | boolean | No | true | Include related chunks from other files |

### Usage

```
Show context for src/utils/auth.ts
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

- Returns all chunks from the specified file
- Includes test associations (which tests cover this file)
- Optionally includes related chunks from other files
- Useful before editing a file to understand dependencies

## list_functions

List functions, classes, and interfaces by name pattern.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | No | - | Regex pattern to match symbol names |
| `language` | string | No | - | Filter by language (e.g., "typescript", "python") |

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
  "symbols": [
    {
      "name": "UserController",
      "type": "class",
      "file": "src/controllers/UserController.ts",
      "line": 10,
      "language": "typescript"
    }
  ]
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

## Understanding Relevance Categories

All search tools include a **relevance category** alongside the numeric similarity score:

| Category | Score Range | Meaning |
|----------|-------------|---------|
| `highly_relevant` | < 1.0 | Very close semantic match, top-quality result |
| `relevant` | 1.0 - 1.3 | Good match, useful context for the query |
| `loosely_related` | 1.3 - 1.5 | Tangentially related, may provide background context |
| `not_relevant` | ≥ 1.5 | Weak match, likely not useful |

::: tip
Lower scores indicate higher semantic similarity (closer in vector space). Use relevance categories to quickly assess result quality.
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

### Use `semantic_search` when:
- User asks about functionality, features, or "how X works"
- You need to understand what code exists before editing
- Looking for patterns, implementations, handlers, validators

### Use `list_functions` when:
- User asks "show me all Controllers" or similar structural queries
- Looking for classes/functions matching a naming pattern
- Getting architectural overview

### Use `get_file_context` when:
- You identified a file via search and need to understand it
- About to edit a file (check dependencies first)
- Need to understand test coverage

### Use `find_similar` when:
- Refactoring multiple similar pieces of code
- Ensuring new code matches existing patterns
- Finding duplicated logic

## Performance Tips

1. **Start broad**: Use `semantic_search` with higher limit (10-15) for exploration
2. **Be specific**: More specific queries return more relevant results
3. **Use context**: Check related files with `get_file_context` before editing
4. **Chain tools**: search → get context → make changes is a powerful pattern

## Error Handling

### "Index not found"
Run `lien index` in your project directory first.

### "No results found"
- Try broader queries
- Check if the code is indexed (not in exclude patterns)
- Rebuild the index: `lien index --force`

### "Invalid file path"
Use paths relative to project root, not absolute paths.


