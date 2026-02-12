# Lien Project Rules

## What is Lien?

Local-first semantic code search tool providing context to AI coding assistants via MCP (Model Context Protocol).

**Key Facts:**
- Package: `@liendev/lien`
- Port: 7133 (L=7, I=1, E=3, N=3)
- License: AGPL-3.0 | Domain: lien.dev

**Structure:**
```
packages/cli/src/
├── cli/         # Commands (init, index, serve, status)
├── mcp/         # MCP server
├── indexer/     # Chunking, scanning, test associations
├── embeddings/  # Local embeddings (transformers.js)
├── vectordb/    # LanceDB vector storage
├── config/      # Config management & migration
├── frameworks/  # Framework detection (Node.js, Laravel)
└── git/         # Git integration

packages/core/src/indexer/ast/
├── languages/   # Per-language definitions (single source of truth)
├── traversers/  # Language-specific AST traversal classes
├── extractors/  # Language-specific export extraction classes
├── complexity/  # Complexity metrics (cyclomatic, cognitive, Halstead)
├── parser.ts    # Tree-sitter parser wrapper
├── chunker.ts   # AST-based semantic chunking
└── symbols.ts   # Symbol extraction
```

---

## Lien MCP Tools — MANDATORY Usage

Lien provides semantic code search via MCP. These tools are **not optional** — they MUST be used as described below. Using grep/glob when a Lien tool is appropriate is a violation of this project's workflow.

### MANDATORY: Before Editing Any File

**You MUST run `get_files_context` before using the Edit tool on any file. No exceptions.**

- Check `testAssociations` to know which tests to run after your change
- Review `imports`, `exports`, and `callSites` to understand the file's role
- Use batch mode when editing multiple files: `get_files_context({ filepaths: ["file1.ts", "file2.ts"] })`

### MANDATORY: Before Modifying Any Exported Symbol

**You MUST run `get_dependents` before renaming, removing, or changing the signature of any exported function, class, or interface.**

- Check `dependentCount` and `riskLevel` to understand impact
- Use the `symbol` parameter for precise usage tracking: `get_dependents({ filepath: "...", symbol: "MyFunction" })`
- If `riskLevel` is "high" or "critical", list affected dependents to the user before proceeding

### MANDATORY: For Discovery Questions

**When asked "where is X?", "how does X work?", or any question about understanding the codebase, you MUST use `semantic_search` BEFORE falling back to grep/glob.**

- `semantic_search` finds code by meaning — grep finds exact strings
- Use `semantic_search` for: "Where is authentication handled?", "How does indexing work?", "What handles file watching?"
- Use grep/glob ONLY for: exact symbol names, literal strings, config keys, TODOs

### When to Use Other Tools

| Tool | Trigger |
|------|---------|
| `list_functions` | Finding symbols by pattern (e.g., "show me all Service classes", "find all handlers") |
| `get_complexity` | Before refactoring — check if the target is already a complexity hotspot |
| `find_similar` | Before adding new code — check for existing similar patterns to stay consistent |

---

## Documentation Organization

### Temporary Documentation Rule

**ALL temporary documents MUST go in `.wip/` folder (gitignored).**

Examples of temporary docs:
- Dogfooding analysis and evaluations
- Implementation plans and status reports
- Code quality reviews and verification reports
- Performance benchmarks and test results
- Brainstorming and design exploration
- Session notes and continuation plans

### Permanent Documentation

These live in project root and are tracked in git:
- `README.md` - Main project documentation
- `CHANGELOG.md` - Release history (maintained by release script)
- `CONTRIBUTING.md` - Contributor guidelines
- `docs/` - Architecture and design documentation

**Rule:** If it's temporary or experimental -> `.wip/`. If it's permanent -> root or `docs/`.

---

## Adding a New AST Language

Each AST-supported language is a **single self-contained file** in `packages/core/src/indexer/ast/languages/` containing everything: traverser class, export extractor class, import extractor class, and the `LanguageDefinition` that wires them together.

### Steps to add a new language:

1. **Create definition**: `languages/newlang.ts` with traverser, extractors, and `LanguageDefinition`
2. **Register it**: Import + add to `definitions` array in `languages/registry.ts`

**2 files total.** All language-specific code (traversal logic, import/export extraction, complexity constants, symbol types) lives in one file per language. Path normalization extensions are automatically derived from the registry.

### Re-export / barrel file support

The dependency analyzer (`get_dependents`) tracks transitive dependents through barrel/index files. This works at the metadata level — it reads `imports`, `importedSymbols`, and `exports` from chunk metadata. The analyzer is **language-agnostic**; each language just needs to populate the metadata correctly.

If the new language has a re-export pattern (e.g., Python `__init__.py`, Rust `pub use`), the **export extractor** must include re-exported symbols in the `exports` array. The **import extractor** handles import path extraction and symbol mapping. Once both sides are populated, the re-export resolution works automatically.

| Language | Re-export pattern | Where to handle |
|----------|------------------|-----------------|
| TS/JS | `export { X } from './module'` | Import extractor in `languages/javascript.ts` |
| Python | `from .auth import X` in `__init__.py` | Export extractor in `languages/python.ts` |
| Rust | `pub use crate::auth::X` | Export extractor in `languages/rust.ts` |

### Key files:
- `languages/types.ts` — `LanguageDefinition` interface
- `languages/registry.ts` — Central registry (`getLanguage()`, `detectLanguage()`, `getAllLanguages()`, `getSupportedExtensions()`)
- `languages/{lang}.ts` — One per language (typescript, javascript, php, python, rust)
- `extractors/types.ts` — `LanguageExportExtractor` and `LanguageImportExtractor` interfaces
- `traversers/types.ts` — `LanguageTraverser` interface

Complexity files, parser, symbol extraction, and traverser/extractor registries all consume from the central registry rather than maintaining their own language-specific constants.

---

## Core Principles

### KISS (Keep It Simple, Stupid)
- Simple > Clever
- Code junior devs can understand
- Question complexity: "Can this be simpler?"

### YAGNI (You Aren't Gonna Need It)
- Don't build "just in case"
- Wait for actual need
- Delete unused code aggressively

### DRY (Don't Repeat Yourself)
- But don't abstract too early (wait for 3rd use)
- Duplication > wrong abstraction

### Single Responsibility
- Each function does ONE thing
- If you can't explain it in one sentence, split it

### Fail Fast
- Validate inputs early
- Throw errors immediately
- Use TypeScript types to catch errors at compile time

---

## Data Transformation with collect.js

Use `collect.js` for readable data transformations instead of imperative loops.

### When to Use
- Aggregating data (groupBy, countBy, sum)
- Chaining multiple transformations (map -> filter -> sort)
- Building lookup structures from arrays

### When NOT to Use
- Simple single operations (use native `.map()`, `.filter()`)
- Performance-critical hot paths
- When it adds complexity rather than reducing it

---

## Critical Rules

### Naming Conventions
- **Variables/Functions:** camelCase (`indexFile`, `vectorDB`)
- **Classes/Interfaces:** PascalCase (`VectorDB`, `CodeChunk`)
- **Constants:** UPPER_SNAKE_CASE (`DEFAULT_PORT`)
- **Files:** kebab-case (`vector-db.ts`)

### Import Order
```typescript
// 1. Node built-ins
import fs from 'fs/promises';
// 2. External dependencies
import { Command } from 'commander';
// 3. Internal modules
import { VectorDB } from '../vectordb/lancedb.js';
```

### Commits
Follow Conventional Commits:
- `feat(scope): description` - New feature
- `fix(scope): description` - Bug fix
- `docs(scope): description` - Documentation
- `refactor(scope): description` - Code refactor
- `perf(scope): description` - Performance
- `test(scope): description` - Tests
- `chore(scope): description` - Maintenance

**NEVER use `git commit --amend`** - Always create new commits.

**No AI attribution in commits or PRs.** Do not add `Co-Authored-By` lines, "Generated with Claude Code" footers, or any other AI tool branding.

---

## Before EVERY Commit (MANDATORY)

```bash
npm run format:check  # Prettier formatting must pass
npm run lint          # ESLint must pass with 0 errors
npm run typecheck     # Must pass with 0 errors
npm run build         # Must compile successfully
npm test              # All tests must pass
```

**No exceptions.** This prevents broken builds.

**Tip:** Run `npm run fix` to auto-fix both ESLint and Prettier issues.

---

## Feature Decision Framework

Before adding features, ask:
1. Is this needed for MVP? (No -> defer)
2. Can users work around this? (Yes -> defer)
3. Is this critical for core value? (No -> defer)

**Bias toward simplicity.** Defer everything that isn't absolutely necessary.

---

## Common Commands

```bash
# Development
npm run dev              # Watch mode
npm run typecheck        # Type check only
npm test                 # Run tests
npm run build            # Build CLI
```

---

## Release Process

**NEVER run `npm publish` manually.** CI handles npm publishing automatically.

### Release Workflow
```bash
# 1. Run release script
npm run release -- patch "fix: description"
npm run release -- minor "feat: description" --changelog .wip/vX.Y.Z-release-notes.md
npm run release -- major "BREAKING: description"

# 2. Push to trigger CI (CI publishes to npm)
git push origin main
git push origin vX.Y.Z
```

---

## When in Doubt

1. **Prefer readability over cleverness**
2. **Make it work, then make it good, then (maybe) make it fast**
3. **Delete code rather than comment it out**
4. **Ask: "Will I understand this in 6 months?"**
5. **Test on real codebases early and often**

---

**Ship early, ship often.** Perfect is the enemy of done.
