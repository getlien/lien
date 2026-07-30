---
'@liendev/core': patch
'@liendev/lien': patch
---

Concurrent MCP tool calls against a cold or rebuilding index could kill the
server connection outright, surfacing to the client as
`MCP error -32000: Connection closed` rather than a tool-level error. Observed
at roughly a 50% failure rate with four servers racing on one brand-new
`structural.db`.

Root cause: `openDatabase()` set the `busy_timeout` pragma *after*
`journal_mode`/`synchronous`. `busy_timeout` only governs pragmas issued after
it, so a process losing the create/open race hit an uncaught
`SQLITE_BUSY: database is locked` inside `initializeComponents()` and called
`process.exit(1)` — **before the MCP transport had connected**, which is why the
client lost the whole server instead of one call. At higher concurrency a second
error class appeared during WAL-mode conversion (`SQLITE_IOERR`/`SQLITE_CANTOPEN`)
that `busy_timeout`'s internal retry does not cover at all.

`busy_timeout` now goes first, and every cross-process-racy open is wrapped in
`withOpenRetry` — a jittered linear backoff (the jitter matters: without it,
processes that started racing together retry in lockstep and keep re-colliding).

**The retry budget is deliberately bounded by the plugin's hook timeout.** Three
hooks (`annotate-read`, `augment-explore-task`, `api-delta-write`) invoke CLI
commands that call `createVectorDB().initialize()`, and Claude Code kills a hook
at 5000 ms with an unmaskable SIGKILL. A ladder that outlived that would leave the
stale in-flight marker that the npx circuit breaker reads as an unreachable
registry, silencing every nudge for its 300-second cooldown. The budget is
therefore 16 attempts × 25 ms — a computed 3904 ms worst case with max jitter,
about 1.1 s of headroom — and a regression test forces max jitter, sums the real
requested delays, and fails if a future constant change breaks that ceiling.

Disclosed honestly: this bound leaves a small residual. The originally reported
shape (N=4) is clean across 14 trials, but N=6 is 9/10 and N=10 is 5/6. Tighter
budgets were measured and are *worse* (1730 ms / 2153 ms / 2579 ms configurations
all showed 15–33% failure at N=6, so base-delay size matters independently of
total time). Closing that residual properly means degrading to an honest
empty-index answer instead of exiting when the ladder is exhausted, which is
tracked separately.

Also fixes a latent bug in `SqliteBackend.reconnect()` and
`OverlayBackend.reconnect()`, and a worse one introduced while fixing it: both
closed the *old* handle in a `finally`, so on the failure path — where the swap
never happened and the "old" handle still **was** `this.db` — the live connection
was closed, leaving the backend holding a closed database for the rest of the
process instead of continuing on the still-valid old one. The close now happens
only after a successful swap, in both backends (`OverlayBackend` retires two
handles), with a deterministic regression test per backend that forces the open to
fail and asserts the backend still works.
