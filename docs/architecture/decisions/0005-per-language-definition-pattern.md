# ADR-005: Consolidate Language Support into Per-Language Definitions

**Status**: Accepted
**Date**: 2026-02-03
**Deciders**: Core Team
**Related**: [ADR-002](0002-strategy-pattern-ast-traversal.md), [ADR-003](0003-ast-based-chunking.md)

## Context and Problem Statement

After implementing four AST-supported languages (TypeScript, JavaScript, PHP, Python), language-specific data was scattered across **12-16 files**:

- `parser.ts` — grammar imports, extension-to-language mapping
- `traversers/index.ts` — traverser registry
- `extractors/index.ts` — extractor registry
- `complexity/cyclomatic.ts` — decision point node types
- `complexity/cognitive.ts` — nesting types, non-nesting types, lambda types
- `complexity/halstead.ts` — operator symbols, operator keywords (per-language records)
- `symbols.ts` — call expression types
- `types.ts` — `SupportedLanguage` type

Adding a new language required touching all of these files, each with its own format for storing language-specific data. This made it easy to miss a file and hard to verify completeness.

## Decision Drivers

* **Onboarding cost** — New contributors shouldn't need to modify 12+ files to add a language
* **Single source of truth** — Language data should live in one place, not be duplicated
* **Discoverability** — Opening one file should show everything about a language
* **Correctness** — Harder to forget a file when there's only one to create

## Considered Options

### Option 1: Status Quo (Scattered Data)
Keep language-specific data spread across existing files.

**Pros:** No refactoring needed.
**Cons:** 12-16 files to modify per language. Easy to miss one.

### Option 2: Per-Language Definition Files (Chosen)
Create a `languages/` folder where each language is a single definition file. Existing modules consume from a central registry.

**Pros:** Single source of truth. 4 files per new language. Clear ownership.
**Cons:** Upfront refactoring cost. One more level of indirection.

## Decision Outcome

**Chosen option: "Per-Language Definition Files"**

In the context of scaling AST support to more languages,
facing the problem that language data was scattered across 12+ files,
we decided for consolidating into per-language definition files with a central registry
to achieve a single source of truth and reduce the cost of adding new languages,
accepting the upfront refactoring cost.

### Architecture

```
packages/core/src/indexer/ast/languages/
├── types.ts              # LanguageDefinition interface
├── registry.ts           # Central registry (getLanguage, detectLanguage, getAllLanguages)
├── typescript.ts          # Complete TS definition
├── javascript.ts          # Complete JS definition
├── php.ts                 # Complete PHP definition
└── python.ts              # Complete Python definition
```

### The LanguageDefinition Interface

```typescript
interface LanguageDefinition {
  id: string;
  extensions: string[];
  grammar: TreeSitterLanguage;
  traverser: LanguageTraverser;
  exportExtractor: LanguageExportExtractor;

  complexity: {
    decisionPoints: string[];       // cyclomatic
    nestingTypes: string[];         // cognitive
    nonNestingTypes: string[];      // cognitive
    lambdaTypes: string[];          // cognitive
    operatorSymbols: Set<string>;   // halstead
    operatorKeywords: Set<string>;  // halstead
  };

  symbols: {
    callExpressionTypes: string[];
  };
}
```

### How Consumers Use the Registry

Modules that previously maintained their own language-specific data now read from the registry:

- **`parser.ts`** — `getLanguage(lang).grammar` instead of local `languageConfig` record
- **`traversers/index.ts`** — `getLanguage(lang).traverser` instead of local registry
- **`extractors/index.ts`** — `getLanguage(lang).exportExtractor` instead of local registry
- **`complexity/cyclomatic.ts`** — Union of all `decisionPoints` built from `getAllLanguages()`
- **`complexity/cognitive.ts`** — Union of all nesting/lambda types from `getAllLanguages()`
- **`complexity/halstead.ts`** — `getLanguage(lang).complexity.operatorSymbols/Keywords`
- **`symbols.ts`** — Union of all `callExpressionTypes` from `getAllLanguages()`

Complexity functions that don't receive a language parameter (cyclomatic, cognitive) build a union of all language node types lazily. This is correct because tree-sitter only produces node types valid for the language being parsed.

## Consequences

### Positive

* Adding a new language now requires **4 files** instead of 12-16
* All language-specific data is visible in one definition file
* Central registry eliminates duplicate extension mappings and registries
* Existing function signatures preserved (no breaking API changes)

### Negative

* One more level of indirection (registry lookup instead of direct constant)
* Lazy union-set construction in complexity files (negligible runtime cost)

### Neutral

* All existing tests pass with zero changes to test files (except scanner test rename)
* Runtime behavior is identical

## Adding a New Language (After)

1. Create `languages/rust.ts` with the full `LanguageDefinition`
2. Import + register in `languages/registry.ts`
3. Create `traversers/rust.ts` (the traverser class)
4. Create `extractors/rust.ts` (the extractor class)

## Related Decisions

* [ADR-002: Strategy Pattern for AST Traversal](0002-strategy-pattern-ast-traversal.md) — Established the traverser pattern this builds on
* [ADR-003: AST-Based Semantic Chunking](0003-ast-based-chunking.md) — The feature this supports
