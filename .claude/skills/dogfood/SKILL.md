---
name: dogfood
description: Build Lien, restart MCP, then use a 7-agent team to test tools, review docs, audit code quality, evaluate architecture, review tests, audit security, and assess DX — all in parallel.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(npm run build), Bash(npm run typecheck), Bash(npm test), Bash(npm audit *), Bash(npx lien *), Bash(kill *), Bash(lsof *), Bash(node *), mcp__lien__semantic_search, mcp__lien__list_functions, mcp__lien__get_complexity, mcp__lien__get_files_context, mcp__lien__get_dependents, mcp__lien__find_similar, Read, Glob, Grep, Write, Edit, Task, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# Lien Dogfooding Session (Team Edition)

You are running a full dogfooding session for Lien. This session uses a **7-agent team** to run seven review workstreams **in parallel**.

## Phase 1: Build & Verify

1. Run `npm run typecheck` — must pass with 0 errors
2. Run `npm run build` — must compile successfully

If either fails, stop and report the errors. Do NOT proceed.

## Phase 2: Restart MCP Server

The Lien MCP server needs to be restarted so it picks up the fresh build.

1. Find the running Lien MCP server process: `lsof -i :7133` or look for the `node` process running `dist/index.js serve`
2. Kill it if running: `kill <pid>`
3. Wait a moment, then tell the user: **"Please run `/mcp` and restart the `lien` server, then press Enter to continue."** Claude Code manages the MCP server lifecycle — you cannot reconnect it programmatically.

**IMPORTANT:** Wait for the user to confirm the MCP server is back before proceeding to Phase 3.

## Phase 3: Spawn Agent Team

Create a team called `dogfood` and spawn **seven agents in parallel**:

| # | Agent Name | Type | Report File |
|---|------------|------|-------------|
| 1 | `mcp-tester` | general-purpose | `.wip/dogfood-mcp-report.md` |
| 2 | `docs-reviewer` | general-purpose | `.wip/dogfood-docs-report.md` |
| 3 | `code-quality` | general-purpose | `.wip/dogfood-quality-report.md` |
| 4 | `architect` | general-purpose | `.wip/dogfood-architecture-report.md` |
| 5 | `test-reviewer` | general-purpose | `.wip/dogfood-tests-report.md` |
| 6 | `security-auditor` | general-purpose | `.wip/dogfood-security-report.md` |
| 7 | `dx-reviewer` | general-purpose | `.wip/dogfood-dx-report.md` |

Prompt each agent with its full plan from the corresponding section below. Create tasks for all seven agents using `TaskCreate`, spawn them with the `Task` tool using `team_name: "dogfood"`, and assign tasks via `TaskUpdate`.

## Phase 4: Wait & Collect Results

Wait for all seven agents to complete their tasks. Once all are done:

1. Read all seven report files
2. Produce the combined summary report (see "Combined Report" section)
3. Save it to `.wip/dogfood-report.md`
4. Shut down all agents and delete the team

---

## MCP Tool Testing Plan

> Give this entire section to the `mcp-tester` agent.

Test each of the 6 Lien MCP tools against the Lien codebase. For each tool, run meaningful queries, verify the results make sense, and note any issues.

### semantic_search

Run at least 3 queries with varying specificity:

- Broad: `semantic_search({ query: "How does the indexing pipeline work?" })`
- Specific: `semantic_search({ query: "Where are code chunks stored in the vector database?" })`
- Cross-cutting: `semantic_search({ query: "How does Lien detect test file associations?" })`

**Check:** Results should return relevant files with reasonable relevance scores. Flag if results seem off-topic or if relevance categories don't match expectations.

### list_functions

Run at least 3 pattern queries:

- `list_functions({ pattern: ".*Service.*" })`
- `list_functions({ pattern: ".*Handler.*" })`
- `list_functions({ symbolType: "class" })`
- `list_functions({ symbolType: "interface" })`

**Check:** Results should match the regex patterns. Verify a few results by reading the actual files to confirm they exist and are correctly categorized.

### get_files_context

Test with single and batch calls:

- Single: `get_files_context({ filepaths: "packages/cli/src/mcp/tools.ts" })`
- Batch: `get_files_context({ filepaths: ["packages/core/src/indexer/incremental.ts", "packages/core/src/vectordb/query.ts"] })`

**Check:** Verify `testAssociations` are returned and point to actual test files. Verify chunks contain meaningful code sections.

### get_dependents

Test impact analysis:

- `get_dependents({ filepath: "packages/core/src/vectordb/query.ts" })`
- `get_dependents({ filepath: "packages/core/src/indexer/incremental.ts" })`
- With symbol: `get_dependents({ filepath: "packages/core/src/vectordb/query.ts", symbol: "search" })`

**Check:** Dependents should be files that actually import the target. Verify a few by reading the import statements.

### get_complexity

Test complexity analysis:

- Top hotspots: `get_complexity({ top: 10 })`
- Specific files: `get_complexity({ files: ["packages/cli/src/mcp/tools.ts"] })`

**Check:** Results should include complexity metrics (cyclomatic, cognitive, halstead). Verify the most complex functions are genuinely complex by reading them.

### find_similar

Test code similarity:

- Pick a real code snippet from the codebase (read a file first) and search for similar patterns
- Example: find code similar to an import pattern, a function signature, or a common pattern in the codebase

**Check:** Results should return structurally similar code. Verify matches are genuine similarities, not false positives.

### Output

Write a detailed report to `.wip/dogfood-mcp-report.md` with:

| Tool | Status | Notes |
|------|--------|-------|
| semantic_search | pass/warn/fail | ... |
| list_functions | pass/warn/fail | ... |
| get_files_context | pass/warn/fail | ... |
| get_dependents | pass/warn/fail | ... |
| get_complexity | pass/warn/fail | ... |
| find_similar | pass/warn/fail | ... |

Include for each tool:
- Queries run and results observed
- Any errors or unexpected behavior
- Response quality observations (relevance, accuracy)
- Performance notes (any tool noticeably slow?)
- Suggestions for improvement

---

## Documentation Review Plan

> Give this entire section to the `docs-reviewer` agent.

Audit all user-facing documentation for accuracy, completeness, and consistency with the actual codebase. The goal is to catch stale docs, missing features, wrong examples, and broken references.

### What to review

**Site documentation** (`packages/site/docs/`):
- `index.md` — Landing page claims and feature list
- `how-it-works.md` — Technical overview accuracy
- `guide/getting-started.md` — Setup instructions correctness
- `guide/installation.md` — Installation steps
- `guide/cli-commands.md` — CLI command docs vs actual CLI
- `guide/configuration.md` — Config options vs actual config schema
- `guide/mcp-tools.md` — MCP tool docs vs actual tool parameters and responses

**Architecture docs** (`docs/architecture/`):
- `system-overview.md` — Does it reflect current architecture?
- `indexing-flow.md` — Does it match actual indexing code?
- `mcp-server-flow.md` — Does it match MCP server implementation?
- `data-flow.md` — Is the data flow diagram still accurate?
- `config-system.md` — Does it match actual config handling?
- `test-association.md` — Does it match test detection logic?
- ADRs in `decisions/` — Are they still accurate and none missing for recent changes?

**Root docs**:
- `README.md` — Feature list, quick start, examples

### How to review

For each document:

1. **Read the doc** to understand what it claims
2. **Verify against code** — use `semantic_search`, `list_functions`, `Grep`, and `Read` to check:
   - Do referenced files/paths still exist?
   - Do code examples match actual API signatures?
   - Are feature descriptions accurate?
   - Are CLI command options correct?
   - Do MCP tool parameter tables match the actual tool definitions?
3. **Cross-reference** — check that docs are consistent with each other (e.g., README features match site landing page)
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
| `packages/site/docs/guide/mcp-tools.md` | pass/warn/fail | ... |
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

Review the source code in both packages:
- `packages/core/src/` — AST parsing, indexing, vector DB, complexity analysis
- `packages/cli/src/` — CLI commands, MCP server, embeddings, config, git integration

### What to look for

**Error handling & edge cases:**
- Unhandled promise rejections or missing `try/catch` on async operations
- Swallowed errors (empty `catch` blocks, `catch` that logs but doesn't rethrow when it should)
- Missing validation at system boundaries (user input, file I/O, external data)
- Race conditions in concurrent operations

**TypeScript usage:**
- Overuse of `any` or `as` type assertions that bypass safety
- Missing or overly loose types where stricter types would prevent bugs
- Inconsistent use of `null` vs `undefined`

**Code smells:**
- Functions that are too long or do too many things (use `get_complexity({ top: 20 })` to find hotspots)
- God objects or modules with too many responsibilities
- Dead code, unused imports, or commented-out code
- Copy-pasted logic that should be shared (use `find_similar` to detect duplication)

**Patterns & consistency:**
- Inconsistent error handling patterns across modules
- Inconsistent naming conventions
- Inconsistent import styles or module organization
- Missing or misleading JSDoc on public APIs

**Dependencies & external calls:**
- Unsafe file system operations (missing existence checks, TOCTOU issues)
- Unvalidated external input (CLI args, config files, MCP requests)
- Resource leaks (unclosed file handles, database connections)

### How to review

1. Start with `get_complexity({ top: 20 })` to identify the most complex functions — these are where bugs hide
2. Use `list_functions({ symbolType: "class" })` and `list_functions({ symbolType: "function", limit: 100 })` to get an overview of the codebase structure
3. Read the highest-complexity files and the core modules (MCP handlers, indexer, vector DB)
4. Use `find_similar` to check for duplicated patterns
5. Use `get_dependents` on core files to understand which modules are most critical
6. Spot-check error handling in I/O-heavy code (file scanning, embedding generation, DB operations)

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

Lien is a local-first semantic code search tool with two packages:
- `@liendev/core` — AST parsing, language definitions, vector DB operations, complexity analysis
- `@liendev/lien` (cli) — CLI commands, MCP server, embeddings, config, indexing pipeline, git integration

It serves AI coding assistants (Cursor, Claude Code) via MCP.

### What to evaluate

**Package boundaries & responsibilities:**
- Is the `core` vs `cli` split clean? Are responsibilities correctly assigned?
- Are there things in `cli` that belong in `core` (or vice versa)?
- Would any additional package splits improve the architecture?
- Check `get_dependents` on key modules to see if dependency flow is healthy (core should not depend on cli)

**Module cohesion & coupling:**
- Do modules have clear, single responsibilities?
- Are there circular dependencies or overly tight coupling?
- Use `get_dependents` on high-fan-out files to identify coupling hotspots
- Check barrel files (`index.ts`) — are they re-exporting cleanly or masking poor boundaries?

**Extensibility & plugin points:**
- Is the language system (AST languages) properly extensible? Review the registry pattern
- Is the MCP tool system easy to extend with new tools?
- Is the vector DB layer properly abstracted (LanceDB vs Qdrant)?
- Are embedding models swappable?

**Data flow & pipeline design:**
- Trace the indexing pipeline end-to-end: file discovery -> AST parsing -> chunking -> embedding -> storage
- Is the pipeline clear, or are there hidden side effects or implicit ordering?
- How does incremental indexing work? Is it robust?
- How does the MCP server handle concurrent requests?

**Error resilience & failure modes:**
- What happens when indexing fails mid-way? Is there recovery?
- What happens when the vector DB is corrupted or missing?
- How does the system handle a codebase too large for memory?
- Are there graceful degradation paths?

**Scalability concerns:**
- What are the current bottlenecks? (Use `get_complexity` for computation hotspots)
- How does performance scale with codebase size? (file count, LOC, languages)
- Is the embedding pipeline the bottleneck, or is it the vector DB?
- Are there O(n^2) operations hiding anywhere?

### How to review

1. Read `CLAUDE.md` and `docs/architecture/` to understand the intended architecture
2. Use `semantic_search` to find key architectural components: indexing pipeline, MCP server, vector DB, config system
3. Use `list_functions({ symbolType: "class" })` and `list_functions({ symbolType: "interface" })` to map out the type system
4. Use `get_dependents` on core modules to trace dependency flow
5. Read the entry points: CLI commands, MCP server setup, indexer pipeline
6. Use `get_complexity({ top: 20 })` to identify structural complexity
7. Check the `languages/` directory for the extensibility pattern

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
- **Evidence** — specific files, dependency graphs, or complexity data that support the finding
- **Recommendation** — what to do about it (with effort estimate: small/medium/large)

**Architecture strengths** — what's working well and should be preserved.

**Strategic recommendations** — 2-3 high-level suggestions for the next phase of evolution.

---

## Test Suite Review Plan

> Give this entire section to the `test-reviewer` agent.

You are a **senior QA engineer** auditing the test suite of the Lien codebase. Your goal is to assess test coverage, test quality, and identify gaps that leave critical code paths untested. You are NOT running tests — you are reviewing the test code itself.

### Scope

Review all test files across both packages:
- `packages/core/src/**/*.test.ts`
- `packages/cli/src/**/*.test.ts`

### What to evaluate

**Coverage gaps:**
- Use `get_files_context` on key source files and check their `testAssociations`. Flag any source files with **zero test associations**, especially in critical modules (MCP handlers, indexer, vector DB, config)
- Systematically check: for each major source directory, are there corresponding test files?
- Focus on: `packages/cli/src/mcp/`, `packages/cli/src/indexer/`, `packages/cli/src/vectordb/`, `packages/cli/src/config/`, `packages/core/src/indexer/ast/`, `packages/core/src/vectordb/`

**Test quality:**
- Are tests testing behavior or implementation details? (behavior is better)
- Are there tests that are too tightly coupled to internal implementation (will break on refactor)?
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
- Integration tests for the indexing pipeline
- Tests for error handling paths (what happens when things fail?)
- Tests for MCP tool parameter validation
- Tests for edge cases in AST language parsers

### How to review

1. Use `Glob` to find all test files: `**/*.test.ts`, `**/*.spec.ts`
2. Use `get_files_context` on critical source files to check `testAssociations`
3. Read test files for the most critical modules (MCP handlers, indexer, vector DB)
4. Use `semantic_search({ query: "How are MCP tools tested?" })` to find test patterns
5. Use `find_similar` on a well-written test to see if the pattern is consistent
6. Check for test utilities: `Grep` for `beforeEach`, `afterEach`, `jest.mock`, `vi.mock` patterns

### Output

Write a detailed report to `.wip/dogfood-tests-report.md` with:

**Coverage Summary:**

| Module | Source Files | Test Files | Coverage Gap |
|--------|-------------|------------|--------------|
| `cli/mcp/` | N | N | list untested files |
| `cli/indexer/` | N | N | ... |
| `cli/vectordb/` | N | N | ... |
| `cli/config/` | N | N | ... |
| `core/indexer/ast/` | N | N | ... |
| `core/vectordb/` | N | N | ... |
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

You are a **security engineer** auditing the Lien codebase for vulnerabilities. Lien is a local tool, but it handles arbitrary file paths from MCP clients, reads user codebases, and runs a server on port 7133. Your goal is to find concrete security issues, not theoretical concerns.

### Attack surface

Lien's attack surface includes:
- **MCP tool inputs** — AI assistants send file paths, search queries, code snippets, and regex patterns. These are the primary untrusted input.
- **File system access** — Lien reads files from the user's codebase during indexing. Malicious file content (crafted source files) could exploit the parser.
- **Network** — The MCP server listens on port 7133. Who can connect? Is it localhost-only?
- **Dependencies** — Third-party npm packages (tree-sitter, LanceDB, transformers.js, etc.)
- **Config files** — `lien.config.json` is read and parsed. Can a malicious config cause harm?

### What to check

**Path traversal & file access:**
- Can MCP tool `filepath` parameters escape the project root? (e.g., `../../etc/passwd`, absolute paths, symlinks)
- Search for path handling: `Grep` for `path.join`, `path.resolve`, `path.normalize` and check if results are validated against the project root
- Check `get_files_context`, `get_dependents`, and `get_complexity` — do they validate that requested files are within the project?
- Check if symlinks are followed during indexing (could index files outside project)

**Input validation on MCP requests:**
- Are MCP tool parameters validated before use? (types, lengths, allowed characters)
- Can a malicious `query` string in `semantic_search` cause issues? (injection into vector DB queries)
- Can a malicious `pattern` in `list_functions` cause ReDoS (catastrophic regex backtracking)?
- Can a malicious `code` snippet in `find_similar` cause issues?
- What happens with extremely large inputs? (memory exhaustion)

**Network exposure:**
- Does the MCP server bind to `127.0.0.1` (localhost only) or `0.0.0.0` (all interfaces)?
- Is there any authentication on the MCP endpoint?
- Could a malicious website trigger requests to the local MCP server? (DNS rebinding, SSRF)

**Dependency vulnerabilities:**
- Run `npm audit --json` and analyze the full output: severity counts, affected packages, fix availability
- Run `npm audit` (human-readable) to capture the summary for the report
- Check tree-sitter WASM parsers — are they loaded from trusted sources?
- Check if any dependencies execute shell commands or download code at install time
- Review `package.json` and `package-lock.json` for pinned vs range versions on security-sensitive deps

**Information disclosure:**
- Do error messages leak sensitive information (full file paths, stack traces, system info)?
- Does the MCP server expose the index contents (could leak code to unauthorized clients)?
- Are there debug/verbose modes that expose too much?

**Config & file parsing:**
- Is `lien.config.json` parsing safe? (prototype pollution via JSON, unsafe defaults)
- Are `.gitignore` and glob patterns handled safely?

### How to review

1. Start with the MCP server entry point — find how requests are received and dispatched
2. Trace each MCP tool from input to output, checking for validation at each step
3. Use `semantic_search({ query: "How does Lien validate file paths?" })` to find path validation code
4. Use `Grep` for security-relevant patterns: `path.join`, `path.resolve`, `fs.readFile`, `new RegExp`, `eval`, `exec`, `spawn`
5. Use `Grep` for input validation patterns: `zod`, `validate`, `sanitize`, `allowlist`
6. Check the server binding: search for `listen`, `createServer`, `bind`, `0.0.0.0`, `127.0.0.1`
7. Run `npm audit` and `npm audit --json` to check dependency vulnerabilities — include the full severity breakdown in the report

### Output

Write a detailed report to `.wip/dogfood-security-report.md` with:

**Threat Summary:**

| Attack Vector | Risk Level | Status |
|---------------|------------|--------|
| Path traversal via MCP inputs | critical/high/medium/low/none | mitigated/partial/unmitigated |
| MCP input validation | ... | ... |
| Network exposure | ... | ... |
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

You are a **developer advocate** evaluating the developer experience of Lien from the perspective of a first-time user AND a returning user. Your goal is to assess whether the CLI is ergonomic, error messages are helpful, and the MCP tool responses are well-structured for AI consumption.

### What to evaluate

**CLI ergonomics:**
- Run `npx lien --help` and evaluate: are the commands discoverable? Is the help text clear?
- Run `npx lien init --help`, `npx lien index --help`, `npx lien serve --help`, `npx lien status --help` — are options well-described?
- Are command names intuitive? Would a first-time user know what to run?
- What happens when you run `npx lien` with no arguments?
- What happens with invalid commands or options?

**Error messages & feedback:**
- Run `npx lien status` when no index exists — is the error message helpful? Does it tell you what to do?
- Run `npx lien index` and observe the output — is progress clear? Does the user know what's happening?
- Check error messages in the source code: use `Grep` for `console.error`, `throw new Error`, and evaluate the messages
- Are errors actionable? (Do they tell the user what went wrong AND how to fix it?)
- Are there silent failures? (operations that fail without any user-facing message)

**MCP tool response quality:**
- Read the MCP tool handler source code and evaluate the response format
- Are responses concise enough for AI context windows? Or do they include unnecessary data?
- Is the response structure consistent across all 6 tools?
- Are field names self-explanatory? Would an AI assistant understand the response without docs?
- Is the `indexInfo` metadata useful or just noise?
- Are relevance categories helpful for AI assistants to filter results?

**Onboarding flow:**
- Trace the first-use experience: install -> init -> first MCP query
- How long until a user gets value? Are there unnecessary steps?
- What are the failure modes during onboarding? (missing dependencies, permission errors, etc.)
- Is the auto-index-on-first-use reliable?

**Output formatting:**
- Is CLI output well-formatted? (tables, colors, progress bars)
- Is the output parseable by scripts? (JSON output option?)
- Is the verbosity level appropriate? (not too noisy, not too silent)

### How to review

1. Run CLI commands and evaluate output: `npx lien --help`, `npx lien status`, `npx lien index --help`
2. Read the CLI command source files to understand what output is produced
3. Read MCP tool handlers to evaluate response format and structure
4. Use `Grep` for error message patterns: `console.error`, `console.warn`, `throw new Error`, `logger.error`
5. Use `semantic_search({ query: "How does Lien handle errors in CLI commands?" })` to find error handling patterns
6. Check for progress indicators: `Grep` for `spinner`, `progress`, `ora`, `chalk`
7. Compare output consistency across commands

### What NOT to flag

- Visual design preferences (color choices, emoji usage) — subjective
- Performance of the CLI itself (the architect covers scalability)
- Bug reports (the mcp-tester covers functional issues)

### Output

Write a detailed report to `.wip/dogfood-dx-report.md` with:

**DX Scorecard:**

| Dimension | Rating | Notes |
|-----------|--------|-------|
| CLI discoverability | good/fair/poor | ... |
| Error messages | good/fair/poor | ... |
| MCP response quality | good/fair/poor | ... |
| Onboarding flow | good/fair/poor | ... |
| Output formatting | good/fair/poor | ... |

**Top friction points** (max 10, ordered by user impact):

For each issue:
- **Where** — CLI command, error scenario, or MCP response
- **Impact** — high / medium / low
- **Description** — what the friction is, from the user's perspective
- **Current behavior** — what happens now
- **Suggested improvement** — concrete change to improve the experience

**DX strengths** — things that feel polished and should be preserved.

**Quick wins** — 3-5 small changes that would noticeably improve the experience.

---

## Combined Report

After all seven agents finish, produce a unified report in `.wip/dogfood-report.md` with:

### MCP Tools Summary

| Tool | Status | Notes |
|------|--------|-------|
| semantic_search | pass/warn/fail | ... |
| list_functions | pass/warn/fail | ... |
| get_files_context | pass/warn/fail | ... |
| get_dependents | pass/warn/fail | ... |
| get_complexity | pass/warn/fail | ... |
| find_similar | pass/warn/fail | ... |

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
- Features that work in tools but are missing from docs
- Docs describing behavior that doesn't match reality
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
