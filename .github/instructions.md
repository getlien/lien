# GitHub Copilot Code Review Instructions

Use these instructions when reviewing PRs for the Lien project.

---

## Project Context

**Lien** is a local-first semantic code search tool for AI coding assistants via MCP (Model Context Protocol).

**Tech Stack:**
- TypeScript/Node.js
- LanceDB (vector database)
- Transformers.js (local embeddings)
- Vitest (testing)

**Key Principles:**
- KISS (Keep It Simple, Stupid)
- YAGNI (You Aren't Gonna Need It)
- Single Responsibility
- Fail Fast

---

## Review Checklist

### 1. Code Quality & Standards

- [ ] **TypeScript**: Proper type annotations, no `any` unless justified
- [ ] **Naming**: camelCase for variables/functions, PascalCase for classes, UPPER_SNAKE_CASE for constants
- [ ] **Imports**: Ordered (Node built-ins → external deps → internal modules)
- [ ] **Error Handling**: Errors thrown early, contextual error messages
- [ ] **Comments**: Only where necessary (complex logic), no obvious comments
- [ ] **Data Transformations**: Use `collect.js` for complex aggregations (groupBy, countBy, sum chains), native methods for simple operations

### 2. Architecture & Design

- [ ] **Single Responsibility**: Each function/class does ONE thing
- [ ] **DRY**: No duplication without reason (but don't abstract too early)
- [ ] **Modularity**: Code is well-organized and logically grouped
- [ ] **Dependencies**: New dependencies justified and necessary
- [ ] **Interfaces**: Clean, minimal, well-defined

### 3. Functionality & Logic

- [ ] **Correctness**: Logic is sound and achieves stated goals
- [ ] **Edge Cases**: Handles boundary conditions (empty input, large files, null values)
- [ ] **Error Paths**: Failure cases handled gracefully
- [ ] **Performance**: No obvious performance issues or inefficiencies
- [ ] **Resource Management**: Proper cleanup (file handles, connections, intervals)

### 4. Testing Requirements

- [ ] **Unit Tests**: New functions have corresponding unit tests
- [ ] **Integration Tests**: End-to-end workflows tested where applicable
- [ ] **Test Coverage**: Critical paths covered
- [ ] **Tests Pass**: All existing tests still pass
- [ ] **No Flaky Tests**: Tests are deterministic and reliable

### 5. Performance & Efficiency

- [ ] **No Unnecessary Work**: Check for redundant operations
- [ ] **Algorithms**: Efficient data structures and algorithms used
- [ ] **Memory**: Large operations handled in streams/chunks where appropriate
- [ ] **Async/Await**: Proper async handling, no blocking operations
- [ ] **Caching**: Appropriate use of caching for expensive operations

### 6. Documentation

- [ ] **README**: Updated if public API or features changed
- [ ] **JSDoc**: Public APIs have clear documentation
- [ ] **Examples**: Complex features have usage examples
- [ ] **CHANGELOG**: Will be auto-updated by release script (don't manually edit)
- [ ] **Comments**: Complex logic explained, but code is self-documenting where possible

### 7. Security & Safety

- [ ] **Input Validation**: User inputs validated and sanitized
- [ ] **Path Traversal**: File paths properly sanitized
- [ ] **Dependencies**: No new deps without justification
- [ ] **Secrets**: No hardcoded secrets, tokens, or keys
- [ ] **Error Messages**: Don't leak sensitive information

### 8. Consistency

- [ ] **Code Style**: Matches existing codebase patterns
- [ ] **Error Messages**: Consistent format and tone
- [ ] **API Design**: Follows established patterns in the codebase
- [ ] **File Organization**: Located in appropriate directories

### 9. Breaking Changes

- [ ] **BREAKING CHANGE**: Clearly marked in commit message if applicable
- [ ] **Migration Guide**: Documented for breaking changes
- [ ] **Backward Compatibility**: Considered and justified if broken
- [ ] **Deprecation**: Old APIs deprecated before removal when possible

### 10. Edge Cases & Error Handling

- [ ] **Empty/Null Input**: Handled gracefully
- [ ] **Large Files/Data**: Don't crash or hang
- [ ] **Invalid Input**: Clear error messages
- [ ] **Network Failures**: Appropriate retries or error handling
- [ ] **Missing Dependencies**: Graceful degradation or clear errors

---

## Common Review Focus Areas

### Configuration & Patterns

**When reviewing config changes:**
- Are patterns flexible enough for diverse use cases?
- Are there redundant or overly complex patterns?
- Are exclusions comprehensive and consistent?
- Does the config follow the schema in `config/schema.ts`?

### Server & Long-Running Processes

**When reviewing server/daemon code:**
- [ ] Signal handling (SIGINT, SIGTERM) for graceful shutdown
- [ ] Proper cleanup of resources (intervals, watchers, connections)
- [ ] No zombie processes
- [ ] Appropriate logging (use stderr for diagnostics if stdout is reserved)
- [ ] Health checks and error recovery

### File & Data Processing

**When reviewing file operations:**
- [ ] Large files handled efficiently (streaming, chunking)
- [ ] File paths properly sanitized
- [ ] Encodings handled correctly
- [ ] Temporary files cleaned up
- [ ] Respects .gitignore and project-specific ignore files

### Vector Database & Search

**When reviewing search/indexing code:**
- [ ] Embeddings cached appropriately
- [ ] Search performance acceptable
- [ ] Relevance scoring makes sense
- [ ] Chunking strategy is sound
- [ ] Database operations handle errors gracefully

### CLI Commands

**When reviewing CLI changes:**
- [ ] Help text clear and accurate
- [ ] Options named consistently with existing commands
- [ ] Input validation before expensive operations
- [ ] Progress indicators for long-running tasks
- [ ] Exit codes appropriate (0 for success, non-zero for errors)

---

## Red Flags 🚩

**Stop and question these:**

- `any` type without explanation
- Commented-out code (delete it)
- Overly complex functions (>50 lines)
- Missing tests for new features
- Hardcoded paths or values
- Unclear variable names (`x`, `temp`, `data`)
- Nested callbacks (use async/await)
- Copy-pasted code blocks
- Nested `for` loops with manual aggregation (consider `collect.js`)

---

## Questions to Ask

1. **Is this the simplest solution?**
2. **Will this work for edge cases?**
3. **Is this testable?**
4. **Will junior devs understand this?**
5. **Does this match existing patterns?**
6. **Is this consistent across all frameworks?**
7. **Are there any performance concerns?**
8. **What happens when this fails?**

---

## Example Review Comments

### Good Implementation
```
✅ Excellent! Clean implementation that follows the Single Responsibility Principle.
The error handling is clear and the function is well-tested.
```

### Issue Found
```
⚠️ Type Safety: Using `any` on line 42 bypasses TypeScript's type checking.
Consider using a proper type or generic parameter instead.
```

### Performance Concern
```
🔍 Performance: This loops through all items multiple times (O(n²)).
Consider using a Map/Set for O(1) lookups instead of .find() in the loop.
```

### Missing Test
```
❌ Missing test coverage for the edge case where input is empty.
Please add a test to verify the function handles empty arrays correctly.
```

### Consistency Issue
```
💡 Inconsistency: Error messages use different formats across this module.
Consider using the contextualError utility for consistency with the rest of the codebase.
```

### Architecture Suggestion
```
💭 Consider extracting this logic into a separate utility function.
It's being duplicated in multiple places and would benefit from DRY.
```

### Data Transformation
```
💡 This nested loop with manual aggregation could be cleaner using collect.js:
collect(items).groupBy('type').map(group => group.sum('value')).all()
```

---

## Final Checklist Before Approval

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Build succeeds
- [ ] Changes make sense and are well-explained
- [ ] No obvious bugs or edge case issues
- [ ] Documentation updated where needed
- [ ] Breaking changes clearly marked and documented
- [ ] Code follows project principles (KISS, YAGNI, DRY)

---

**When in doubt, prioritize simplicity and consistency!**

