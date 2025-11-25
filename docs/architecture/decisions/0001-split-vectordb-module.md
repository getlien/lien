# ADR-001: Split VectorDB Module into Focused Sub-Modules

**Status**: Accepted  
**Date**: 2025-11-24  
**Deciders**: Core Team  
**Related**: v0.14.0 Architecture Improvements

## Context and Problem Statement

The `packages/cli/src/vectordb/lancedb.ts` file had grown to **1,119 lines**, becoming a monolithic module that:

1. **Exceeded Tree-sitter AST parsing limits** - Files over ~1000 lines cause "Invalid argument" errors in our own AST-based semantic chunking
2. **Mixed multiple concerns** - Query operations, batch insertion logic, and maintenance operations were all in one file
3. **Hard to navigate** - Developers had difficulty finding specific functionality
4. **Hard to test in isolation** - Testing individual operations required mocking the entire class
5. **Violated Single Responsibility Principle** - One class doing too many things

This created a paradox: **Our tool for understanding code couldn't understand its own code.**

## Decision Drivers

* **Dogfooding our own tool** - If Lien can't parse its own codebase, it's a sign of poor architecture
* **Maintainability** - Easier to understand and modify smaller, focused modules
* **Testability** - Individual operations should be testable in isolation
* **Extensibility** - Future database operations easier to add to focused modules
* **Code quality metrics** - AST-based complexity analysis should work on all our files

## Considered Options

### Option 1: Keep Monolithic Structure (Status Quo)
**Pros:**
- No refactoring needed
- All logic in one place

**Cons:**
- Exceeds AST parsing limits
- Continues to violate SOLID principles
- Harder to test and maintain
- Bad example for users of Lien

### Option 2: Extract Operations by Concern (Chosen)
**Pros:**
- Each module has single responsibility
- Files under 600 lines (AST parseable)
- Easier to test in isolation
- Clear separation of concerns
- Better code organization

**Cons:**
- Requires refactoring effort
- More files to navigate
- Need to maintain public API

### Option 3: Extract Everything into Individual Functions
**Pros:**
- Maximum granularity
- Very easy to test

**Cons:**
- Too many files (10+ small files)
- Harder to discover related functionality
- Over-engineered for current needs

## Decision Outcome

**Chosen option: "Option 2: Extract Operations by Concern"**

In the context of improving code maintainability and testability,  
facing the problem that our VectorDB module exceeded AST parsing limits,  
we decided for splitting into focused sub-modules (query, batch-insert, maintenance)  
to achieve better separation of concerns and enable our own AST analysis,  
accepting that we need to maintain multiple files instead of one.

### Split Structure

```
vectordb/
├── lancedb.ts           # Main VectorDB class (~267 lines) - Orchestrator
├── query.ts             # Search and query operations (~571 lines)
├── batch-insert.ts      # Batch insertion logic (~161 lines)
├── maintenance.ts       # CRUD operations (~89 lines)
└── version.ts           # Version management (already existed)
```

### Key Principles

1. **Thin Orchestrator Pattern**: `lancedb.ts` delegates to specialized modules
2. **Functional Approach**: Sub-modules export pure functions (no classes)
3. **Explicit Dependencies**: Functions receive `db` and `table` as parameters
4. **Consistent Error Handling**: All modules use `DatabaseError` wrapper

## Consequences

### Positive

* ✅ **AST parsing works** - All files are now under 600 lines and parse successfully
* ✅ **Better testability** - Each module can be tested independently (added 28 new tests)
* ✅ **Clearer organization** - Developers can find functionality faster
* ✅ **Single Responsibility** - Each module has one clear purpose
* ✅ **Easier to extend** - New operations can be added to appropriate module
* ✅ **Better code metrics** - Complexity analysis works on all files
* ✅ **Dogfooding success** - Lien can now analyze its own codebase

### Negative

* ⚠️ **More files to navigate** - 4 files instead of 1 (mitigated by clear naming)
* ⚠️ **Import overhead** - Internal functions need to import from multiple modules (minimal impact)

### Neutral

* 🔄 **No breaking changes** - Public API (`VectorDB` class) remains identical
* 🔄 **Type safety maintained** - All operations properly typed
* 🔄 **Performance unchanged** - No runtime overhead from split

## Implementation Details

### Module Responsibilities

**`query.ts`** - Search and retrieval operations
- `search()` - Vector similarity search with query boosting
- `scanWithFilter()` - Filtered table scans
- `querySymbols()` - Symbol-based queries

**`batch-insert.ts`** - Batch operations
- `insertBatch()` - Insert vectors with retry logic
- `insertBatchInternal()` - Internal batch processing with queue

**`maintenance.ts`** - CRUD operations
- `clear()` - Drop table
- `deleteByFile()` - Remove file's chunks
- `updateFile()` - Update file's chunks (delete + insert)

**`lancedb.ts`** - Public API orchestration
- Initializes database connection
- Delegates operations to sub-modules
- Manages table state
- Provides public interface

### Migration Path

No migration needed - 100% backward compatible. The `VectorDB` class maintains the same public API.

## Validation

### Before Split
```
❌ lancedb.ts: 1,119 lines
❌ Exceeds AST parsing limits
❌ Mixed concerns (query + insert + maintenance)
❌ Test coverage: 76.84%
```

### After Split
```
✅ lancedb.ts: 267 lines (orchestrator)
✅ query.ts: 571 lines (queries)
✅ batch-insert.ts: 161 lines (inserts)
✅ maintenance.ts: 89 lines (maintenance)
✅ All files parse successfully with AST
✅ Test coverage: 80.09% (+3.25%)
✅ 28 new unit tests added
✅ 553 tests passing
```

## Related Decisions

* [ADR-002: Strategy Pattern for AST Traversal](0002-strategy-pattern-ast-traversal.md) - Also addresses AST parsing limits
* [ADR-003: AST-Based Semantic Chunking](0003-ast-based-chunking.md) - The feature that exposed this issue

## References

* [Single Responsibility Principle (SOLID)](https://en.wikipedia.org/wiki/Single-responsibility_principle)
* [Thin Controller Pattern](https://martinfowler.com/eaaCatalog/frontController.html)
* [PR #6: Refactor/v0.14.0 Architecture Improvements](https://github.com/getlien/lien)
* Internal: `.wip/post-refactor-verification-2025-11-24.md`

## Notes

This refactoring was identified through **dogfooding** - running Lien's semantic search on its own codebase revealed that the `lancedb.ts` file couldn't be parsed by our AST chunker. This is a perfect example of how building tools for developers forces you to maintain high code quality standards.

**Lesson**: If your code analysis tool can't analyze your own code, it's time to refactor! 🔄

