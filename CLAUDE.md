# Lien Project Rules

## What is Lien?

Local-first code-health CLI. Parses the working tree on demand with Tree-sitter and answers four questions about a change: what is risky to touch, what crossed a complexity threshold, what deterministic signals fire on the diff, and where the hotspots are. No server, no persisted index, no search.

**Key Facts:**
- Package: `@liendev/lien`
- Commands: `lien complexity`, `lien health`, `lien review`, `lien delta` — that is the whole surface
- License: AGPL-3.0 | Domain: lien.dev

**Monorepo Structure:**
- `packages/` — TypeScript packages: `parser` publishes as `@liendev/parser`; `cli` publishes as `@liendev/lien`; `parser-native` publishes the prebuilt Rust parser; `site` is private (unpublished). `review`, `action` and `core` are DELETED.
- Dependency chain: `parser` ← `cli`. That is the whole graph now.
- `.claude/skills/review/` — the review skill that replaced the Claude Code plugin. The plugin (MCP config + 12 hooks) is **deleted**, and so is the MCP server it configured. Its hooks used to auto-annotate reads and run the `lien delta` gate on writes; **both are manual now** — run `lien delta` yourself before committing. The test-association reminder is gone: it called `lien annotate`'s index-backed per-file lookup. The mapping itself survives in `@liendev/parser` (`findTestAssociationsFromChunks`, chunk-based, never index-backed) — `lien health` prints test paths for the functions it ranks — but no command answers it for an arbitrary file you name.

**Package Structure:**
```
packages/parser/src/        # AST parsing, chunking, complexity, scanning — no deps on cli
├── ast/
│   ├── languages/   # Per-language definitions (single source of truth)
│   ├── traversers/  # Language-specific AST traversal classes
│   ├── extractors/  # Language-specific import/export/symbol extraction classes
│   └── complexity/  # Complexity metrics (cyclomatic, cognitive, Halstead)
├── risk/            # Blast-radius risk scoring
├── insights/        # Complexity report types
├── signals/         # Deterministic review signals — pure functions over a diff
│                    # plus parser output (no LLM/network/index). Barrel is
│                    # CURATED: a symbol is public only when production code
│                    # outside its module imports it (38 of ~110) — parser is
│                    # published, so an exported internal is semver-locked.
│                    # Tests are co-located here; signals-test-location.test.ts
│                    # guards that every module has some.
├── ecosystem-presets.ts  # Project-type detection — replaced the old frameworks/
│                         # plugin system (ADR-007); NOT a `frameworks/` directory
├── workspace-packages.ts # Workspace specifier resolution for cross-package dependents (#681)
└── scanner.ts, gitignore.ts, chunker.ts, dependency-analyzer.ts,
    test-associations.ts, symbol-extractor.ts, content-hash.ts

packages/cli/src/           # The CLI — depends on parser only
├── cli/         # Commands: complexity, health, review, delta (+ their git/signal helpers)
├── config/      # Per-project ConfigService (.lien.config.json — complexity.thresholds only)
├── errors/      # Error codes + typed error classes
├── insights/    # formatters/ — complexity report output (text/JSON/SARIF)
├── types/       # Shared TypeScript types
└── utils/       # CLI utilities (incl. scan-failure.ts — the no-data honesty gate)

packages/site/              # VitePress docs site (lien.dev)
```

`config/`, `errors/` and `insights/formatters/` came from `@liendev/core`,
which phase 8 deleted. Its `git/` (`GitStateTracker`, linked-worktree
detection) did **not** come along: those existed to locate and invalidate the
index, so they died with it. The CLI does its own git work in
`cli/delta-git.ts`, and `cli/project-root.ts` resolves the root from the
`.git` marker alone — correct in a linked worktree too, where `.git` is a
file rather than a directory.

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
rather than throwing, so it is easy to miss. The three commands that go
through it — `complexity`, `health`, `review` — all route that outcome through
`describeScanFailure` (`packages/cli/src/utils/scan-failure.ts`) and respond by
disposition: `complexity` is gate-shaped and hard-errors; `health` and `review`
are advisory and say so at exit 0.

`lien delta` is the exception, and knowing why matters if you add a fifth
command: it never calls `performChunkOnlyIndex` at all, it calls `chunkFile`
per before/after content pair, and `computeComplexityDelta` returns no error
field. So it has no failure channel to route — not an oversight to copy, but
not coverage either.

**Total failure is only half of it.** `describeScanFailure` returns `undefined`
the moment anything parsed, so a run where most of the corpus failed looks
identical to a healthy one. `describePartialScan` is the other half, and it
exists because `lien review` on a large deletion diff reported "98 changed
file(s) … No candidates from any signal" while 88 of those files had failed
with ENOENT — 88 lines to stderr, and not a word in the caveats block the
reader is told to trust.

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

## Deterministic over inferred — the surviving design principle

The LLM review engine, its rule prompts and its offline calibration harness are
deleted. What outlived them is the principle that shrank them:

**If a check is really a deterministic diff/parse query wearing an
LLM-reasoning costume — "does this literal still appear unconditionally
elsewhere?", "did this PR add a variant to some but not all of a family's
switch statements?" — compute it, do not ask a model to grep-and-reason it.**

That is what `packages/parser/src/signals/` is: 14 modules, each answering one
structural question as a pure function over a diff plus parser output. No LLM,
no network, no index. `lien review` runs them; they are unit-testable at zero
marginal cost, which is why they survived the engine that commissioned them.

Two things measured along the way, worth not relearning:

- **Precision was never established for 13 of the 14.** Adversarial review
  judged 106 of their candidates across four real diffs and rated none
  actionable, which is why `lien review` runs only `comparison-change` by
  default and `--all-signals` prints a warning. A signal being deterministic
  makes it cheap and reproducible; it does not make it right.
- **A gate that over-fires gets trained out as noise** (#1014). `lien review`
  is advisory and has no `--fail-on` for exactly that reason. `lien delta` is
  the gate, and it fires only on a threshold a function was under before.

When adding a signal: make it deterministic, unit-test it in
`packages/parser/src/signals/` beside the module, and default it OFF until its
precision is measured on real diffs rather than assumed.

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
node .github/scripts/docs-truth.mjs   # Docs name only things that exist
```

**No exceptions.** This prevents broken builds. All seven gates are
CI-backstopped on every PR: gates 1–5 in `.github/workflows/ci.yml`, gate 6
(`lien delta`) as its own job there comparing the working tree against the
PR's base branch (`lien delta --base`, not against `HEAD`), and gate 7 in
`.github/workflows/docs-truth.yml`. Don't skip them locally just because CI
would catch it anyway.

**`docs-truth`** is the seventh gate: a zero-dependency lint over tracked
markdown for broken relative links, `ADR-XXXX` references with no matching
decision file, and `npm run <script>` mentions that don't resolve. It is the
one gate that catches prose going stale — it will not, however, catch prose
that describes a deleted thing without naming a command, so deletions still
need a manual sweep for what the thing was *for*.

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
