# Lien Project Rules

## What is Lien?

Local-first structural code search tool (lexical FTS5 search + dependency analysis) providing context to AI coding assistants via MCP (Model Context Protocol).

**Key Facts:**
- Package: `@liendev/lien`
- Port: 7133 (L=7, I=1, E=3, N=3)
- License: AGPL-3.0 | Domain: lien.dev

**Monorepo Structure:**
- `packages/` — TypeScript packages: `parser` and `core` publish as `@liendev/parser`/`@liendev/core`; `cli` publishes as `@liendev/lien`; `review`, `action`, and `site` are private (unpublished).
- Dependency chain: `parser` ← `core` ← `cli`; `review` depends on `parser` only (not `core`); `action` wraps `review` as a self-hostable GitHub Action ([ADR-012](docs/architecture/decisions/0012-self-hostable-review-action.md)).
- `plugins/claude/` — the dogfooded Claude Code plugin (MCP server config + hooks). Hooks auto-annotate reads, and on writes run the `lien delta` gate plus a test-association reminder, i.e. they automate three of this file's own MANDATORY policies — see `plugins/claude/README.md`.
- `lien-review-testbed/` — tracked, multi-language fixture app used by the review-agent test harness. Not a demo to clean up.

**Package Structure:**
```
packages/parser/src/        # AST parsing, chunking, complexity, scanning — zero deps on core
├── ast/
│   ├── languages/   # Per-language definitions (single source of truth)
│   ├── traversers/  # Language-specific AST traversal classes
│   ├── extractors/  # Language-specific import/export/symbol extraction classes
│   └── complexity/  # Complexity metrics (cyclomatic, cognitive, Halstead)
├── risk/            # Blast-radius risk scoring
├── insights/        # Complexity report types
├── ecosystem-presets.ts  # Project-type detection — replaced the old frameworks/
│                         # plugin system (ADR-007); NOT a `frameworks/` directory
├── workspace-packages.ts # Workspace specifier resolution for cross-package dependents (#681)
└── scanner.ts, gitignore.ts, chunker.ts, dependency-analyzer.ts,
    test-associations.ts, symbol-extractor.ts, content-hash.ts

packages/core/src/          # Structural store, config, git — depends on parser
├── indexer/     # Indexing orchestration: manifest, incremental updates, scanning glue
├── vectordb/    # Storage backend behind VectorDBInterface + createVectorDB factory;
│   └── sqlite/  #   SqliteBackend — SQLite structural store + FTS5/BM25 lexical search
│                #   (LanceDB + embeddings removed — see ADR-011)
│                #   OverlayBackend shares a linked worktree's index with its main
│                #   checkout (read-only base + writable overlay) — see
│                #   docs/architecture/worktree-aware-indexing.md
├── config/      # Config management & migration (GlobalConfig + per-project ConfigService)
├── git/         # Git state tracking, linked-worktree detection (git/worktree.ts)
├── errors/      # Error codes + typed error classes
├── utils/       # Shared helpers (chunk-array, safe-regex, version)
└── insights/    # ComplexityAnalyzer + formatters (text/JSON/SARIF)

packages/cli/src/           # CLI + MCP server — depends on core and parser
├── cli/         # Commands: init, index, serve, status, config, complexity, path, annotate
├── mcp/         # MCP server and tool handlers (search_code, get_dependents, etc.)
├── watcher/     # File watching
├── types/       # Shared TypeScript types
└── utils/       # CLI utilities

packages/review/src/        # PR review engine (plugins, blast-radius render, prompt building)
                             # — depends on parser only, not core
packages/action/src/        # Self-hostable GitHub Action wrapping @liendev/review
packages/site/              # VitePress docs site (lien.dev)
```

---

## Lien MCP Tools — MANDATORY Usage

<!-- Keep in sync with SERVER_INSTRUCTIONS in packages/cli/src/mcp/instructions.ts — it re-injects this same policy into every connecting MCP client. -->

Lien provides lexical (FTS5) code search and dependency analysis via MCP. These tools are **not optional** — they MUST be used as described below. Using grep/glob when a Lien tool is appropriate is a violation of this project's workflow.

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

**When asked "where is X?", "how does X work?", or any question about understanding the codebase, you MUST use `search_code` BEFORE falling back to grep/glob.**

- `search_code` is full-text (BM25) keyword search over code, docstrings, and camelCase-split identifiers — query with concrete keywords/identifiers/domain terms, not natural-language questions. There are no embeddings, so meaning-only paraphrases that share no words with the code won't match.
- Use `search_code` for: "authenticate user session", "index codebase pipeline", "file watcher debounce" — words that appear in the code
- Use grep/glob ONLY for: exact symbol names, literal strings, config keys, TODOs (or `list_functions` for a single exact symbol name)

### When to Use Other Tools

| Tool | Trigger |
|------|---------|
| `list_functions` | Finding symbols by pattern (e.g., "show me all Service classes", "find all handlers") |
| `get_complexity` | Before refactoring — check if the target is already a complexity hotspot |
| `find_similar` | Before adding new code — check for existing similar patterns to stay consistent |

---

## Agent-Review Rule Development — Use the Test Harness

Adding or tweaking a rule in `packages/review/src/plugins/agent/` MUST go
through the offline test harness at `packages/review/test/harness/`. Don't
ship prompt or rule changes via the deploy → synthetic-PR loop — the harness
exists specifically to make that cycle ~30 minutes instead of hours.

- Inner loop: invoke `/test-harness <rule-id>` from CC for free
  Claude-subagent iteration on existing fixtures.
- Shipping gate: `npm run test:harness -w @liendev/review -- --rule <rule-id> --calibrate 10`
  must hit ≥ 9/10 against OpenRouter, on the prod default model
  (`moonshotai/kimi-k2.7-code` — omit `--model` to use it) before merging
  the change. The harness auto-loads `OPENROUTER_API_KEY` from `.env` at
  the repo root.
- Workflow + failure modes: see `packages/review/test/harness/README.md`.
  Includes the end-to-end recipe for capturing a real-PR fixture, authoring
  Tier 1/2 assertions, iterating, and calibrating. The formerly known-red
  Kimi canaries were reconciled 2026-07-10 (see the README's "Known-red
  reconciliation" note); before trusting any red fixture, confirm it's a
  healthy capture — the native parser must be built or capture fails loudly.

A rule is not shippable until its calibration meets the bar. CC mode is
necessary but not sufficient.

**Design principle:** if a rule's detection is really a deterministic
index/diff query wearing an LLM-reasoning costume (e.g. "does this literal
still appear unconditionally elsewhere?"), precompute it and inject it as a
signal block — same pattern as `blast_radius` — instead of asking the agent
to grep-and-reason. Deterministic signals are unit-testable with zero LLM
spend; see `packages/review/src/stale-literal-signals.ts` for the template.

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
- Model policy: dispatch subagents on Sonnet by default (build, fix, verify,
  cleanup, exploration probes). Reserve Opus for orchestration and adversarial
  review (verifying/attacking another agent's work, judging rebuttals).

### 3. Self-Improvement Loop
- At the start of each session, read `.claude/lessons.md` if it exists
- After ANY correction from the user: update `.claude/lessons.md` with the pattern
- `.claude/lessons.md` is git-tracked — lessons that prove durable should be
  promoted into this file or `docs/` and removed from lessons.md, not left to
  accumulate indefinitely

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Explain changes at each step with a high-level summary
- Run tests, check logs, demonstrate correctness

**Dogfood before shipping (MANDATORY).** CI-green + unit tests are not
shipping criteria on their own. Before a PR is declared merge-ready,
exercise the change the way its real consumer experiences it and put the
verbatim evidence in the PR body:
- CLI/MCP changes → run the actual command/tool against this repo and read the output.
- Hook/plugin changes → invoke the hook with the real stdin shape Claude Code sends; verify what surfaces (and TTL/fail-open behavior).
- Review-engine changes → replay through the harness (build-prompts/fixtures) or a captured real run.
- Site/docs → `npm run docs:build` AND read the rendered result.
If pre-merge dogfooding is genuinely impossible (needs production traffic),
the PR must say so explicitly and the dogfood happens immediately
post-merge — silence is not an option.

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
- `CHANGELOG.md` - Historical release notes (frozen; current changelogs are per-package, generated by changesets)
- `CONTRIBUTING.md` - Contributor guidelines
- `docs/` - Architecture and design documentation

**Rule:** If it's temporary or experimental -> `.wip/`. If it's permanent -> root or `docs/`.

---

## Style Guide

**Read `STYLE_GUIDE.md` before making any UI or frontend changes.** It defines the design identity: typography (Satoshi/JetBrains Mono), color system (dark-first, zinc neutrals, purple accent), surface hierarchy, component patterns, motion, and accessibility requirements. All frontend work must conform to the style guide.

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
- Perf work: profile against the real workload first. Prefer a surgical fix
  to existing code over a new daemon/process/file

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
import { createVectorDB } from '../vectordb/factory.js';
```

### Tree-sitter Node Iteration
Tree-sitter `SyntaxNode` exposes `.namedChildren` and `.children` as arrays. **Never use manual index loops** (`for (let i = 0; i < node.namedChildCount; i++)`). Use array methods instead:

| Pattern | Use |
|---|---|
| Iterate all children | `.forEach()` or `for (const child of node.namedChildren)` |
| Find first match | `.find()` |
| Check a condition | `.some()` |
| Filter then process | `.filter().forEach()` or `.filter().map()` |
| Recursive search with early return | `for (const child of node.namedChildren)` |
| Collect/transform | `.map()`, `.flatMap()`, `.filter()` |

Reference: `packages/parser/src/ast/languages/csharp.ts`

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
lien delta            # No NEW complexity threshold crossings vs HEAD (exit 0)
```

**No exceptions.** This prevents broken builds. All six gates are CI-backstopped
(`.github/workflows/ci.yml`) on every PR, including gate 6 (`lien delta`),
which runs as its own job comparing the working tree against the PR's base
branch (`lien delta --base`), not against `HEAD`. Don't skip it locally just
because CI would catch a crossing anyway.

`npm run build` doesn't cover `packages/site`; for docs/site changes also run
`npm run docs:build`. `npm test` excludes `packages/cli`'s E2E suite
(`vitest run --exclude 'test/e2e/**'`); cross-language AST changes should also
run the relevant `npm run test:e2e:<lang> -w packages/cli`.

**`lien delta`** is the sixth gate: a ~50 ms deterministic check that fails
(exit 1) only when your working-tree changes push a function's complexity over a
threshold it was under at `HEAD` (a new-over-threshold or crossed function).
Improving, or merely touching a pre-existing violation, never fails. If it
flags a crossing, simplify the function before committing — do not reach for
`--soft` (advisory, always exit 0) to silence it. `lien` isn't on PATH until a
one-time `cd packages/cli && npm link` (see CONTRIBUTING.md); without that,
use `node packages/cli/dist/index.js delta`.

**Tip:** Run `npm run fix` to auto-fix both ESLint and Prettier issues.

**Fast inner loop:** while iterating, scope tests to the touched package
(`npm run test -w @liendev/<pkg> -- path/to/file.test.ts`) — the full gate
chain above is for the final pre-commit run, not every edit.

**Working in a git worktree:** a fresh `npm install` fails there (native
tree-sitter won't compile) — see `docs/development/worktree-development.md`.

---

## Before Merging a PR

- **CI-green ≠ review-clean.** The Lien Review check can pass even with
  findings — fetch and triage the `lien-stats` block and inline comments
  before merging: `gh pr view N --json body` (look for the `lien-stats`
  block) and `gh api repos/getlien/lien/pulls/N/comments`. Fix or explicitly
  dismiss each finding first.
- Never `gh pr merge --admin` to bypass checks. Wait for CI.
- Stacked PRs: squash-merging a parent with `--delete-branch` auto-closes
  child PRs whose base was that branch, and a closed PR with a deleted base
  can't be reopened. Rebase children onto main first:
  `git rebase --onto origin/main <old-parent-tip> <child-branch>`.

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
