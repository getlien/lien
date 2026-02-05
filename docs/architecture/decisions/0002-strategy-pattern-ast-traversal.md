# ADR-002: Use Strategy Pattern for Language-Specific AST Traversal

**Status**: Accepted  
**Date**: 2025-11-25  
**Deciders**: Core Team  
**Related**: Multi-Language AST Support Roadmap

## Context and Problem Statement

Lien's AST-based semantic chunking (introduced in v0.13.0) works well for TypeScript and JavaScript, but the implementation had **language-specific logic hardcoded** throughout the `chunker.ts` file:

```typescript
// Hardcoded TypeScript/JavaScript node types
const targetTypes = [
  'function_declaration',      // TS/JS specific
  'method_definition',         // TS/JS specific
  'lexical_declaration',       // TS/JS specific
];

// Hardcoded TypeScript/JavaScript traversal logic
if (node.type === 'class_declaration') { /* TS/JS logic */ }
if (node.type === 'lexical_declaration') { /* TS/JS logic */ }
```

This creates problems when adding support for new languages (Python, Go, Rust, etc.):

1. **Monolithic complexity** - Adding Python would require modifying a 407-line file with nested if/else branches
2. **Risk of breaking existing languages** - Changes for Python could break TypeScript/JavaScript
3. **Tight coupling** - Core chunking logic mixed with language-specific details
4. **Hard to test** - Can't test language-specific logic in isolation
5. **Scaling issues** - Each new language makes the file more complex

**Goal**: Support 10+ languages with AST-based semantic chunking without exponential complexity growth.

## Decision Drivers

* **Multi-language roadmap** - Users requesting Python, Go, Rust, PHP support
* **Maintainability** - New languages shouldn't risk breaking existing ones
* **Testability** - Language-specific logic should be testable in isolation
* **Extensibility** - Adding a language should be a 2-3 hour task, not 2 days
* **Code quality** - Avoid if/else language branches in core logic
* **SOLID principles** - Open/Closed Principle (open for extension, closed for modification)

## Considered Options

### Option 1: Continue with If/Else Branches (Status Quo)
**Pros:**
- No refactoring needed
- All logic in one file

**Cons:**
- Each language adds more nested conditionals
- Risk of breaking existing languages when adding new ones
- 407-line file would grow to 1000+ lines with 5 languages
- Hard to test language-specific logic in isolation
- Violates Open/Closed Principle

**Example of what it would become:**
```typescript
function findTopLevelNodes(rootNode, language) {
  if (language === 'typescript' || language === 'javascript') {
    // TS/JS logic (60 lines)
  } else if (language === 'python') {
    // Python logic (60 lines)
  } else if (language === 'go') {
    // Go logic (60 lines)
  } // ... becomes unmaintainable
}
```

### Option 2: Extract Language Parsers into Separate Files
**Pros:**
- Separates parsing logic
- Each language in its own file

**Cons:**
- Doesn't address traversal logic duplication
- Still needs language checks in chunker
- Only moves problem, doesn't solve it

### Option 3: Use Strategy Pattern with LanguageTraverser Interface (Chosen)
**Pros:**
- Complete separation of concerns
- Each language fully encapsulated
- Zero if/else branches in core logic
- Easy to test each language independently
- Adding new language doesn't modify existing code
- Follows Open/Closed Principle

**Cons:**
- Requires upfront interface design
- More files to navigate (mitigated by clear structure)

## Decision Outcome

**Chosen option: "Option 3: Use Strategy Pattern with LanguageTraverser Interface"**

In the context of enabling multi-language AST support,  
facing the problem that hardcoded language logic prevents scalability,  
we decided for implementing the Strategy Pattern with a LanguageTraverser interface  
to achieve complete isolation of language-specific traversal logic,  
accepting the upfront cost of interface design for long-term maintainability.

### Architecture

```
┌──────────────────────────────────┐
│   chunker.ts (366 lines)         │
│   Language-agnostic logic        │
│                                  │
│   Uses: getTraverser(language)   │
└────────────┬─────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────┐
│         traversers/index.ts (Registry)         │
│         Maps language → traverser              │
└────┬────────┬────────────┬────────────────────┘
     │        │            │
     ▼        ▼            ▼
┌─────────┐ ┌──────────┐ ┌──────────┐
│   TS    │ │   JS     │ │  Python  │ (future)
│ (100L)  │ │ (100L)   │ │ (100L)   │
└─────────┘ └──────────┘ └──────────┘
```

### LanguageTraverser Interface

```typescript
export interface LanguageTraverser {
  // AST node types that should be extracted as chunks
  targetNodeTypes: string[];
  
  // Containers whose children should be extracted
  containerTypes: string[];
  
  // Variable declarations that might contain functions
  declarationTypes: string[];
  
  // Function implementation types
  functionTypes: string[];
  
  // Should we extract this container's children?
  shouldExtractChildren(node: SyntaxNode): boolean;
  
  // Is this a declaration with a function?
  isDeclarationWithFunction(node: SyntaxNode): boolean;
  
  // Get container body (e.g., class body)
  getContainerBody(node: SyntaxNode): SyntaxNode | null;
  
  // Should we traverse into children?
  shouldTraverseChildren(node: SyntaxNode): boolean;
  
  // Find parent container name (e.g., class name for method)
  findParentContainerName(node: SyntaxNode): string | undefined;
  
  // Find function inside a declaration
  findFunctionInDeclaration(node: SyntaxNode): DeclarationFunctionInfo;
}
```

### Implementation Example

**TypeScript/JavaScript Traverser:**
```typescript
export class TypeScriptTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_declaration',
    'method_definition',
    'interface_declaration',
  ];
  
  containerTypes = ['class_declaration'];
  
  shouldExtractChildren(node) {
    return node.type === 'class_declaration';
  }
  
  // ... 6 more methods
}
```

**Adding Python (Future):**
```typescript
export class PythonTraverser implements LanguageTraverser {
  targetNodeTypes = [
    'function_definition',
    'async_function_definition',
  ];
  
  containerTypes = ['class_definition'];
  
  // ... implement same interface
}

// Register it (1 line!)
const registry = {
  typescript: new TypeScriptTraverser(),
  javascript: new JavaScriptTraverser(),
  python: new PythonTraverser(),  // ← Just add this!
};
```

## Consequences

### Positive

* ✅ **Scalable architecture** - Adding Python now takes 2-3 hours instead of 2 days
* ✅ **Zero risk to existing languages** - Python changes can't break TypeScript/JavaScript
* ✅ **Easy to test** - Each traverser can be unit tested independently
* ✅ **Clean code** - Chunker reduced from 407 to 366 lines (-10%)
* ✅ **No if/else branches** - Language selection via registry lookup
* ✅ **SOLID compliance** - Follows Open/Closed Principle
* ✅ **Clear path forward** - Pattern established for 10+ languages
* ✅ **Better developer experience** - New contributors can add languages without understanding entire codebase

### Negative

* ⚠️ **More files** - 3 files per language instead of inline code (acceptable for isolation)
* ⚠️ **Interface maintenance** - Changes to interface require updating all traversers (rare, and discoverable via TypeScript)

### Neutral

* 🔄 **No breaking changes** - Existing TS/JS chunking works identically
* 🔄 **Same test coverage** - All 553 tests still passing
* 🔄 **Performance unchanged** - Registry lookup is negligible overhead

## Implementation Details

### File Structure

```
src/indexer/ast/
├── chunker.ts                    # Language-agnostic chunking logic
├── parser.ts                     # Tree-sitter parser wrapper
├── symbols.ts                    # Symbol extraction
├── languages/                    # Per-language definitions (see ADR-005)
│   ├── types.ts                  # LanguageDefinition interface
│   ├── registry.ts               # Central registry
│   ├── typescript.ts             # TypeScript definition
│   ├── javascript.ts             # JavaScript definition
│   ├── php.ts                    # PHP definition
│   └── python.ts                 # Python definition
├── traversers/
│   ├── index.ts                  # Delegates to language registry
│   ├── types.ts                  # LanguageTraverser interface
│   ├── typescript.ts             # TypeScript/JavaScript implementation
│   ├── php.ts                    # PHP implementation
│   └── python.ts                 # Python implementation
└── extractors/
    ├── index.ts                  # Delegates to language registry
    ├── types.ts                  # LanguageExportExtractor interface
    ├── javascript.ts             # TypeScript/JavaScript implementation
    ├── php.ts                    # PHP implementation
    └── python.ts                 # Python implementation
```

### Key Design Decisions

1. **Functional approach in traversers** - Methods that take nodes and return results (no mutable state)
2. **Explicit dependencies** - Traverser receives content and parent context as parameters
3. **Fail-safe registry** - Unknown languages throw clear error messages
4. **Type safety** - TypeScript ensures all traversers implement full interface
5. **Language sharing** - JavaScript extends TypeScriptTraverser (they share AST structure)

### Migration Path

No migration needed - 100% backward compatible. TypeScript and JavaScript use the same AST structure from `tree-sitter-typescript`, so they share the same traverser implementation.

## Validation

### Before Strategy Pattern
```
❌ chunker.ts: 407 lines with hardcoded TS/JS logic
❌ Adding Python requires modifying core file
❌ Risk of breaking existing languages
❌ if/else branches for language checks
❌ Estimated time to add Python: 2 days
```

### After Strategy Pattern
```
✅ chunker.ts: 366 lines, language-agnostic
✅ TypeScriptTraverser: 102 lines, fully isolated
✅ Adding Python: Create python.ts + 1 line registry entry
✅ Zero if/else branches in core logic
✅ All 553 tests passing
✅ Estimated time to add Python: 2-3 hours
```

### Time to Add a New Language

| Task | Time |
|------|------|
| Install tree-sitter-{language} | 5 min |
| Create {language}.ts traverser | 1 hour |
| Add to registry | 1 min |
| Write tests | 45 min |
| Update docs | 15 min |
| **Total** | **~2-3 hours** |

## Related Decisions

* [ADR-001: Split VectorDB Module](0001-split-vectordb-module.md) - Also uses separation of concerns
* [ADR-003: AST-Based Semantic Chunking](0003-ast-based-chunking.md) - The feature this enables

## References

* [Strategy Pattern (Gang of Four)](https://en.wikipedia.org/wiki/Strategy_pattern)
* [Open/Closed Principle (SOLID)](https://en.wikipedia.org/wiki/Open%E2%80%93closed_principle)
* [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
* [PR: Language-Agnostic AST Traversal](https://github.com/getlien/lien)
* Internal: `.wip/adding-python-ast-guide.md` - Step-by-step guide for next language

## Supported Languages

| Language | Tree-sitter Package | Status |
|----------|-------------------|--------|
| TypeScript | tree-sitter-typescript | Supported |
| JavaScript | tree-sitter-javascript | Supported |
| PHP | tree-sitter-php | Supported |
| Python | tree-sitter-python | Supported |

## Evolution: Per-Language Definitions

This ADR's strategy pattern was further refined by [ADR-005](0005-per-language-definition-pattern.md), which consolidated all language-specific data (grammar, traverser, extractor, complexity constants, symbol types) into single per-language definition files. The traverser classes established here remain as the AST traversal logic, but are now referenced from a central `LanguageDefinition` rather than a standalone registry.

[ADR-006](0006-consolidated-language-files-with-import-extractors.md) further consolidated the architecture by merging traverser and extractor classes directly into the language definition files, reducing the number of files per language from 4 to 2. It also added Rust support and introduced `LanguageImportExtractor` for language-specific import extraction.

## Notes

This refactoring demonstrates the power of **good architecture**:

**Before**: "How can we add Python support?"  
**After**: "Which language should we add first?"

The shift from "if" to "which" represents a fundamental change in scalability. The Strategy Pattern transformed a **problem** (how to support multiple languages) into a **process** (follow the pattern for each language).

**Lesson**: Invest in architecture early when you know requirements will scale. The 1-day refactoring cost enables 10+ languages at 2-3 hours each. 🚀

