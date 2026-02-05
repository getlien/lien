# ADR-006: Consolidate Language Files and Add Import Extractors

**Status**: Accepted
**Date**: 2026-02-05
**Deciders**: Core Team
**Supersedes**: Partially supersedes [ADR-005](0005-per-language-definition-pattern.md)
**Related**: [ADR-002](0002-strategy-pattern-ast-traversal.md), [ADR-005](0005-per-language-definition-pattern.md)

## Context and Problem Statement

[ADR-005](0005-per-language-definition-pattern.md) consolidated language-specific *data* into per-language definition files, but the traverser and extractor *classes* remained in separate directories (`traversers/{lang}.ts`, `extractors/{lang}.ts`). This meant adding a new language still required **4 files**:

1. `languages/{lang}.ts` — definition data
2. `traversers/{lang}.ts` — traverser class
3. `extractors/{lang}.ts` — export extractor class
4. `languages/registry.ts` — registration

Additionally, import extraction logic was hardcoded in `symbols.ts` with language-specific handlers, making it difficult to add import support for new languages (like Rust).

**Specific problem**: Rust `use` declarations were completely missing from import extraction. `extractImports()` and `extractImportedSymbols()` had no handler for Rust's `use_declaration` nodes, so Rust files had empty `imports` and `importedSymbols` metadata. This meant `get_dependents` couldn't find ANY dependents for Rust files.

## Decision Drivers

* **Rust dependency tracking** — `get_dependents` must work for Rust files
* **Fewer files per language** — 4 files is still too many touch points
* **Single source of truth** — All language-specific code should live in one place
* **Import extraction consistency** — Import handling should follow the same pattern as export extraction

## Decision Outcome

**Consolidate each language into a single self-contained file** containing:
- Traverser class
- Export extractor class
- Import extractor class (NEW)
- Language definition

**Adding a new language now requires exactly 2 files:**
1. `languages/{lang}.ts` — all classes + definition
2. `languages/registry.ts` — add to definitions array

### Architecture (After)

```
packages/core/src/indexer/ast/languages/
├── types.ts              # LanguageDefinition interface
├── registry.ts           # Central registry + getSupportedExtensions()
├── typescript.ts         # TS definition (extends JS classes)
├── javascript.ts         # JS/TS traverser + extractors + definition (~415 lines)
├── php.ts                # PHP traverser + extractors + definition (~295 lines)
├── python.ts             # Python traverser + extractors + definition (~300 lines)
└── rust.ts               # Rust traverser + extractors + definition (~480 lines)

packages/core/src/indexer/ast/
├── traversers/
│   ├── types.ts          # LanguageTraverser interface (unchanged)
│   └── index.ts          # getTraverser() — delegates to registry
└── extractors/
    ├── types.ts          # LanguageExportExtractor + LanguageImportExtractor interfaces
    └── index.ts          # getExtractor(), getImportExtractor() — delegate to registry
```

### Files Deleted (8)

- `extractors/javascript.ts` → merged into `languages/javascript.ts`
- `extractors/python.ts` → merged into `languages/python.ts`
- `extractors/php.ts` → merged into `languages/php.ts`
- `extractors/rust.ts` → merged into `languages/rust.ts`
- `traversers/typescript.ts` → merged into `languages/javascript.ts`
- `traversers/python.ts` → merged into `languages/python.ts`
- `traversers/php.ts` → merged into `languages/php.ts`
- `traversers/rust.ts` → merged into `languages/rust.ts`

### New: LanguageImportExtractor Interface

```typescript
export interface LanguageImportExtractor {
  readonly importNodeTypes: string[];
  extractImportPath(node: Parser.SyntaxNode): string | null;
  processImportSymbols(node: Parser.SyntaxNode): { importPath: string; symbols: string[] } | null;
}
```

### Updated: LanguageDefinition Interface

```typescript
interface LanguageDefinition {
  id: SupportedLanguage;
  extensions: string[];
  grammar: TreeSitterLanguage;
  traverser: LanguageTraverser;
  exportExtractor: LanguageExportExtractor;
  importExtractor?: LanguageImportExtractor;  // NEW (optional for backward compatibility)
  // ... complexity and symbols unchanged
}
```

### New: Dynamic Extension Normalization

`getSupportedExtensions()` in the registry returns all file extensions from registered languages. Both `path-matching.ts` files now build their extension-stripping regex dynamically from this function, eliminating hardcoded extension lists.

### Rust Import Extraction

The `RustImportExtractor` handles all `use` declaration variants:

| Pattern | Example | Result |
|---------|---------|--------|
| Simple | `use crate::auth::AuthService;` | `{ "auth": ["AuthService"] }` |
| List | `use crate::auth::{A, B};` | `{ "auth": ["A", "B"] }` |
| Alias | `use crate::auth::Service as Auth;` | `{ "auth": ["Auth"] }` |
| Wildcard | `use crate::models::*;` | `{ "models": ["*"] }` |
| Super | `use super::utils::helper;` | `{ "../utils": ["helper"] }` |
| External | `use std::io::Read;` | Skipped (no crate/self/super prefix) |

Path conversion: `crate::auth::middleware` → `auth/middleware`, `self::config` → `config`, `super::utils` → `../utils`

## Consequences

### Positive

* Adding a new language now requires **2 files** instead of 4
* All language-specific code is visible in one file per language
* `get_dependents` now works for Rust files
* Dynamic extension normalization — adding a language automatically extends path matching
* Import extraction follows same pattern as export extraction

### Negative

* Larger per-language files (~300-480 lines vs ~100 lines for just traverser)
* Import tests must pass language parameter (minor API change)

### Neutral

* Interface files (`traversers/types.ts`, `extractors/types.ts`) remain for external consumption
* Delegation files (`traversers/index.ts`, `extractors/index.ts`) remain for backward compatibility
* All 1407 relevant tests pass

## Validation

```
Before:
  - 4 files per language
  - Rust: no import extraction, get_dependents returns 0 dependents
  - Hardcoded extension lists in path-matching.ts

After:
  - 2 files per language
  - Rust: full import extraction, get_dependents works correctly
  - Dynamic extension normalization from registry
  - npm run typecheck: ✓
  - npm run build: ✓
  - npm test: 1407 passed (40 pre-existing qdrant failures unrelated)
```

## Related Decisions

* [ADR-002: Strategy Pattern for AST Traversal](0002-strategy-pattern-ast-traversal.md) — Established the traverser pattern
* [ADR-005: Per-Language Definition Pattern](0005-per-language-definition-pattern.md) — Previous consolidation (now superseded for file structure)
