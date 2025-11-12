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

---

## Key Principles

1. **Search First, Read Second**: Use Lien before reading files blindly
2. **Semantic Over Syntactic**: Think about what code *does*, not what it's *named*
3. **Context Before Changes**: Always get file context before editing
4. **Trust the Results**: Semantic search finds relevant code even with different naming
5. **Chain Your Tools**: semantic_search → get_file_context → find_similar is a powerful pattern

---

Copy this entire file to `.cursor/rules` in your project root to enable these guidelines.

