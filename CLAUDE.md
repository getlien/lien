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

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- Bug fixes: act autonomously. Features/architecture: plan first and get approval.
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- At the start of each session, read `.claude/lessons.md` if it exists
- After ANY correction from the user: update `.claude/lessons.md` with the pattern
- Write rules that prevent the same mistake from recurring

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Explain changes at each step with a high-level summary
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Fix failing CI tests without being told how

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

Use `collect.js` for readable data transformations (groupBy, countBy, chained map/filter/sort). Prefer native `.map()`, `.filter()` for simple single operations or performance-critical paths.

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

## When in Doubt

1. **Prefer readability over cleverness**
2. **Make it work, then make it good, then (maybe) make it fast**
3. **Delete code rather than comment it out**
4. **Ask: "Will I understand this in 6 months?"**
5. **Ask: "Would a staff engineer approve this?"**
6. **Test on real codebases early and often**

Before adding features: Is this needed now? Can users work around it? Is it critical to core value? If no — defer it.

---

**Ship early, ship often.** Perfect is the enemy of done.
