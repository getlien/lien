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

## Lien MCP Tools

Semantic search tools that complement grep. Use Lien for discovery and understanding, grep for exact matches.

### Tool Quick Reference

| Tool | Use for |
|------|---------|
| `semantic_search` | "Where/how is X implemented?" - natural language queries |
| `get_files_context` | Before editing - shows test associations and dependencies |
| `list_functions` | Find symbols by pattern (e.g., `.*Controller.*`) |
| `get_dependents` | Impact analysis - "What breaks if I change this?" |
| `get_complexity` | Tech debt hotspots |
| `find_similar` | Find similar code patterns |

### Before Editing Files

Always run `get_files_context` first to check `testAssociations`.

### Lien vs grep

- **Lien**: "Where is authentication handled?" (meaning-based)
- **grep**: `validateEmail` (exact string match)

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

Each AST-supported language has a single definition file in `packages/core/src/indexer/ast/languages/` containing all language-specific data (grammar, traverser, extractor, complexity constants, symbol types).

### Steps to add a new language (e.g., Rust):

1. **Create definition**: `languages/rust.ts` with the full `LanguageDefinition`
2. **Register it**: Import + add to `definitions` array in `languages/registry.ts`
3. **Create traverser**: `traversers/rust.ts` (the traverser class with AST traversal logic)
4. **Create extractor**: `extractors/rust.ts` (the export extractor class)

**4 files total.** All language-specific *data* (node types, operator sets, extensions) lives in the definition file. The traverser/extractor *classes* stay in their own folders since they contain logic, not just data.

### Key files:
- `languages/types.ts` — `LanguageDefinition` interface
- `languages/registry.ts` — Central registry (`getLanguage()`, `detectLanguage()`, `getAllLanguages()`)
- `languages/{lang}.ts` — One per language (typescript, javascript, php, python)

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
npm run typecheck  # Must pass with 0 errors
npm run build      # Must compile successfully
npm test           # All tests must pass
```

**No exceptions.** This prevents broken builds.

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
