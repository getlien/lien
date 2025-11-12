# Cursor Rules for Using Lien MCP

Copy this content to `.cursor/rules` in your project to help Cursor use Lien effectively.

---

# Lien MCP Integration Guidelines

This project uses **Lien** - a local semantic code search MCP server that provides deep codebase understanding to AI assistants.

## Available MCP Tools

### 1. `semantic_search`
Search the codebase using natural language queries.

**When to use:**
- Finding implementations of specific features
- Locating patterns or architectural components
- Understanding how something works
- Finding examples of similar code

**Example queries:**
- "Search for authentication logic"
- "Find database connection code"
- "Show me error handling patterns"
- "Locate API endpoint definitions"
- "Find where user sessions are managed"

**Parameters:**
- `query` (required): Natural language search query
- `limit` (optional): Number of results (default: 5)

### 2. `find_similar`
Find code similar to a given snippet.

**When to use:**
- Finding similar implementations for refactoring
- Locating code that follows a pattern
- Understanding consistency across codebase
- Finding duplicated logic

**Example usage:**
- "Find similar code to this function: [paste function]"
- "Show me other implementations like this validation logic"
- "Find similar patterns to this error handling"

**Parameters:**
- `code` (required): Code snippet to find similar implementations
- `limit` (optional): Number of results (default: 5)

### 3. `get_file_context`
Get comprehensive context for a specific file including related code.

**When to use:**
- Understanding a file's purpose and dependencies
- Finding related functionality
- Getting full context before making changes
- Understanding file relationships

**Example usage:**
- "Get context for src/utils/auth.ts"
- "Show me everything related to components/UserProfile.tsx"
- "What's the context around lib/database.js"

**Parameters:**
- `filepath` (required): Path to file (relative to project root)
- `includeRelated` (optional): Include related chunks from other files (default: true)

### 4. `list_functions`
List all indexed functions and classes, optionally filtered.

**When to use:**
- Getting overview of codebase structure
- Finding all functions matching a pattern
- Listing components or utilities
- Understanding code organization

**Example usage:**
- "List all functions"
- "List all functions matching 'handle.*Request'"
- "List all TypeScript functions"
- "Show me all Python classes"

**Parameters:**
- `pattern` (optional): Regex pattern to filter results
- `language` (optional): Filter by language (e.g., "typescript", "python", "php")

## Best Practices for Using Lien

### 1. **Start Broad, Then Narrow**
```
❌ "Show me line 234 in auth.ts"
✅ "Search for authentication logic" → then ask for specifics
```

### 2. **Use Semantic Queries**
```
❌ "Find function named validateUser"  (use grep for exact names)
✅ "Search for user validation logic"  (semantic understanding)
```

### 3. **Leverage Context**
```
✅ "Search for database migrations, then show me the most recent one"
✅ "Find API routes handling user data, focusing on POST requests"
```

### 4. **Combine Tools**
```
✅ "Search for error handling patterns, then find similar implementations"
✅ "List all React components, then get context for the most complex one"
```

### 5. **Be Specific About Intent**
```
❌ "Find code"
✅ "Search for code that handles payment processing"
✅ "Find where we validate email addresses"
```

## Common Workflows

### Understanding New Feature
1. "Search for [feature name] implementation"
2. "Get context for [main file identified]"
3. "Find similar patterns to understand consistency"

### Before Making Changes
1. "Search for [area you're modifying]"
2. "Get context for [target file]"
3. "Find similar implementations to maintain consistency"

### Debugging
1. "Search for error handling in [module]"
2. "Find where [error type] is thrown"
3. "Get context for files that handle [specific error]"

### Code Review
1. "Search for [functionality being reviewed]"
2. "Find similar code to check for consistency"
3. "List functions matching [pattern] to ensure completeness"

### Refactoring
1. "Find similar code to [pattern to refactor]"
2. "Search for all uses of [deprecated pattern]"
3. "List functions that need updating"

## Query Tips

### Good Query Patterns
- **Problem-focused**: "Find code that handles file uploads"
- **Behavior-focused**: "Search for authentication middleware"
- **Pattern-focused**: "Find validation logic for user input"
- **Component-focused**: "Search for React components that use hooks"

### Query Modifiers
- **Location**: "Search for API endpoints in the backend"
- **Type**: "Find TypeScript interfaces for user data"
- **Action**: "Search for functions that parse JSON"
- **Purpose**: "Find code responsible for email notifications"

### Avoid These Query Types
- ❌ Exact variable names (use grep instead)
- ❌ Line numbers (Lien works semantically)
- ❌ File paths only (use `get_file_context` instead)
- ❌ Very generic terms ("code", "function", "class")

## Language-Specific Tips

### TypeScript/JavaScript
- "Search for React hooks in components"
- "Find async functions handling API calls"
- "List all TypeScript interfaces"

### Python
- "Search for Django models"
- "Find async functions using asyncio"
- "List all Python classes in services"

### PHP
- "Search for Laravel controllers"
- "Find database queries using Eloquent"
- "List all PHP classes"

### Go
- "Search for HTTP handlers"
- "Find goroutine implementations"
- "List all Go structs"

## Integration Notes

### Indexing
- Run `lien index` when:
  - Starting work on the project
  - After pulling major changes
  - Adding new files or modules
  - Weekly for active projects
- Concurrent indexing is enabled by default (4 files at once)
- Adjust concurrency in `.lien.config.json` based on your hardware

### Performance
- **Concurrent indexing** (4 files at once by default) for 3-4x faster indexing
- **True batch embedding** (5-10x faster than sequential processing)
- First query may be slower (loading embeddings)
- Subsequent queries are fast (<500ms)
- Results are ranked by semantic relevance
- Configurable via `.lien.config.json` (concurrency and batch sizes)

### Limitations
- Searches code semantically, not by exact text match
- Results limited to indexed code (respects .gitignore)
- Works best with clear, specific queries
- No real-time indexing (re-index after major changes)

## Troubleshooting

### "No relevant results"
- Try broader query terms
- Check if files are indexed: `lien status`
- Re-index: `lien reindex`

### "Results not relevant"
- Be more specific in query
- Use domain-specific terms
- Try different phrasing

### "Outdated results"
- Run `lien reindex` to update index
- Check last indexed time: `lien status`

## Pro Tips

1. **Chain queries**: Use results from one search to inform the next
2. **Use context liberally**: `get_file_context` is fast and comprehensive
3. **Filter by language**: When working in polyglot codebases
4. **Combine with grep**: Use Lien for semantic search, grep for exact matches
5. **Regular re-indexing**: Keep index fresh for accurate results

## Remember

Lien understands **what code does**, not just **what it's named**. Frame queries around:
- Functionality ("handles user login")
- Purpose ("validates input data")
- Behavior ("caches API responses")
- Patterns ("follows repository pattern")

This makes Lien much more powerful than text-based search!

---

**Need help?** Check [Lien documentation](https://github.com/alfhenderson/lien) or run `lien --help`

