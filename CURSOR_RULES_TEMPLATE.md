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
4. **Before making changes** - Use `get_file_context` to understand dependencies and see test coverage
5. **User asks for examples** - Use `find_similar` to locate patterns
6. **Exploring unfamiliar code** - Use `semantic_search` with broad queries first
7. **Working with tests** - Check metadata in search results for test associations

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

### `list_functions`
**Use for codebase overview and pattern matching.**

```typescript
list_functions({
  pattern: "handle.*",  // optional regex
  language: "typescript"  // optional filter
})
```

**Use for:**
- Getting structural overview
- Finding all functions/classes matching a naming pattern
- Understanding code organization

**Note on Test Associations:**
All Lien tools automatically include test association metadata. When you use `get_file_context` or `semantic_search`, the results include:
- `metadata.isTest`: Whether the file is a test
- `metadata.relatedTests`: Array of associated test files
- `metadata.relatedSources`: Array of source files (if it's a test)
- `metadata.testFramework`: Detected framework (jest, pytest, etc.)
- `metadata.detectionMethod`: How associations were found

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

---

## Decision Tree: Lien vs Other Tools

### Use `semantic_search` when:
✅ User asks about functionality, features, or "how X works"
✅ You need to understand what code exists before editing
✅ Looking for patterns, implementations, handlers, validators, etc.
✅ Exploring unfamiliar parts of codebase

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
- User can re-index with `lien reindex` if results seem stale
- **Test associations**: Lien automatically detects test-source relationships across 12 languages using convention-based patterns and import analysis

---

## Key Principles

1. **Search First, Read Second**: Use Lien before reading files blindly
2. **Semantic Over Syntactic**: Think about what code *does*, not what it's *named*
3. **Context Before Changes**: Always get file context before editing
4. **Test-Aware Development**: Check testAssociations in results to understand test coverage
5. **Trust the Results**: Semantic search finds relevant code even with different naming
6. **Chain Your Tools**: semantic_search → get_file_context (includes testAssociations) → make changes is a powerful pattern

---

## Setup Instructions

Copy this entire file to `.cursor/rules` in your project root:

```bash
# From your project directory
cp /path/to/lien/CURSOR_RULES_TEMPLATE.md .cursor/rules
```

The `alwaysApply: true` frontmatter ensures Cursor uses Lien for all files in your project.

