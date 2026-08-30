# Index-State Honesty

The policy and detector behind #1029 Workstream 1: when Lien has no data, or
the wrong data, it must say so — never produce a confident answer that
happens to be indistinguishable from a real one.

## Why this exists

The #1017 sweep confirmed 28 defects. Roughly 11 of them were the same
disposition: a read-only command or MCP tool answered a question it had no
data to answer, and the answer came back looking exactly like a genuine
clean result.

- `lien complexity` on a never-indexed repo → `✓ No violations found!`, exit 0.
  (The original instance. That command now parses the working tree and has no
  index states at all — but it still hard-errors on an empty parse, because
  the shape of the bug never depended on the index. See the gate-shaped
  bullet below.)
- …on an indexed-but-empty store (same bug, one layer deeper) → the same
  false clean.
- `get_complexity({ files: [...] })` on an unindexed path → the path silently
  dropped, a whole-repo answer returned in its place.
- `lien annotate <nonexistent>` → nothing printed, exit 0.
- `lien status` → "Index files: 7" when 11 files are actually indexed.

Each individual case was a defensible *local* default — Zod strips unknown
keys by default, SQLite's `CREATE TABLE IF NOT EXISTS` materializes a store
where none existed, an empty scan formats as a valid, clean report — that
composed into a lie. Nothing in the codebase said otherwise, so the next
command added the same way would repeat it. This document is that "otherwise."

## The four states

A read-only, index-backed command or tool can find itself in one of four
states, classified by `packages/cli/src/utils/index-freshness.ts`'s
`classifyIndexState` (whole-index states) plus a per-path check
(`findUnindexedPaths`, `packages/cli/src/mcp/utils/unindexed-paths.ts`) for
the fourth:

| State | Meaning | Whole-index or per-path? |
|-------|---------|---------------------------|
| **S0** | No index directory exists at all — the project has never been indexed. | Whole-index |
| **S1** | The index directory exists, but the structural store has zero rows (cleared, moved aside, or indexed against an all-ignored tree). | Whole-index |
| **S2** | The store has real data, but it's stale vs. the working tree's current git HEAD. | Whole-index |
| **S3** | The index is fine, but the specific path the caller asked about isn't in it. | Per-path |

A fifth state exists in the codebase but is explicitly **out of scope** here:
the mechanism itself can be structurally blind to a real usage (Java/Kotlin
same-package access, Ruby class names referenced without an import, C#
`global using`, a type symbol referenced by constructor call rather than by
name). That is #1026's `attributionCaveat` vocabulary
(`AttributionCaveatReason` in `packages/cli/src/mcp/attribution-caveat-reasons.ts`)
— a different axis (import-graph visibility, not index freshness). Don't
build a competing vocabulary for it; if you find yourself wanting a state
that means "the analysis couldn't see it," that's `attributionCaveat`'s job.

## The policy

The bar is **never a confident answer when the honest answer is "I don't
know."** But "never silent" does not mean "always a hard process error" —
the right response depends on what kind of command this is:

- **Gate-shaped commands** (their whole purpose is a pass/fail verdict fed
  to CI or a commit hook): **S0/S1 is a hard error, non-zero exit.** A
  confident "0 violations" here is a false "safe to merge." **S2 is a loud
  warning, never silent** — print it and still run the analysis (don't block;
  the caller asked for an answer and staleness is a caveat on it, not a
  reason to refuse one).

  `lien complexity --fail-on` was the worked example here until it moved to
  parsing the working tree. It no longer has index states — but it is still
  gate-shaped, and still hard-errors when the parse yields nothing, via
  `describeScanFailure` (`packages/cli/src/utils/scan-failure.ts`). The
  disposition is the durable part; the index was only ever one way to lack
  data.
- **Advisory/nudge commands** (`lien annotate`, `lien api-delta` — see
  [Blast-Radius Nudge](./blast-radius-nudge.md)): these are explicitly
  designed to degrade rather than fail the process — shell hooks depend on
  their exit-code contract for unrelated signals (`lien annotate`'s exit 2
  is the habituation "never-suppress" signal, not a general error channel).
  For these, **S0/S1 must produce a loud, unmissable, un-suppressible
  warning or degraded-result marker** (`enriched: false`, never a bare
  `dependentCount: 0`) — but the process may still exit 0. Silence is the
  bug, not the exit code.
- **MCP tools**: same idea, translated to the protocol — **S0 is
  structurally impossible** (`lien serve` always initializes the structural
  store before registering tool handlers; see `mcp/server.ts`'s
  `startMCPServer` → `initializeComponents` → `setupAndConnectServer` →
  `registerMCPHandlers` ordering). **S1 and S3 must produce an explicit
  `note` (or, for `get_dependents`, `attributionCaveat`) — never a bare empty
  result indistinguishable from a real "not found."** Never `isError` for
  these — a healthy client should still be able to act (run `lien index` and
  retry), not have the whole call blow up. **S2 does not apply to MCP
  tools** — `lien serve`'s git-detection machinery (`git-detection.ts`)
  keeps the index reconciled continuously; staleness is a one-shot-CLI
  problem only.
- **`lien status`**: report the true state textually. Already correct
  (`✗ Not indexed` for S0; `✓ Exists` + a real, possibly-zero file count for
  S1; `⚠️ Git state changed` for S2) — the reference implementation the
  other commands' S2 warning text was factored out of
  (`getIndexStalenessWarning`).
- **Index-independent commands** (`lien path`, `lien delta`, `lien config
  get`): none of the above applies — they never call `createVectorDB` and
  must stay that way. This is enforced structurally, not just documented
  (see "The detector" below).
- **Writers** (`lien index`, `lien serve`): legitimately create the index.
  Unchanged by this policy.

**The one hard constraint that cuts across all of the above: never turn a
genuinely clean, freshly-indexed result into a false alarm.** A state check
that fires on real data because it merely *shares a shape* with S1/S3 (a
real 0-violations report; a real 0-results search) destroys the signal's
value — see #1014, where a false "not found in the index" caveat fired on
every worktree session and trained everyone to ignore it. Every check in
this codebase gates on the actual state (`hasData()`, `getIndexedFiles()`),
never on the shape of the result alone.

## The detector

`packages/cli/test/integration/index-state-matrix.test.ts` is the table
test: every read-only entry point in the surface below, crossed with every
state that applies to it, asserting the actual response against a real
`SqliteBackend` — no `createVectorDB` mocking, so a regression has to
actually reproduce rather than merely fail to satisfy a mock's expectation.

### The surface (as of #1029 W1)

Only five non-test files under `packages/cli/src` call `createVectorDB`:

| File | Role |
|------|------|
| `mcp/server.ts` | Writer (`lien serve`) — exempt |
| `cli/index-cmd.ts` | Writer (`lien index`) — exempt |
| `cli/complexity.ts` | Read-only, gate-shaped |
| `cli/annotate-cmd.ts` | Read-only, advisory |
| `cli/api-delta-cmd.ts` | Read-only, advisory |

Plus the six MCP tools dispatched through `mcp/handlers/index.ts`'s
`toolHandlers` registry: `search_code`, `find_similar`, `get_files_context`,
`list_functions`, `get_dependents`, `get_complexity`.

Plus three CLI commands that are read-only and index-**independent** —
`lien status` (has its own, already-correct index-state handling — not in
the `createVectorDB`-caller set because it reads the store's on-disk
presence/manifest directly, never opens the backend), `lien path`, `lien
delta`, `lien config get`.

### The completeness guard

The table above is only a detector as long as it can't silently go stale.
Rather than trust a hand-maintained list, the test derives the real surface
two ways and cross-checks both against the table:

1. **A source scan** for every non-test file under `packages/cli/src` that
   calls `createVectorDB(` (stripping comment-only lines first, so a doc
   comment that merely *mentions* the call isn't mistaken for a real call
   site). If a new file starts calling it — including one of the
   index-independent commands quietly growing an index dependency — the
   discovered set diverges from the known one and the guard fails until a
   human adds a table row (or a writer exemption).
2. **`Object.keys(toolHandlers)`** — the MCP server's own dispatch registry
   — cross-checked against the table's MCP rows the same way.

This is the mechanism that stops the table itself from becoming the next
"one decision, applied at fewer than N sites" — the exact pattern this
whole campaign exists to close.

## Adding a new read-only, index-backed command

1. Decide which disposition it is: gate-shaped, advisory, or an MCP tool.
2. Call `classifyIndexState` (whole-index) and/or `findUnindexedPaths`
   (per-path) — don't hand-roll the S0/S1/S2 ladder again.
3. Wire the response per the policy table above for that disposition.
4. Add the file to `index-state-matrix.test.ts`'s known-callers set (or
   `toolHandlers`, for an MCP tool) and add its row(s) to `TABLE`. The
   completeness guard will fail until you do — that's the point.
