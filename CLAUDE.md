# Lien Project Rules

## What is Lien?

Local-first code-health CLI. Parses the working tree on demand with Tree-sitter and answers four questions about a change: what is risky to touch, what crossed a complexity threshold, what deterministic signals fire on the diff, and where the hotspots are. No server, no persisted index, no search.

**Key Facts:**
- Package: `@liendev/lien`
- Commands: `lien complexity`, `lien health`, `lien review`, `lien delta` — that is the whole surface
- License: AGPL-3.0 | Domain: lien.dev

**Monorepo Structure:**
- `packages/` — TypeScript packages: `parser` and `core` publish as `@liendev/parser`/`@liendev/core`; `cli` publishes as `@liendev/lien`; `review`, `action`, and `site` are private (unpublished).
- Dependency chain: `parser` ← `core` ← `cli`; `review` depends on `parser` only (not `core`); `action` wraps `review` as a self-hostable GitHub Action ([ADR-012](docs/architecture/decisions/0012-self-hostable-review-action.md)).
- `.claude/skills/review/` — the review skill that replaced the Claude Code plugin. The plugin (MCP config + 12 hooks) is **deleted**, and so is the MCP server it configured. Its hooks used to auto-annotate reads and run the `lien delta` gate on writes; **both are manual now** — run `lien delta` yourself before committing. The test-association reminder is gone: it called `lien annotate`'s index-backed per-file lookup. The mapping itself survives in `@liendev/parser` (`findTestAssociationsFromChunks`, chunk-based, never index-backed) — `lien health` prints test paths for the functions it ranks — but no command answers it for an arbitrary file you name.
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
├── signals/         # Deterministic review signals — pure functions over a diff
│                    # plus parser output (no LLM/network/index). Lifted out of
│                    # packages/review. Barrel is CURATED: a symbol is public
│                    # only when production code outside its module imports it
│                    # (38 of ~110) — parser is published, so an exported
│                    # internal is semver-locked. Tests for the 14 *-signals.ts
│                    # modules still live in packages/review/test/ pending
│                    # relocation; signals-test-location.test.ts guards that.
├── ecosystem-presets.ts  # Project-type detection — replaced the old frameworks/
│                         # plugin system (ADR-007); NOT a `frameworks/` directory
├── workspace-packages.ts # Workspace specifier resolution for cross-package dependents (#681)
└── scanner.ts, gitignore.ts, chunker.ts, dependency-analyzer.ts,
    test-associations.ts, symbol-extractor.ts, content-hash.ts

packages/core/src/          # Config, git, errors — depends on parser.
│                           # The structural store (vectordb/, indexer/, gc/) is
│                           # DELETED; core is now small enough that it is slated
│                           # to fold into cli.
├── config/      # Per-project ConfigService (.lien.config.json — complexity.thresholds only)
├── git/         # Git state tracking, linked-worktree detection (git/worktree.ts)
├── errors/      # Error codes + typed error classes
├── utils/       # Shared helpers (chunk-array, safe-regex, version)
└── insights/    # Report formatters (text/JSON/SARIF)

packages/cli/src/           # The CLI — depends on core and parser
├── cli/         # Commands: complexity, health, review, delta (+ their git/signal helpers)
├── types/       # Shared TypeScript types
└── utils/       # CLI utilities (incl. scan-failure.ts — the no-data honesty gate)

packages/review/src/        # PR review engine (plugins, blast-radius render, prompt building)
                             # — depends on parser only, not core
packages/action/src/        # Self-hostable GitHub Action wrapping @liendev/review
packages/site/              # VitePress docs site (lien.dev)
```

---

## Discovery — grep and Glob

Lien no longer ships an MCP server, a persisted index, or lexical search. The
`search_code` / `get_files_context` / `get_dependents` / `list_functions`
workflow this section used to mandate is gone, and so is the store it read
from. Use Claude Code's own Read, Grep and Glob for discovery; they are now
the only tools for it, so no policy is needed to choose between them.

What Lien still answers, it answers by parsing the working tree on demand:

| Question | Command |
|---|---|
| What is risky to change here? | `lien health` |
| Did this change push a function over a complexity threshold? | `lien delta` |
| What deterministic signals fire on this diff? | `lien review` |
| Where are the complexity hotspots? | `lien complexity` |

The `/review` skill (`.claude/skills/review/`) drives the last two for a
change review.

---

## No-Data Honesty — MANDATORY for New Commands

**A read-only command MUST NEVER produce a confident answer when it has no
data to answer from.** An empty scan that formats as "0 violations, clean!"
and a genuinely clean codebase are the same shape unless the command checks
which one it actually has — checking is not optional.

This rule outlived the index that motivated it. The four-state index
vocabulary (S0–S3), `classifyIndexState`, `findUnindexedPaths` and the
`index-state-matrix.test.ts` completeness guard are all gone with the store,
but the failure they existed to prevent is not: a failed or empty **parse**
produces exactly the same false clean an empty index did.

`performChunkOnlyIndex` reports failure by RETURNING `{ success: false }`
rather than throwing, so it is easy to miss. Every command that parses the
tree routes through `describeScanFailure`
(`packages/cli/src/utils/scan-failure.ts`) and responds by disposition:
`complexity` is gate-shaped and hard-errors; `health` is advisory and warns
loudly at exit 0.

The same duty applies to a command's own empty states, which is not only
about parse failure — `lien review` distinguishes "no changes at all" from
"changes, but nothing analyzable in them" from "analyzable changes, no
candidates", because collapsing them tells the reader to go looking for the
wrong problem.

**Hard constraint: never turn a genuinely clean result into a false alarm.**
Gate on the actual state, never on the shape of the result — see #1014 for
what over-firing costs (a false caveat that fires every session gets trained
out as noise).

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
spend; see `packages/parser/src/signals/stale-literal-signals.ts` for the template.

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
- CLI changes → run the actual command against this repo and read the output.
- Skill changes → invoke it (`/review`) on a real diff and read what it produces. A skill that reads well and guides badly is the failure mode; prose is not self-verifying.
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
import { performChunkOnlyIndex } from '@liendev/parser';
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

- **CodeRabbit is the PR review now.** This repo no longer reviews its own PRs
  with Lien Review — `lien-review.yml` is gone, since the review engine is being
  cut (see the simplification plan). Triage CodeRabbit's comments before
  merging: `gh api --paginate repos/getlien/lien/pulls/N/comments` for inline
  ones and `gh api --paginate repos/getlien/lien/issues/N/comments` for its
  summary. Fix or explicitly dismiss each finding.
  - **A green CodeRabbit check is not proof it reviewed.** Its status line
    carries the reason: "Review completed" means it ran, "Review rate limited"
    means it did not. Read the reason, not the colour.
- **Complexity is gated by `lien delta --base`, not by a review bot.** That job
  fails only when a function crosses a threshold it was under at the PR's base,
  which is the question worth gating on. Note it is the ONLY complexity gate
  now, so a PR that leaves a pre-existing violation untouched passes — by
  design.
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
