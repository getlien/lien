---
alwaysApply: true
---

# Lien MCP Integration Rules

This project uses **Lien** - a local semantic code search MCP server. You MUST use Lien tools proactively to understand the codebase before making changes.

## Core Rules

### ALWAYS Use Lien When:
1. **Before reading any file** - Use `semantic_search` or `get_file_context` to understand what you're looking for
2. **User asks about code location** - Use `semantic_search` before grepping
3. **User asks "how does X work"** - Use `semantic_search` to find implementations
4. **Before making changes** - Use `get_file_context` to understand dependencies
5. **User asks for examples** - Use `find_similar` to locate patterns
6. **Exploring unfamiliar code** - Use `semantic_search` with broad queries first

### NEVER:
1. Skip Lien and go straight to reading files when you don't know the codebase
2. Use grep when the user is asking about functionality (use semantic search instead)
3. Make assumptions about code location without searching first
4. Edit files without getting context via `get_file_context`

---

## MCP Tools Reference

### `semantic_search` - PRIMARY TOOL
**Use this FIRST for almost all code understanding tasks.**

```typescript
semantic_search({
  query: "natural language description of what you're looking for",
  limit: 5  // increase to 10-15 for broad exploration
})
```

**Use for:**
- "Where is X implemented?" → `semantic_search({ query: "X implementation" })`
- "How does Y work?" → `semantic_search({ query: "Y functionality" })`
- Finding patterns, features, utilities, handlers, validators, etc.
- Understanding architecture before making changes

**Query tips:**
- Use full sentences describing what the code does
- Focus on behavior: "handles user authentication", "validates email input"
- Not exact names: search semantically, not syntactically

### `get_file_context`
**Use BEFORE editing any file you haven't read yet.**

```typescript
get_file_context({
  filepath: "relative/path/to/file.ts",
  includeRelated: true  // default, gets related chunks
})
```

**MANDATORY for:**
- Before making any file edits
- Understanding file dependencies and relationships
- Getting full context of what a file does

**Pro tip:** Use after `semantic_search` identifies the right file

### `find_similar`
**Use for finding patterns and ensuring consistency.**

```typescript
find_similar({
  code: "function example() { ... }",
  limit: 5
})
```

**Use for:**
- Refactoring: find all similar implementations
- Consistency: ensure new code matches existing patterns
- Duplication detection

### `list_functions` ⚡
**Fast symbol-based search for functions, classes, and interfaces by name.**

```typescript
list_functions({
  pattern: ".*Controller.*",  // regex to match symbol names
  language: "php"  // optional language filter
})
```

**How it works:**
- Extracts and indexes function/class/interface names during indexing
- Direct symbol name matching (not semantic search)
- **10x faster** than semantic search for finding specific symbols
- Automatic fallback for old indices

**Use for:**
- Finding all classes matching a pattern (e.g., `.*Controller.*`, `.*Service$`)
- Getting structural overview of functions/classes
- Discovering API endpoints, handlers, or utilities by name pattern
- Understanding code organization and naming conventions

**Best practices:**
- Use regex patterns that match naming conventions: `.*Controller.*`, `handle.*`, `get.*`
- Combine with language filter for large codebases: `language: "typescript"`

**When to use `list_functions` vs `semantic_search`:**
- ✅ Use `list_functions` when you know the naming pattern (e.g., "all Controllers")
- ✅ Use `semantic_search` when searching by functionality (e.g., "handles authentication")

**Note:** Test files are indexed alongside source code and will naturally appear in semantic search results when relevant.

---

## Enhanced Metadata (AST-Based) ⚡ NEW in v0.13.0

Lien now uses **Abstract Syntax Tree (AST) parsing** for TypeScript/JavaScript files to provide rich code metadata:

### Metadata Fields in Search Results

All search results (`semantic_search`, `get_file_context`, `find_similar`, `list_functions`) now include enhanced metadata when available:

```typescript
{
  content: "function validateEmail(email: string): boolean { ... }",
  metadata: {
    file: "src/validators.ts",
    startLine: 45,
    endLine: 60,
    type: "function",  // 'function' | 'class' | 'block'
    language: "typescript",
    
    // AST-derived metadata (NEW in v0.13.0):
    symbolName: "validateEmail",              // Function/class name
    symbolType: "function",                   // 'function' | 'method' | 'class' | 'interface'
    parentClass: undefined,                   // For methods: parent class name
    complexity: 3,                            // Cyclomatic complexity
    parameters: ["email: string"],            // Function parameters
    signature: "function validateEmail(email: string): boolean",  // Full signature
    imports: ["@/utils/regex"]               // File imports (for context)
  },
  score: 0.85,
  relevance: "highly_relevant"
}
```

### AST Metadata Benefits

1. **Never splits functions** - Chunks respect semantic boundaries (no mid-function splits)
2. **Function context** - Know exactly which function you're looking at
3. **Complexity metrics** - Identify complex functions that may need refactoring
4. **Signature awareness** - See parameters and return types at a glance
5. **Better AI context** - AI assistants get structured code information

### Using AST Metadata

**Find complex functions:**
```typescript
// Search for authentication logic
const results = await semantic_search({ query: "authentication logic" });

// Filter by complexity
const complexFunctions = results.filter(r => (r.metadata.complexity || 0) > 5);
```

**Identify methods in a class:**
```typescript
// Get file context
const context = await get_file_context({ filepath: "src/auth/AuthService.ts" });

// Find all methods
const methods = context.results.filter(r => r.metadata.symbolType === 'method');
```

**List functions with specific parameters:**
```typescript
const functions = await list_functions({ pattern: ".*validate.*", language: "typescript" });

// Filter by parameter count
const simpleValidators = functions.filter(r => (r.metadata.parameters?.length || 0) <= 2);
```

### AST Support

**Currently supported:**
- ✅ TypeScript (`.ts`, `.tsx`)
- ✅ JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)
- ✅ Shopify Liquid (`.liquid`) - **Special regex-based chunking**

**Coming soon:**
- 🔜 Python, Go, Rust, Java, PHP, and more

**Fallback behavior:**
- For unsupported languages, Lien automatically falls back to line-based chunking
- No disruption to existing workflows

### Shopify Liquid Support ⚡ NEW

Lien provides specialized chunking for Shopify themes with **complete dependency tracking**:

**Liquid template handling:**
- `{% schema %}` blocks - Kept as single chunks, section names extracted
- `{% style %}` blocks - Preserved together for scoped CSS
- `{% javascript %}` blocks - Kept intact
- Oversized blocks (>225 lines) - Intelligently split to prevent token limits

**JSON template handling (Shopify 2.0+):**
- `templates/**/*.json` - Template definition files
- Section references extracted from JSON structure
- Template names extracted from filepath

**Complete dependency tracking (tracked in `metadata.imports`):**
- `{% render 'snippet-name' %}` - Snippet dependencies
- `{% include 'snippet-name' %}` - Legacy includes
- `{% section 'section-name' %}` - Section usage in layouts
- JSON template sections - Section type references

**Example metadata:**
```typescript
// JSON Template
{
  content: "{\"sections\": {\"main\": {\"type\": \"main-product\"}}}",
  metadata: {
    file: "templates/product.json",
    type: "template",
    language: "json",
    symbolName: "product",              // Template name
    symbolType: "template",
    imports: ["main-product"]           // Sections used by this template
  }
}

// Liquid Section Schema
{
  content: "{% schema %}\n{\"name\": \"Hero Section\", ...}\n{% endschema %}",
  metadata: {
    file: "sections/hero.liquid",
    type: "block",
    language: "liquid",
    symbolName: "Hero Section",        // Extracted from schema JSON
    symbolType: "schema",
    imports: undefined                  // No render/include/section tags found in this block
  }
}

// Liquid Template Content
{
  content: "<div>{% render 'logo' %}{% render 'nav' %}</div>",
  metadata: {
    file: "sections/header.liquid",
    type: "template",
    language: "liquid",
    imports: ["logo", "nav"]            // Tracked dependencies
  }
}
```

**Benefits:**
- **Complete dependency graph** - JSON templates → sections → snippets
- **Schema preservation** - Never splits section configuration across chunks
- **Better context** - AI knows full theme structure and all dependencies

### Known Limitations

**Very large files (1000+ lines):**
- Tree-sitter may fail with "Invalid argument" error on extremely large files
- When this occurs, Lien automatically falls back to line-based chunking
- This is a known Tree-sitter limitation with very large syntax trees
- Fallback behavior is configurable via `astFallback` setting

**Resilient parsing:**
- Tree-sitter is designed to produce best-effort ASTs even for invalid syntax
- Parse errors are rare; most malformed code still produces usable chunks
- The `astFallback: 'error'` option mainly catches edge cases like large file errors

### Configuration

Control AST behavior in `.lien.config.json`:

```json
{
  "chunking": {
    "useAST": true,              // Enable AST-based chunking (default: true)
    "astFallback": "line-based"  // Fallback strategy: 'line-based' | 'error'
  }
}
```

---

## Input Validation & Error Handling

Lien uses Zod schemas for runtime type-safe validation of all tool inputs. This provides:
- **Automatic validation** of all parameters before tool execution
- **Rich error messages** with field-level feedback
- **Type safety** with full TypeScript inference
- **Consistent error structure** across all tools

### Understanding Validation Errors

When you provide invalid parameters, you'll receive a structured error response:

```json
{
  "error": "Invalid parameters",
  "code": "INVALID_INPUT",
  "details": [
    {
      "field": "query",
      "message": "Query must be at least 3 characters"
    },
    {
      "field": "limit",
      "message": "Limit cannot exceed 50"
    }
  ]
}
```

### Common Validation Rules

**semantic_search:**
- `query`: 3-500 characters (required)
- `limit`: 1-50 (default: 5)

**find_similar:**
- `code`: minimum 10 characters (required)
- `limit`: 1-20 (default: 5)

**get_file_context:**
- `filepath`: cannot be empty (required)
- `includeRelated`: boolean (default: true)

**list_functions:**
- `pattern`: optional regex string
- `language`: optional language filter

### Error Codes

Lien uses structured error codes for programmatic error handling:

- `INVALID_INPUT` - Parameter validation failed
- `FILE_NOT_FOUND` - Requested file doesn't exist in index
- `INDEX_NOT_FOUND` - No index found (run `lien index`)
- `INDEX_CORRUPTED` - Index is corrupted (run `lien index` to rebuild)
- `EMBEDDING_GENERATION_FAILED` - Embedding model failed (retryable)
- `INTERNAL_ERROR` - Unexpected internal error

### Best Practices

1. **Always provide required fields**: Check tool schemas for required parameters
2. **Respect validation limits**: Don't exceed max values for `limit` parameters
3. **Use descriptive queries**: Avoid very short or vague queries
4. **Handle validation errors gracefully**: Parse error details to understand what went wrong

---

## Workflow Patterns (FOLLOW THESE)

### Pattern 1: User Asks "Where is X?"
```
1. semantic_search({ query: "X functionality" })
2. Review results, identify file(s)
3. get_file_context({ filepath: "identified/file.ts" })
4. Answer with specific information
```

### Pattern 2: User Asks to Edit/Change Code
```
1. semantic_search({ query: "area being modified" })
2. get_file_context({ filepath: "target/file.ts" })
3. find_similar({ code: "existing pattern" }) // if ensuring consistency
4. Make changes with full context
```

### Pattern 3: User Asks "How Does X Work?"
```
1. semantic_search({ query: "X implementation", limit: 10 })
2. Review top results
3. get_file_context for key files
4. Explain with references to actual code locations
```

### Pattern 4: Debugging or Understanding Error
```
1. semantic_search({ query: "error handling for [area]" })
2. semantic_search({ query: "[specific error type] handling" })
3. get_file_context for relevant files
4. Provide analysis
```

### Pattern 5: Modifying Source Code (Test-Aware)
```
1. semantic_search({ query: "functionality being modified" })
2. get_file_context({ filepath: "target/file.ts" })
3. Check testAssociations in response to see which tests cover this code
4. Make changes
5. Remind user to run the associated tests
```

### Pattern 6: Understanding Test Coverage
```
1. get_file_context({ filepath: "src/component.ts" })
2. Review testAssociations field in response
3. Use get_file_context for each test file to understand coverage
4. Analyze and suggest improvements
```

### Pattern 7: Finding All Classes/Functions by Name Pattern ⚡
```
1. list_functions({ pattern: ".*Controller.*", language: "php" })
2. Review the list of matching classes
3. Use get_file_context on specific files for deeper investigation
4. Answer user's structural/architectural questions
```

**Example queries:**
- "Show me all Controllers" → `list_functions({ pattern: ".*Controller.*" })`
- "What Services exist?" → `list_functions({ pattern: ".*Service.*" })`
- "Find all API handlers" → `list_functions({ pattern: "handle.*" })`

### Pattern 8: Working with Shopify Themes (Liquid + JSON) ⚡
```
1. semantic_search({ query: "product template configuration" })
   → Finds JSON template with section references
2. Check metadata.imports to see which sections are used
3. semantic_search({ query: "main-product section schema" })
   → Find section definition
4. Review section's metadata.imports to see which snippets it renders
   → Complete dependency chain visible!
```

**Example queries:**
- "Find the product template sections" → Returns `templates/product.json` with section imports
- "Which sections are on the collection page?" → Check JSON template imports
- "What sections use the product-card snippet?" → Reverse lookup via imports
- "Show the hero section schema" → Returns complete `{% schema %}` block with name
- "What snippets does the footer render?" → See `metadata.imports: ["logo", "nav", ...]`

**Complete dependency graph:**
```
templates/product.json
  → imports: ["main-product", "recommendations"]
    → sections/main-product.liquid
      → imports: ["product-card", "price-tag"]
        → snippets/product-card.liquid
        → snippets/price-tag.liquid
```

**Dependency tracking:**
- **JSON templates** - `metadata.imports` contains section type references
- **Liquid templates** - `metadata.imports` contains `{% render %}`, `{% include %}`, `{% section %}` references
- Full theme architecture visible through imports metadata

---

## Decision Tree: Lien vs Other Tools

### Use `semantic_search` when:
✅ User asks about functionality, features, or "how X works"
✅ You need to understand what code exists before editing
✅ Looking for patterns, implementations, handlers, validators, etc.
✅ Exploring unfamiliar parts of codebase
✅ Searching by what code **does** (behavior, functionality)

### Use `list_functions` when: ⚡
✅ User asks "show me all Controllers" or similar structural queries
✅ Looking for classes/functions matching a **naming pattern**
✅ Getting architectural overview (all Services, all Handlers, etc.)
✅ Searching by what code is **named** (symbol names, not behavior)
✅ Need fast results for known naming conventions

### Use `grep` when:
✅ User provides exact function/variable name to find
✅ Looking for specific string literals or imports
✅ Finding all occurrences of exact text

### Use `get_file_context` when:
✅ You identified a file via search and need to understand it
✅ About to edit a file (MANDATORY)
✅ Need to understand file relationships and dependencies

### Use `find_similar` when:
✅ Refactoring multiple similar pieces of code
✅ Ensuring new code matches existing patterns
✅ Finding duplicated logic

### Check test associations when:
✅ Before modifying any source file (use `get_file_context` to see testAssociations)
✅ User asks "what tests cover this?" (use `semantic_search` and check metadata)
✅ Understanding what a test file is testing (use `get_file_context` on the test file)
✅ Working on bug fixes (search results include test metadata)

---

## Query Construction Guide

### Good Semantic Queries (DO THIS):
- "handles user authentication"
- "validates email addresses" 
- "processes payment transactions"
- "parses JSON responses"
- "middleware for authorization"
- "React components with form state"
- "database migration scripts"
- "API endpoints for user data"
- "Shopify section schema for hero banner" (Liquid)
- "files that render product-card snippet" (Liquid)
- "layout file with header and footer sections" (Liquid)

### Bad Queries (DON'T DO THIS):
- "auth" (too vague)
- "validateEmail" (use grep for exact names)
- "line 234" (Lien doesn't work with line numbers)
- "code" (way too generic)

### Query Formula:
`[action verb] + [domain object] + [optional context]`
- "handles authentication for API requests"
- "validates user input in forms"
- "caches API responses from external services"

---

## Performance Notes

- First query loads embeddings (~1-2s), subsequent queries are fast (<500ms)
- Increase `limit` to 10-15 for broad exploration
- Results are ranked by semantic relevance (trust the ranking)
- User can re-index with `lien index` if results seem stale
- **Relevance categories**: All search results include a `relevance` field (`highly_relevant`, `relevant`, `loosely_related`, `not_relevant`) to help interpret search quality at a glance
- **Test associations**: Lien automatically detects test-source relationships across 12 languages using convention-based patterns and import analysis
- **Shopify Liquid themes**: Semantic chunking reduces chunk count by ~60% (schema/style/javascript blocks preserved), improving search quality and performance

---

## Key Principles

1. **Search First, Read Second**: Use Lien before reading files blindly
2. **Semantic Over Syntactic**: Think about what code *does*, not what it's *named*
3. **Context Before Changes**: Always get file context before editing
4. **Test-Aware Development**: Check testAssociations in results to understand test coverage
5. **Trust the Results**: Semantic search finds relevant code even with different naming. Use the `relevance` field (`highly_relevant`, `relevant`, `loosely_related`, `not_relevant`) to quickly assess result quality
6. **Chain Your Tools**: semantic_search → get_file_context (includes testAssociations) → make changes is a powerful pattern

---

## Setup Instructions

Create a `lien.mdc` file in your `.cursor/rules/` directory:

```bash
# From your project directory
mkdir -p .cursor/rules
cp node_modules/@liendev/lien/CURSOR_RULES_TEMPLATE.md .cursor/rules/lien.mdc
```

The `alwaysApply: true` frontmatter ensures Cursor uses Lien for all files in your project.

This approach allows you to have multiple rule files in `.cursor/rules/` without conflicts.

**Note:** The template is automatically copied during `lien init` to `.cursor/rules/lien.mdc`.

