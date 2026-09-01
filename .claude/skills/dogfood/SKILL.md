---
name: dogfood
description: Build Lien, then run a 7-agent team in parallel to test the CLI commands, review docs, audit code quality, evaluate architecture, review tests, audit security, and assess DX.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(npm run build), Bash(npm run typecheck), Bash(npm test), Bash(npm audit *), Bash(node *), Bash(mktemp *), Read, Glob, Grep, Write, Edit, Agent, TaskCreate, TaskUpdate, TaskList, TaskGet
---

# Lien Dogfooding Session

You are running a full dogfooding session for Lien. This session spawns **seven agents** to run seven review workstreams **in parallel**.

## Phase 1: Build & Verify

1. Run `npm run typecheck` — must pass with 0 errors
2. Run `npm run build` — must compile successfully

If either fails, stop and report the errors. Do NOT proceed.

Lien has no server and no persisted index — there is nothing to restart between the build and the next phase. Every command below parses the working tree fresh, on the spot, reading whatever the build just produced. Every invocation in this skill runs the freshly built dist directly:

```
node packages/cli/dist/index.js <command> [options]
```

Never `npx lien` — that resolves whatever `@liendev/lien` is currently published on npm, not the code you just built in Phase 1.

## Phase 2: Spawn Seven Agents in Parallel

| # | Agent | Report File |
|---|------------|-------------|
| 1 | `cli-tester` | `.wip/dogfood-cli-report.md` |
| 2 | `docs-reviewer` | `.wip/dogfood-docs-report.md` |
| 3 | `code-quality` | `.wip/dogfood-quality-report.md` |
| 4 | `architect` | `.wip/dogfood-architecture-report.md` |
| 5 | `test-reviewer` | `.wip/dogfood-tests-report.md` |
| 6 | `security-auditor` | `.wip/dogfood-security-report.md` |
| 7 | `dx-reviewer` | `.wip/dogfood-dx-report.md` |

Create one task per agent with `TaskCreate`, then spawn all seven with the `Agent` tool **in a single message** (parallel Agent calls), each prompted with its full plan from the corresponding section below. Mark each task `in_progress` via `TaskUpdate` as its agent starts.

## Phase 3: Wait & Collect Results

Wait for all seven agents to return. Once all are done:

1. Mark each task `completed` via `TaskUpdate`
2. Read all seven report files
3. Produce the combined summary report (see "Combined Report" section)
4. Save it to `.wip/dogfood-report.md`

---

## CLI Tool Testing Plan

> Give this entire section to the `cli-tester` agent.

Lien's entire surface is four commands — `complexity`, `health`, `review`, `delta`. There is no server, no index, and no search: every command parses the working tree on demand. Test each command against the Lien codebase itself, invoking the build from Phase 1 directly (`node packages/cli/dist/index.js <command>`, run from the repo root) — never `npx lien`, which would run whatever is published on npm instead of this build.

For every command, also run **at least one hostile case**: invoke it from a directory that is not a git repository and has no source files (`mktemp -d`, then run the command against that path). Honest empty-state behavior is a MANDATORY project requirement (CLAUDE.md, "Index-State Honesty") — a command must never render "found nothing" as "clean."

### complexity

- `node packages/cli/dist/index.js complexity` — whole-repo scan (baseline on this repo: ~600 files, ~2s, dozens of pre-existing threshold violations — that's expected, not a regression)
- `node packages/cli/dist/index.js complexity --files <one real file>` — scoped to a single file
- `node packages/cli/dist/index.js complexity --format json` and `--format sarif` — verify both parse as valid JSON / SARIF 2.1.0
- `node packages/cli/dist/index.js complexity --fail-on error` and `--fail-on warning` — verify the exit code actually changes when violations of that severity exist, and is 0 on a file with none
- **Hostile case:** run it against an empty non-git directory — expect `Error: cannot analyze complexity — No files found to index` and a non-zero exit, never "0 violations, clean"

**Check:** violations point at real files/lines; JSON and SARIF are well-formed; `--fail-on` changes the exit code; the hostile case hard-errors instead of reporting false-clean.

### health

- `node packages/cli/dist/index.js health --top 5` — default ranking
- `node packages/cli/dist/index.js health --top 5 --path <a real subpackage path>` — scoped ranking
- `node packages/cli/dist/index.js health --top 5 --include-tests` — include test files in the ranking
- `node packages/cli/dist/index.js health --format json --top 5` — verify the JSON (`entries`, `score`, `shape`, `coverage`) matches the text output
- **Hostile case:** run it against an empty non-git directory — expect "No health data — No files found to index" with an explicit "This is NOT a clean bill of health" warning (exit 0 is correct here — `health` is advisory, never gate-shaped)

**Check:** ranked functions are genuinely complex and under-tested (spot-check by reading a couple); `--path` actually scopes the ranking; the hostile case is loud about having no data rather than silent.

### review

- `node packages/cli/dist/index.js review` — against HEAD (expect "nothing reviewable" on a clean working tree, or real candidates if there's a pending diff)
- `node packages/cli/dist/index.js review --base <an older ref, e.g. HEAD~5>` — compare against a different ref
- `node packages/cli/dist/index.js review --format json` — verify the JSON structure (`changedFiles`, `withheldSignals`, `scanFailure`, candidates)
- `node packages/cli/dist/index.js review --no-repo-scan` — verify it explicitly names the cross-file signals it skipped rather than silently running fewer
- **Hostile case:** run it against a non-git directory — expect `lien review could not run: ... fatal: not a git repository` and a non-zero exit, never a false-clean report

**Check:** the report is explicit about what it did NOT examine (unsupported files, withheld signals) rather than omitting it silently; candidates (when present) point at real diff hunks; the hostile case surfaces the git error.

### delta

- `node packages/cli/dist/index.js delta` — against HEAD (expect "no complexity-affecting changes" on a clean working tree)
- `node packages/cli/dist/index.js delta --file <one real file>` — single-file fast path
- `node packages/cli/dist/index.js delta --soft` — verify it always exits 0, report content otherwise unchanged
- `node packages/cli/dist/index.js delta --base <a real ref, e.g. origin/main>` — verify cross-ref comparison
- **Hostile case:** run it against a non-git directory — expect `lien delta: not a git repository (or git is not installed)` and a non-zero exit. Unlike `health`/`review`, this one is gate-shaped: silently passing here would be worse than erroring, since CI depends on the exit code.

**Check:** delta reports only NEW threshold crossings, not pre-existing ones (make a small, harmless edit that doesn't cross a threshold, confirm delta stays quiet, then discard the edit); `--soft` changes only the exit code, never the report; the hostile case hard-errors.

### Output

Write a detailed report to `.wip/dogfood-cli-report.md` with:

| Command | Status | Notes |
|---------|--------|-------|
| complexity | pass/warn/fail | ... |
| health | pass/warn/fail | ... |
| review | pass/warn/fail | ... |
| delta | pass/warn/fail | ... |

Include for each command:
- Invocations run and output observed, against this repo AND the hostile non-git case
- Any errors or unexpected behavior
- Whether index-state honesty holds — does it ever present "found nothing" as "clean"? This is a hard project requirement, not a style preference
- Performance notes (anything noticeably slow on this repo's ~600 files)
- Suggestions for improvement

---

## Documentation Review Plan

> Give this entire section to the `docs-reviewer` agent.

Audit all user-facing documentation for accuracy, completeness, and consistency with the actual codebase. The goal is to catch stale docs, missing features, wrong examples, and broken references.

**Context:** Lien recently removed its MCP server, persisted SQLite index, and FTS5 lexical search entirely — along with `lien serve`, `lien index`, `lien status`, and the `search_code` / `list_functions` / `get_files_context` / `get_dependents` / `find_similar` / `get_complexity` MCP tools. It is now a pure on-demand parser with four commands (`complexity`, `health`, `review`, `delta`). Treat any doc that still describes a server, an index, MCP tools, or those three deleted commands as current instructions as a bug — flag it wherever you find it, not only in the files listed below.

### What to review

**Site documentation** (`packages/site/docs/`):
- `index.md` — Landing page claims and feature list
- `how-it-works.md` — Technical overview accuracy
- `guide/getting-started.md` — Setup instructions correctness
- `guide/installation.md` — Installation steps
- `guide/cli-commands.md` — CLI command docs vs the actual four commands
- `guide/configuration.md` — Config options vs actual config schema

**Architecture docs** (`docs/architecture/`):
- `system-overview.md` — Does it reflect the current on-demand-parse architecture?
- `data-flow.md` — Is the data flow diagram still accurate now that there's no index to write to?
- `config-system.md` — Does it match actual config handling?
- `test-association.md` — Does it match test detection logic?
- `lien-delta.md` — Does it match the `delta` command as built?
- `native-parser.md` — Parser architecture accuracy
- ADRs in `decisions/` — Are they still accurate? Is the MCP/index removal itself documented anywhere, or missing an ADR?

**Root docs**:
- `README.md` — Feature list, quick start, examples

Before trusting this list, `Glob` `packages/site/docs/**/*.md` and `docs/architecture/**/*.md` — files get added and removed, and a hardcoded list here can go just as stale as the one this skill is being fixed for.

### How to review

For each document:

1. **Read the doc** to understand what it claims
2. **Verify against code** — use `Grep`, `Glob`, and `Read` to check:
   - Do referenced files/paths still exist?
   - Do code examples match actual CLI flags? Verify against `node packages/cli/dist/index.js <command> --help`, not memory
   - Are feature descriptions accurate?
   - Are CLI command options correct?
3. **Cross-reference** — check that docs are consistent with each other (e.g., README features match the site landing page)
4. **Check for gaps** — are there features in the code not documented? Recently added capabilities missing from docs?

### What to flag

For each issue found, categorize it:

- **Stale**: Information that was correct but is now outdated (e.g., renamed option, removed feature)
- **Incorrect**: Information that is factually wrong (e.g., wrong parameter name, wrong default value)
- **Missing**: Feature or capability that exists but is not documented
- **Inconsistent**: Same thing described differently in multiple places
- **Broken**: Dead links, references to non-existent files or sections

### Output

Write a detailed report to `.wip/dogfood-docs-report.md` with:

**Summary table:**

| Document | Status | Issues Found |
|----------|--------|--------------|
| `packages/site/docs/guide/cli-commands.md` | pass/warn/fail | ... |
| `README.md` | pass/warn/fail | ... |
| ... | ... | ... |

**Detailed findings** for each document with issues, including:
- The specific claim or section that is wrong
- What the code actually does (with file/line references)
- Suggested fix

---

## Code Quality Review Plan

> Give this entire section to the `code-quality` agent.

You are a **senior JavaScript/TypeScript developer** performing a code quality audit of the Lien codebase. Your goal is to find concrete, actionable issues — not nitpicks. Focus on things that cause bugs, hurt maintainability, or confuse contributors.

### Scope

Review the source code across the three published packages:
- `packages/parser/src/` — AST parsing, chunking, complexity metrics, dependency/test-association analysis, deterministic review signals, ecosystem detection
- `packages/core/src/` — config management, git state tracking, complexity-report formatters. (There is no structural store or indexer here any more — both were removed along with the index.)
- `packages/cli/src/` — the four CLI commands and their shared utilities

Use `Glob`/`Grep` to enumerate what's actually in each `src/` tree before reviewing — don't assume the list above is exhaustive; it will drift over time.

### What to look for

**Error handling & edge cases:**
- Unhandled promise rejections or missing `try/catch` on async operations
- Swallowed errors (empty `catch` blocks, `catch` that logs but doesn't rethrow when it should)
- Missing validation at system boundaries (CLI args, file I/O)
- Race conditions in concurrent operations

**TypeScript usage:**
- Overuse of `any` or `as` type assertions that bypass safety
- Missing or overly loose types where stricter types would prevent bugs
- Inconsistent use of `null` vs `undefined`

**Code smells:**
- Functions that are too long or do too many things — run `node packages/cli/dist/index.js complexity --format json` and `node packages/cli/dist/index.js health --top 20 --format json` to find hotspots (raw complexity, and complexity × fan-in ÷ test coverage)
- God objects or modules with too many responsibilities
- Dead code, unused imports, or commented-out code
- Copy-pasted logic that should be shared — there is no similarity-search tool any more, so check by reading and by `Grep`ping for distinctive literals/identifiers repeated across files

**Patterns & consistency:**
- Inconsistent error handling patterns across modules
- Inconsistent naming conventions
- Inconsistent import styles or module organization
- Missing or misleading JSDoc on public APIs

**Dependencies & external calls:**
- Unsafe file system operations (missing existence checks, TOCTOU issues)
- Unvalidated external input (CLI args, config files)
- Resource leaks (unclosed file handles)

### How to review

1. Start with `node packages/cli/dist/index.js health --top 20 --format json` to identify the riskiest functions (complexity × fan-in ÷ test coverage) — these are where bugs hide
2. `Glob` `packages/{parser,core,cli}/src/**/*.ts` for an overview of the codebase structure; `Grep` for `^export class`, `^export function`, `^export interface` to enumerate symbols by kind
3. Read the highest-complexity files and the core modules (CLI command handlers, config service, git tracker)
4. Check for duplicated patterns by reading and by `Grep`ping for repeated literals/snippets — there is no automated similarity search any more
5. `Grep` for imports of a target file (`from '.*<module-name>'`) to see who depends on it — there is no dependents-lookup command any more
6. Spot-check error handling in I/O-heavy code (file scanning, chunking, git diffing)

### What NOT to flag

- Style preferences (formatting, trailing commas, etc.) — Prettier handles this
- Missing comments on obvious code
- Test code quality (the `test-reviewer` agent handles that)
- Performance issues without evidence (that's the architect's job)
- Security issues (the `security-auditor` agent handles that)

### Output

Write a detailed report to `.wip/dogfood-quality-report.md` with:

**Summary:**

| Area | Rating | Issue Count |
|------|--------|-------------|
| Error handling | good/fair/poor | N |
| TypeScript usage | good/fair/poor | N |
| Code smells | good/fair/poor | N |
| Patterns & consistency | good/fair/poor | N |
| Dependencies & I/O safety | good/fair/poor | N |

**Top issues** (max 15, ordered by severity):

For each issue:
- **File:line** — exact location
- **Severity** — critical / high / medium / low
- **Category** — which area above
- **Description** — what's wrong and why it matters
- **Suggestion** — concrete fix (not just "refactor this")

**Positive observations** — things the codebase does well that should be preserved.

---

## Architecture Review Plan

> Give this entire section to the `architect` agent.

You are a **senior software architect** evaluating the overall architecture of Lien. Your goal is to assess whether the system is well-structured for its current scope and near-term evolution. Focus on structural decisions, not line-level code quality.

### Context

Lien is a local-first code-health CLI: no server, no persisted index, no search. Every command parses the working tree on demand. It's split into three published packages plus three unpublished ones:
- `@liendev/parser` — AST parsing, language definitions, chunking, complexity analysis, dependency/test-association resolution, deterministic review signals. Zero deps on core.
- `@liendev/core` — config management (`ConfigService`), git state tracking, complexity-report formatters (text/JSON/SARIF)
- `@liendev/lien` (cli) — the four commands: `complexity`, `health`, `review`, `delta`
- `review` / `action` / `site` (private, unpublished) — the Lien Review GitHub Action's engine, the Action wrapper, and the docs site

Dependency chain: `parser` ← `core` ← `cli`. `review` depends on `parser` only. This is a **recent, large architectural change**: the MCP server, the SQLite structural store, the indexer, and FTS5 lexical search were all removed from `core`. Verify with `Glob`/`Grep` that no residue (dead imports, orphaned types, stale barrel exports referencing removed modules) was left behind.

### What to evaluate

**Package boundaries & responsibilities:**
- Is the `parser` / `core` / `cli` split clean now that `core` has lost its structural-store responsibilities? Does `core` still earn its place as a separate package, or is it thin enough now that some of it belongs in `cli`?
- Are there things in `cli` that belong in `core` (or vice versa)?
- `Grep` for import statements referencing a target module to trace dependency flow — `parser` should not depend on `core`; `core` should not depend on `cli`

**Module cohesion & coupling:**
- Do modules have clear, single responsibilities?
- Are there circular dependencies or overly tight coupling?
- `Grep` for imports of high-fan-out files to identify coupling hotspots
- Check barrel files (`index.ts`) — are they re-exporting cleanly, and do they still make sense post-removal (any export of a type/class that no longer exists, or that only ever served the deleted index)?

**Extensibility & plugin points:**
- Is the language system (AST languages) properly extensible? Review the registry pattern in `packages/parser/src/ast/languages/`
- Is the deterministic-signals system (`packages/parser/src/signals/`) easy to extend with a new signal?

**Data flow & pipeline design:**
- Trace each command's pipeline end-to-end: file discovery -> AST parsing -> the command's specific analysis (complexity scoring / health ranking / diff signals / delta comparison)
- Is the pipeline clear, or are there hidden side effects or implicit ordering?
- How do `review`/`delta` diff against git? Is that logic isolated cleanly, or duplicated across commands?

**Error resilience & failure modes:**
- What happens when parsing fails mid-way through a scan?
- How does the system handle a codebase too large for memory, given every run re-parses from scratch?
- Are there graceful degradation paths? Does CLAUDE.md's "Index-State Honesty" policy actually hold in the code, not just in the docs?

**Scalability concerns:**
- Since there's no persisted index any more, every invocation re-parses the whole (or a relevant slice of the) working tree. What's the per-invocation cost, and does it scale acceptably with repo size? (`node packages/cli/dist/index.js health` on this repo takes ~1.5s for ~600 files / ~8,600 chunks — is that representative, and does it hold up on a much larger repo?)
- Are there O(n^2) operations hiding anywhere?

### How to review

1. Read `CLAUDE.md` and `docs/architecture/` for the intended architecture — but verify against `Glob`/`Grep`/`Read`, since those docs may themselves be lagging the recent removal (that's exactly what the `docs-reviewer` agent is checking in parallel; cross-reference its findings in your report)
2. `Glob` each package's `src/` tree to map real structure
3. `Grep` for `^export class`, `^export interface` to map out the type system
4. `Grep` for imports of core modules to trace dependency flow
5. Read the entry points: `packages/cli/src/index.ts`, `packages/cli/src/cli/index.ts`, and each command's implementation
6. Run `node packages/cli/dist/index.js complexity --format json` and `health --format json` to identify structural complexity hotspots

### Output

Write a detailed report to `.wip/dogfood-architecture-report.md` with:

**Architecture Scorecard:**

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Package boundaries | good/fair/poor | ... |
| Module cohesion | good/fair/poor | ... |
| Coupling | good/fair/poor | ... |
| Extensibility | good/fair/poor | ... |
| Data flow clarity | good/fair/poor | ... |
| Error resilience | good/fair/poor | ... |
| Scalability readiness | good/fair/poor | ... |

**Key findings** (max 10, ordered by architectural impact):

For each finding:
- **Area** — which dimension above
- **Impact** — high / medium / low
- **Description** — what the issue or observation is
- **Evidence** — specific files or complexity data that support the finding
- **Recommendation** — what to do about it (with effort estimate: small/medium/large)

**Architecture strengths** — what's working well and should be preserved.

**Strategic recommendations** — 2-3 high-level suggestions for the next phase of evolution.

---

## Test Suite Review Plan

> Give this entire section to the `test-reviewer` agent.

You are a **senior QA engineer** auditing the test suite of the Lien codebase. Your goal is to assess test coverage, test quality, and identify gaps that leave critical code paths untested. You are NOT running tests — you are reviewing the test code itself.

### Scope

Review all test files across the three published packages:
- `packages/parser/src/**/*.test.ts`
- `packages/core/src/**/*.test.ts`
- `packages/cli/src/**/*.test.ts`

### What to evaluate

**Coverage gaps:**
- There is no test-associations lookup tool any more. Approximate coverage two ways: (1) run `node packages/cli/dist/index.js health --top 30 --format json` and look at which ranked (risky) functions have an empty `tests` array; (2) `Glob` for a source file's likely co-located test file (`foo.ts` -> `foo.test.ts`) and flag source files with none
- Systematically check: for each major source directory, are there corresponding test files? Focus on: `packages/cli/src/cli/`, `packages/core/src/config/`, `packages/core/src/git/`, `packages/parser/src/ast/`, `packages/parser/src/signals/`

**Test quality:**
- Are tests testing behavior or implementation details? (behavior is better)
- Are there tests too tightly coupled to internal implementation (will break on refactor)?
- Are edge cases covered? (empty inputs, null values, error paths, boundary conditions)
- Are async operations properly awaited in tests?
- Are there tests that always pass regardless of the code (vacuous tests)?

**Test isolation:**
- Do tests depend on external state (file system, network, running services)?
- Are there tests that depend on execution order?
- Are mocks/stubs properly scoped and cleaned up?
- Could tests interfere with each other when run in parallel?

**Test organization:**
- Is the naming convention consistent? (describe/it blocks, test file naming)
- Are test files co-located with source or in separate directories? Is this consistent?
- Are test utilities and fixtures well-organized?
- Are there shared test helpers that could reduce duplication?

**Missing test categories:**
- Unit tests for pure functions and utilities
- Integration tests for each CLI command's end-to-end pipeline (parse -> analyze -> format)
- Tests for error handling paths — especially the hostile/no-data cases (CLAUDE.md's "Index-State Honesty" policy; see `packages/cli/src/utils/scan-failure.ts` and its test)
- Tests for edge cases in AST language parsers

### How to review

1. `Glob` for all test files: `**/*.test.ts`
2. Cross-reference `node packages/cli/dist/index.js health --format json` for ranked functions with no detected tests, and `Glob` for missing co-located test files elsewhere
3. Read test files for the most critical modules (CLI command handlers, config service, signals)
4. `Grep` for `beforeEach`, `afterEach`, `vi.mock` to find test utilities and mock patterns
5. If reviewing signal tests, note that `signals-test-location.test.ts` enforces that every signal module has a test file; they are co-located in `packages/parser/src/signals/`

### Output

Write a detailed report to `.wip/dogfood-tests-report.md` with:

**Coverage Summary:**

| Module | Source Files | Test Files | Coverage Gap |
|--------|-------------|------------|--------------|
| `cli/cli/` | N | N | list untested files |
| `core/config/` | N | N | ... |
| `core/git/` | N | N | ... |
| `parser/ast/` | N | N | ... |
| `parser/signals/` | N | N | ... |
| ... | ... | ... | ... |

**Test Quality Assessment:**

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Behavior vs implementation testing | good/fair/poor | ... |
| Edge case coverage | good/fair/poor | ... |
| Test isolation | good/fair/poor | ... |
| Organization & naming | good/fair/poor | ... |
| Error path coverage | good/fair/poor | ... |

**Top issues** (max 10, ordered by risk):

For each issue:
- **Location** — test file or untested source file
- **Risk** — critical / high / medium / low
- **Category** — coverage gap / quality / isolation / organization
- **Description** — what's missing or wrong
- **Suggestion** — what test to add or how to fix

**Positive observations** — things the test suite does well.

---

## Security Audit Plan

> Give this entire section to the `security-auditor` agent.

You are a **security engineer** auditing the Lien codebase for vulnerabilities. Lien is a local CLI — no server, no network listener, no persisted index — but it still reads arbitrary file paths and file content from the user's codebase, runs regex against user-supplied patterns, and (for `review`/`delta`) shells out to `git`. Your goal is to find concrete security issues, not theoretical concerns.

### Attack surface

Lien's attack surface includes:
- **CLI arguments** — `--files`, `--path`, `--file`, `--base`, `--threshold` are user-supplied paths/refs/numbers passed into the analysis pipeline
- **File system access** — Lien reads files from the user's codebase during every scan. Malicious file content (crafted source files) could exploit the parser
- **Git subprocess calls** — `review` and `delta` shell out to `git` (e.g. `git ls-files`, `git diff`) with a user-supplied `--base <ref>`. Can a crafted ref or filename inject an argument into the call?
- **Dependencies** — third-party npm packages (tree-sitter grammars, etc.)
- **Config files** — the project config file is read and parsed. Can a malicious config cause harm?

### What to check

**Path traversal & file access:**
- Can `--files`, `--path`, or `--file` escape the project root? (`../../etc/passwd`, absolute paths, symlinks)
- `Grep` for `path.join`, `path.resolve`, `path.normalize` and check whether results are validated against the project root
- Check if symlinks are followed during a scan (could pull in files outside the project)

**Input validation on CLI arguments:**
- Are CLI options validated before use? (types, lengths, allowed characters)
- Can a crafted `--base <ref>` inject a git argument (e.g. a ref starting with `-`) into the `git` subprocess call? `Grep` for how `--base` / `git diff` / `git ls-files` are invoked — confirm whether it's an array-args API (`execFile`/`spawn` with an argv array, which is not shell-interpolated) or string interpolation into a shell, and flag the latter
- What happens with extreme inputs (a huge `--top`, a very large repo)? (memory exhaustion)

**Dependency vulnerabilities:**
- Run `npm audit --json` and analyze the full output: severity counts, affected packages, fix availability
- Run `npm audit` (human-readable) to capture the summary for the report
- Check tree-sitter grammar packages — are they loaded from trusted sources?
- Check if any dependencies execute shell commands or download code at install time
- Review `package.json` / `package-lock.json` for pinned vs range versions on security-sensitive deps

**Information disclosure:**
- Do error messages leak more than necessary for a local CLI (full file paths, stack traces, system info)?
- Are there debug/verbose modes that expose too much?

**Config & file parsing:**
- Is the project config parsed safely? (prototype pollution via JSON, unsafe defaults)
- Are `.gitignore` and glob patterns handled safely?

### How to review

1. Read each command's entry point (`packages/cli/src/cli/complexity.ts`, `health-cmd.ts`, `review-cmd.ts`, `delta-cmd.ts`) and trace CLI-argument handling through to disk/git access
2. `Grep` for security-relevant patterns: `path.join`, `path.resolve`, `fs.readFile`, `new RegExp`, `eval`, `exec(`, `execFile(`, `spawn(`
3. `Grep` for how `git` is invoked and confirm it's argv-array based, not shell string interpolation, especially anywhere a user-supplied ref or path reaches it
4. `Grep` for input validation patterns: `zod`, `validate`, `sanitize`
5. Run `npm audit` and `npm audit --json` to check dependency vulnerabilities — include the full severity breakdown in the report

### Output

Write a detailed report to `.wip/dogfood-security-report.md` with:

**Threat Summary:**

| Attack Vector | Risk Level | Status |
|---------------|------------|--------|
| Path traversal via CLI arguments | critical/high/medium/low/none | mitigated/partial/unmitigated |
| Git subprocess argument injection | ... | ... |
| CLI input validation | ... | ... |
| Dependency vulnerabilities | ... | ... |
| Information disclosure | ... | ... |
| Config/file parsing | ... | ... |

**npm audit Results:**

| Severity | Count | Fixable |
|----------|-------|---------|
| critical | N | N |
| high | N | N |
| moderate | N | N |
| low | N | N |

List any notable vulnerable packages with their CVEs and whether fixes are available.

**Findings** (ordered by severity):

For each finding:
- **Severity** — critical / high / medium / low / informational
- **Vector** — which attack surface
- **Location** — file:line
- **Description** — what the vulnerability is
- **Exploit scenario** — how it could be exploited (be specific)
- **Recommendation** — concrete fix

**Positive security practices** — things the codebase does well (input validation, safe defaults, etc.)

---

## Developer Experience Review Plan

> Give this entire section to the `dx-reviewer` agent.

You are a **developer advocate** evaluating the developer experience of Lien from the perspective of a first-time user AND a returning user. Your goal is to assess whether the CLI is ergonomic, error messages are helpful, and command output — both human-readable text and `--format json` — is well-structured for a human reading a terminal and for an AI assistant consuming it programmatically.

### What to evaluate

**CLI ergonomics:**
- Run `node packages/cli/dist/index.js --help` — are the four commands discoverable? Is the help text clear?
- Run `node packages/cli/dist/index.js <command> --help` for each of `complexity`, `health`, `review`, `delta` — are options well-described?
- What happens when you run the CLI with no arguments?
- What happens with invalid commands or options (e.g. an unknown flag, `--format xml`)?

**Error messages & feedback:**
- Run `health`/`complexity`/`review`/`delta` from an empty non-git directory (same hostile case the `cli-tester` agent runs) — is the error message helpful? Does it tell you what to do?
- Run `complexity`/`health` over this repo and observe the output — is the summary clear?
- `Grep` for `console.error`, `throw new Error` and evaluate the messages
- Are errors actionable? (Do they say what went wrong AND how to fix it?)
- Are there silent failures? (operations that fail without any user-facing message)

**Output quality for downstream consumption:**
- Read each command's `--format json` output and evaluate: is the schema consistent in shape across commands (similar field naming for similar concepts)? Are field names self-explanatory without reading the source?
- Is the human-readable text output well-formatted (colors, structure) without being noisy?
- Is machine-parseable output available consistently, or only on some commands? (`complexity` has `json`/`sarif`; check whether `health`/`review`/`delta` expose `--format json` too, and whether the docs describe that consistently)

**Onboarding flow:**
- Trace the real first-use experience per the README/getting-started docs: install -> `cd` into a project -> run a command directly. There is no server to start, no editor config to hand-edit, no index to build first — verify that claim is actually true by trying a command cold in a scratch directory rather than assuming the docs are right
- How long until a user gets value? Are there unnecessary steps?
- What are the failure modes during onboarding? (missing `git`, permission errors, running somewhere with no recognized source files)

**Output formatting:**
- Is CLI output well-formatted? (tables, colors, structure)
- Is the verbosity level appropriate? (not too noisy, not too silent)

### How to review

1. Run every command (and `--help` for each) and evaluate the output directly
2. Read the CLI command source files (`packages/cli/src/cli/*.ts`) to understand what output is produced and why
3. `Grep` for error message patterns: `console.error`, `console.warn`, `throw new Error`
4. Compare `--format json` output across all four commands for schema consistency
5. Try the cold-start onboarding flow yourself in a scratch directory

### What NOT to flag

- Visual design preferences (color choices, emoji usage) — subjective
- Performance of the CLI itself (the architect covers scalability)
- Bug reports (the `cli-tester` agent covers functional issues)

### Output

Write a detailed report to `.wip/dogfood-dx-report.md` with:

**DX Scorecard:**

| Dimension | Rating | Notes |
|-----------|--------|-------|
| CLI discoverability | good/fair/poor | ... |
| Error messages | good/fair/poor | ... |
| Output quality (text + JSON) | good/fair/poor | ... |
| Onboarding flow | good/fair/poor | ... |
| Output formatting | good/fair/poor | ... |

**Top friction points** (max 10, ordered by user impact):

For each issue:
- **Where** — CLI command, error scenario, or JSON output
- **Impact** — high / medium / low
- **Description** — what the friction is, from the user's perspective
- **Current behavior** — what happens now
- **Suggested improvement** — concrete change to improve the experience

**DX strengths** — things that feel polished and should be preserved.

**Quick wins** — 3-5 small changes that would noticeably improve the experience.

---

## Combined Report

After all seven agents finish, produce a unified report in `.wip/dogfood-report.md` with:

### CLI Commands Summary

| Command | Status | Notes |
|---------|--------|-------|
| complexity | pass/warn/fail | ... |
| health | pass/warn/fail | ... |
| review | pass/warn/fail | ... |
| delta | pass/warn/fail | ... |

### Documentation Summary

| Document | Status | Issues |
|----------|--------|--------|
| ... | ... | ... |

### Code Quality Summary

| Area | Rating | Issue Count |
|------|--------|-------------|
| ... | ... | ... |

### Architecture Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| ... | ... | ... |

### Test Suite Summary

| Module | Coverage Gap | Test Quality |
|--------|-------------|--------------|
| ... | ... | ... |

### Security Summary

| Attack Vector | Risk Level | Status |
|---------------|------------|--------|
| ... | ... | ... |

### Developer Experience Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| ... | ... | ... |

### Cross-Cutting Issues

Note anything that spans multiple workstreams:
- Features that work in the CLI but are missing from docs
- Docs describing behavior that doesn't match reality (especially leftover MCP/server/index language — see the docs-reviewer's context note)
- Code quality issues that reflect architectural problems
- Architecture decisions that cause code quality debt
- Untested code paths that are also security-sensitive
- Security issues that also affect developer experience (e.g., unhelpful error messages hiding real problems)
- DX friction caused by architectural limitations

### Action Items

Prioritized list of things to fix, ordered by impact:
1. **P0 — Security**: Vulnerabilities that need immediate attention
2. **P1 — Broken**: Things that are wrong and user-facing
3. **P2 — High impact**: Architectural, quality, or test gaps with significant consequences
4. **P3 — Stale/Missing**: Outdated docs or missing documentation
5. **P4 — Polish**: DX improvements, minor quality fixes, nice-to-haves

Save this to `.wip/dogfood-report.md`.
