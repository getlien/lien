# Nudge telemetry v2 — shown → acted-on funnels + the habituation guard

Lien's plugin hooks emit several nudges as an agent works: a read-time impact
annotation, a complexity-delta warning, an exported-signature (blast-radius)
warning, and a did-you-run-the-tests advisory. Until now the nudges *talked* and
nobody checked whether anyone listened. This feature adds two things:

1. **Telemetry v2** — per-nudge "shown → acted-on" funnels in `lien stats`, so
   you can see how often a nudge is followed by the action it asks for.
2. **A habituation guard** on the read-time annotation, so it fires only when it
   is likely to matter (once per file per session, above a risk floor) instead
   of on nearly every read.

Everything here is **deterministic, zero-LLM, and local-only.** No network call,
no telemetry upload — the funnels read a JSONL file next to your local index.

> **Honesty, up front.** The funnels are **observational**. "Acted-on" means a
> qualifying follow-up occurred *in the same session, after the nudge* — it is
> co-occurrence over time, **not proof the nudge caused the action.** The only
> proven behavioral result for any Lien nudge is the original `lien delta` A/B
> (see [lien-delta.md](lien-delta.md)); this telemetry is correlation, and the
> `lien stats` output says so in as many words. If you want a causal number,
> run an A/B — the funnels can't give you one.

---

## Deliverable 1 — the funnels

### The ledger: `nudge-events.jsonl`

One append-only JSONL log, `nudge-events.jsonl`, lives in the per-repo index
directory (`getIndexDir(rootDir)`), sibling to `delta-events.jsonl` and
`blast-events.jsonl`. It carries two event kinds, both stamped with the
`sessionId` they were recorded under:

- `shown` — a nudge surfaced to the model: `{ kind, timestamp, sessionId, nudge, file?, symbol? }`
- `signal` — a follow-up tool call a nudge cares about: `{ kind, timestamp, sessionId, signal, file?, symbol? }`

Bounded exactly like its siblings: a 2 MB byte cap trims the oldest lines from
the front (`MAX_BYTES_BEFORE_TRIM` / `KEEP_LINES_AFTER_TRIM`). Every read
shape-validates each line and skips a torn/corrupt/unknown one rather than
throwing (`readNudgeEvents`). Recording is best-effort throughout — a broken
ledger never breaks the hook that writes it.

**Kill switch:** `LIEN_NUDGE_EVENTS=off` disables recording (reading still works,
so history already on disk stays visible to `lien stats`).

#### Why durable, not session-GC'd

The session-scoped test-ledger (`test-sessions/<id>.jsonl`) is deleted at
SessionEnd because it has no cross-session history to report on. The funnels are
the opposite: `lien stats` reports **7- and 30-day windows**, which a
per-session, GC'd ledger cannot back. So `nudge-events.jsonl` **accumulates**
across sessions (bounded by the byte cap) rather than being GC'd. "Session-scoped"
is preserved not in the file lifecycle but in the **join**: a nudge counts as
acted-on only when a qualifying signal shares its `sessionId`. This is a
deliberate deviation from a literal "reuse the test-sessions pattern (GC'd)"
reading — the 7/30-day requirement makes the durable-log choice the honest one,
and the byte cap keeps it bounded without needing session GC.

### The four funnels

| Funnel (`lien stats` label) | Nudge | "shown" is… | "acted-on" is a later same-session… |
| --- | --- | --- | --- |
| complexity delta | `lien delta` | a distinct function flagged over threshold | that function seen clean again (`resolvedAfterFlag`) |
| read-time impact | read annotation | an annotation emitted on Read | `get_files_context`/`get_dependents` **on the flagged file** |
| exported-signature | blast-radius | an exported-signature warning fired | `get_dependents` **on the flagged file or symbol** |
| did-you-run-tests | test-verification | the Stop advisory fired | a recognized `test_run` (session-scoped) |

**Integration, not duplication.** Two funnels reuse existing substrate rather
than re-recording:

- **complexity delta** is derived entirely from `delta-events.jsonl` via
  `computeDeltaWindowStats` (shown = `distinctFunctionsFlagged`, acted =
  `resolvedAfterFlag`). Nothing new is written for it, and the funnel can never
  disagree with the delta section of `lien stats`. (Its acted signal is a
  cross-run presence/absence, not a same-session join — the honest v1 definition
  it already carried.)
- **did-you-run-tests** reuses the *single* `classifyTestCommand` detection in
  `lien verify-tests note-run`. That command already records a `run` to the
  session test-ledger for the Stop decision; it now *also* fans one compact
  `test_run` signal to `nudge-events.jsonl`. There is no second detector, and the
  session test-ledger is untouched — we just give the funnel the durable history
  the GC'd ledger cannot.

### The join (cheap, at report time — and matched)

`computeNudgeFunnels` groups in-window events by session and, per session, builds
three latest-timestamp indices: by signal **type**, by **(type, file)**, and by
**(type, symbol)**. A `shown` counts as acted-on only when a signal its nudge
cares about occurred at or after the shown timestamp **and names the same thing**:

- **annotate** — a later `get_files_context`/`get_dependents` on the **same file**.
- **blast** — a later `get_dependents` on the **same file OR the same symbol**.
- **test-verify** — any later `test_run` (session-scoped: a test run carries no
  file, and unlike `get_files_context` it isn't mandated before every edit, so a
  bare same-session join doesn't inflate here).

Still an O(n) build + a few map lookups per shown — no per-pair scan, no live
correlation. Both the shown and the signal must fall inside the window; since a
signal after an in-window shown is necessarily also in-window (the window ends at
"now"), no join is lost at the edge.

**Why matched, not any-signal.** The first cut joined on session + time only. That
was **mechanically inflated**: CLAUDE.md mandates `get_files_context` before every
edit, so almost any session contains one, and "any get_files_context after the
annotation" trended ~100% regardless of engagement — the metric defeated its own
purpose (a reviewer reproduced 100% from three annotate-shown + one *unrelated*
`get_files_context`). Matching on file/symbol fixes it. For the comparison to work,
`shown.file` and `signal.file` must be the **same string form**: the ledger
normalizes both to project-relative at record time (`toRepoRelativeFile` in
`nudge-events.ts`), honoring the `NudgeShownEvent.file` "project-relative" contract
— the `shown` path arrives absolute (Read/Edit tool), the `signal` path arrives
repo-relative (MCP arg), and both come out repo-relative. The match biases toward
**undercounting** (an agent may act via a different file's query, or a batched
`get_files_context` whose first — and only recorded — path isn't the flagged one),
which is the honest direction for this metric; inflation is not.

### Where each event is recorded

| Event | Recorded by |
| --- | --- |
| `shown{annotate}` | `annotate-read.sh`, after it emits a (non-empty) annotation |
| `shown{blast}` | `api-delta-write.sh`, after it emits a warning (records the edited file + the primary changed symbol) |
| `shown{test-verify}` | `lien recap` (recap-cmd.ts), when the recap blocks and its tests section fired |
| `signal{get_dependents/get_files_context}` | `nudge-signal.sh` (PostToolUse on the Lien MCP tools) |
| `signal{test_run}` | `lien verify-tests note-run` (reusing its one classification) |

The hooks shell out to `lien nudge note-shown` / `lien nudge note-signal` — a
fail-open command group (like `lien verify-tests`): a missing or invalid
argument is a silent no-op, any error is swallowed, and the process still exits
0. The MCP matcher is prefix-robust
(`mcp__.*__get_dependents|mcp__.*__get_files_context`) so it works regardless of
how the plugin's server name is prefixed; the script re-derives the precise
signal from the tool name.

---

## Build provenance — telling "instrumentation absent" from "shown but ignored" (#916)

An empty `nudge-events.jsonl` window used to be ambiguous in exactly three
ways that all render identically as zeros: nobody ever qualified for a nudge,
a nudge fired every time and was ignored, or **recording was impossible**
because the deployed plugin hooks predated this instrumentation entirely. The
third case is not hypothetical: the first real telemetry read (2026-07-28)
found an empty ledger, and forensic reconstruction found the field-deployed
plugin was a directory-source install pinned to a stale branch, 12 days
behind the CLI and missing the telemetry-v2 hooks outright. The read had to
be deferred until this was understood by hand.

### The stamp

Every `shown`/`signal` event now carries an optional `build` field:

```ts
build?: { cliVersion: string; hooksHash?: string }
```

- `cliVersion` — the running `lien` binary's `package.json` version.
- `hooksHash` — a short (12-char) sha256 over every regular file directly
  inside the plugin hooks directory (name + content, sorted by name).

CLI version alone is insufficient: the failure mode above was stale *hooks*
running alongside an otherwise-current CLI (an npm install and a
directory-pinned plugin checkout update independently). The CLI cannot
discover the live hooks directory on its own — the whole point of the bug is
that the plugin snapshot and the CLI installation can come from different
places — so `hooksHash` is only ever computed from a `--hooks-dir` the
CALLING hook script supplies (its own `$(dirname "${BASH_SOURCE[0]}")`,
resolved once as `LIEN_HOOKS_DIR` in `lien-resolve.sh` and threaded by every
hook that records an event: `annotate-read.sh`, `api-delta-write.sh`,
`nudge-signal.sh`, and `recap-stop.sh`, all via `lien nudge note-shown`/
`note-signal`/`recap --hooks-dir <path>`). A bare CLI invocation with no
hooks-dir context still gets a stamp — just missing `hooksHash` — a
partial-but-honest signal, never a crash.

**Per-event, not a session header.** Every event carries its own stamp
rather than one header event per session, so a reader never needs to
reconstruct which session a header belongs to — robust to interleaved writes
from concurrent sessions, and to the byte-cap trim dropping an old header
while its session's later events survive.

**Cost discipline.** Hashing the hooks directory is filesystem-only (a dozen
small shell scripts, no subprocess), but doing it on every event would still
be wasted repeat work — `nudge-signal.sh` alone fires on every
`get_dependents`/`get_files_context` call. So the stamp is computed once per
session and cached to `<indexDir>/nudge-build/<sessionId>.json` (mirroring
`annotated-sessions/`'s and `test-sessions/`'s per-session state, GC'd the
same way by `annotate-clean.sh`'s SessionStart 24h sweep). Every later event
in that session reads the cache — one small file read — instead of
re-hashing. A session whose first event had no `--hooks-dir` and whose later
event does is topped up rather than staying stuck on a partial stamp for the
rest of the session.

**Back-compat.** Ledgers written before this change have no `build` field at
all. `readNudgeEvents` treats its absence as "unknown", never as a
known-good build — recreating that bug (silently trusting an absent/corrupt
stamp as current) is exactly what this feature exists to prevent. A `build`
that IS present but malformed (missing `cliVersion`) sinks the whole line
like any other torn write, rather than being half-trusted.

### Surfaced in `lien stats`

`computeNudgeRecordingStatus` (`nudge-stats.ts`) answers, per 7/30-day
window: is it empty, and if so, was a recording-capable build ever seen (and
when)? `lien stats`' funnel section renders the three cases:

| Case | What `lien stats` prints |
| --- | --- |
| Non-empty window (real engagement) | The funnel table, plus `Recorded by: <cliVersion> (hooks <hash>)` — the latest build stamped **inside** the window. |
| Empty window, capable build seen elsewhere in the ledger | `Zero events in this window, but a recording-capable build was last seen <N>d ago (...)`. Zero here reads as "no qualifying edits", not disengagement. |
| Empty window, **no** build ever stamped anywhere in the ledger | `No recording-capable build has ever been observed for this repo...` — the honest never-recorded case; never implies disengagement. |

The JSON output (`--format json`) carries the same data, additively, under
`nudgeFunnels.recording` (one `NudgeRecordingStatus` per window,
parallel to `nudgeFunnels.windows`) — the pre-existing top-level shape is
unchanged.

### `lien nudge doctor` — the drift check

`lien nudge doctor [--hooks-dir <path>] [--format text|json]` is a manual
health check, deliberately scoped narrower than a byte-for-byte "does the
live plugin match this CLI's exact expected hook content" comparison (that
would need a content manifest published inside the npm package, generated at
build time from `plugins/claude/hooks/` and shipped across a package
boundary this repo doesn't currently cross — judged out of scope for the PR
that shipped this file; see its follow-up issue if one is open before relying
on this note). What it DOES check, all deterministic, no LLM involved:

1. **The exact #916 fingerprint** — is `nudge-signal.sh` (the file the
   telemetry-v2 instrumentation added) present in the live `--hooks-dir`? Its
   absence is a direct signal that this plugin install predates the
   instrumentation entirely — `critical`.
2. **Hash drift** — does the live hooks directory's content hash differ from
   the hash the ledger's last recorded session stamped? (`warn`)
3. **Version drift** — does the CLI version that recorded the last stamp
   differ from the one running `doctor` right now? (`warn`)
4. **Never recorded** — has the ledger never once seen a build stamp? (`warn`)

Omitting `--hooks-dir` runs only checks 3–4 (ledger-history-only; useful when
invoked by hand with no hook context). `doctor` always exits 0 — purely
advisory, not wired into a hook by default. Run it yourself, or from an
agent, when telemetry output looks suspicious.

---

## Deliverable 2 — the habituation guard

The read-time annotator (`annotate-read.sh`) used to fire on every Read (subject
to a 5-minute per-file TTL). Measured against this repo's own index, **249 of
288 source files (86%) currently emit an annotation** — a real habituation risk.
The guard (default **on**; opt out with `LIEN_ANNOTATE_GUARD=off`) makes it
selective, in a data-honest way.

### (a) Per-session dedup

The annotator already kept a per-`(session, file)` touchfile under
`annotated-sessions/<id>/`, suppressing re-annotation for `LIEN_ANNOTATE_TTL_MIN`
minutes (default 5). The guard **integrates with that same touchfile** rather
than stacking a second mechanism: when the guard is on, the touchfile means
"already annotated this file this session" → stay silent — **unless** the
touchfile's *content* says otherwise (see below). The dirs are already GC'd by
the SessionStart/SessionEnd hooks, so this is naturally session-scoped with no
new cross-session state. Guard **off** restores the old TTL-windowed behavior.

**Not fully independent of (b) (#978).** `lien annotate` itself never silences
a never-suppress signal (see (b) below), but this dedup gate runs *before*
`lien annotate` — it has to, that's the whole point of skipping the invocation
on a repeat Read. That makes it structurally content-blind: without more,
it would suppress a file's second Read even if a fresh `lien annotate` call
would have printed a never-suppress signal, silently defeating (b)'s
guarantee on every read after the first. The fix: `lien annotate` exits `2`
(instead of the default `0`) whenever the annotation it just printed carried
a never-suppress signal (`hasNeverSuppressSignal` in `annotate-cmd.ts`), and
the hook records that in the touchfile's **content**, not just its
existence — `1` means "never dedup-skip this file again this session," so a
signal-carrying file re-invokes `lien annotate` (and re-applies its own
carve-outs) on every read for the rest of the session, while an ordinary
file keeps the cheap existence-only dedup unchanged.

### (b) Risk floor

The annotation now passes `--min-risk <level>` to `lien annotate`
(`LIEN_ANNOTATE_MIN_RISK`, default `medium`). Below-floor files stay silent
**unless** they carry a complexity or headroom concern, or an incomplete
dependent-attribution result — those are the high-value, honest-uncertainty
signals and always fire (`hasNeverSuppressSignal`). The floor is a pure,
unit-tested predicate (`belowRiskFloor`): `hasNeverSuppressSignal → emit`,
else `risk rank < floor rank → suppress`. An unset or unrecognized floor never
suppresses (fail-open), so the default (no floor) is byte-for-byte the old
behavior. `isTrivial` gates on the exact same predicate.

#### Why `medium`, from this repo's distribution

Running the real annotator over all 288 source files:

| | count | share of the 249 emitted |
| --- | ---: | ---: |
| emitted at all | 249 / 288 | 86% of files |
| risk `low` | 75 | 30% |
| risk `medium` | 78 | 31% |
| risk `high` | 33 | 13% |
| risk `critical` | 42 | 17% |
| zero-dependent (risk `low`) | 21 | 8% |
| **pure habituation** (low risk, covered, no complexity/headroom) | **40** | **16%** |
| carry a headroom (plan-time complexity) concern | 51 | — |

The blast-radius risk model (`computeBlastRadiusRisk`) already draws the natural
line: `low` = ≤5 dependents, all covered; `medium` = >5 dependents **or** any
uncovered dependent. A `low` file — "3 files import this, all tested" — is the
lowest-value thing to surface on *every* read. A floor of **`medium`** suppresses
that low-risk tail (~30% of emissions, 16% of them pure habituation) while
keeping every medium+ risk, and every complexity/headroom concern, always-on.
Combined with per-session dedup (once per file, not every 5 minutes), repeat
noise drops sharply. Tune with `LIEN_ANNOTATE_MIN_RISK=low|medium|high|critical`.

The guard deliberately does **not** add cooldowns or cross-session state (YAGNI
until the telemetry says otherwise), and it touches only the read annotation —
the write-side nudges (delta, blast, stop advisory) are already event-gated and
are left alone.

### Env summary

| Variable | Default | Effect |
| --- | --- | --- |
| `LIEN_NUDGE_EVENTS` | on | `off` disables funnel recording (reading still works) |
| `LIEN_ANNOTATE_GUARD` | on | `off` restores the old always-on TTL behavior (no dedup-once, no floor) |
| `LIEN_ANNOTATE_MIN_RISK` | `medium` | risk floor for the read annotation (guard on only) |
| `LIEN_ANNOTATE_TTL_MIN` | 5 | re-annotation window when the guard is **off** |

---

## Limitations

- **Correlation, not causation** (restated because it matters): a funnel's
  "acted-on" is a same-session, later-in-time co-occurrence. It cannot tell "the
  agent ran `get_dependents` *because* of the blast warning" from "the agent was
  going to anyway." No lift claim is made or implied anywhere.
- **The matched join undercounts, on purpose.** A signal must name the same file
  (or, for blast, the same symbol) as the shown. A genuine action expressed via a
  different file's query, or a batched `get_files_context` whose first — and only
  recorded — path isn't the flagged one, is not credited. Undercounting is the
  honest bias for this metric; the earlier any-signal join over-counted (it read
  ~100% off a single mandated `get_files_context`). Recording all of a batch's
  paths is a possible future tightening, not done here.
- **Ledger back-compat: legacy absolute-path events won't match.** `shown.file`
  is now normalized to project-relative at record time; any `shown` recorded
  before this change stored the raw absolute Read/Edit path and simply won't
  match a relative `signal.file`, so it reads as un-acted. There is no migration
  — a few hours of pre-change local data ages out of the windows on its own.
- **The complexity-delta funnel is cross-run, not same-session.** Its "acted" is
  `resolvedAfterFlag` — a function flagged then later seen clean, across runs and
  possibly across sessions. That is the honest v1 definition it already had; it
  is presented in the same table for continuity, with the difference noted.
- **High-volume repos see less than a full 30 days of coverage.** The log is
  bounded by the same 2 MB / ~2000-line front-trim as its siblings; a repo that
  emits enough nudge events to hit the cap inside 30 days will have its oldest
  events trimmed, so the 30-day *window* silently covers fewer than 30 days. The
  reported **rate** (`acted/shown`) stays unbiased on whatever survives — trimming
  removes the oldest lines first, and a signal is always newer than the shown it
  acts, so any shown that survives still has its signals (a surviving shown is
  never stranded; at worst an orphaned signal outlives a trimmed shown, and
  signals are never counted on their own) — but the **coverage** (how far back
  "30 days" really reaches) is truncated. Raise the cap or shorten the window if
  this bites.
- **Volume is not usage of the funnels themselves.** `shown` counts an emission,
  not whether the model read it. The hook channels doc
  ([claude-code-hook-channels.md](claude-code-hook-channels.md)) is the authority
  on which channel actually reaches the model.
- **Guard thresholds are repo-shaped.** The `medium` default was chosen from this
  repo's distribution; a very differently shaped codebase may want a different
  `LIEN_ANNOTATE_MIN_RISK`. The knob exists for exactly that.
- **Build stamps are absent on pre-#916 events**, by construction — there is no
  migration. A ledger written entirely before this change reports every window
  as `neverRecorded` even though it plainly WAS recording (just not stamping
  yet). This false-"never recorded" reading ages out on its own as the
  unstamped events fall out of the 7/30-day windows or the byte cap trims them;
  it is the deliberately honest direction to err in (never claim a known-good
  build where none was recorded).
- **`lien nudge doctor`'s live check needs `--hooks-dir`** to compare against
  the CURRENT plugin install; without it, `doctor` only reports ledger
  history, which can be stale relative to a plugin update that hasn't yet
  produced a new event. It also checks only for the telemetry-instrumentation
  canary file's presence, not byte-for-byte hook content — see the command's
  own doc comment (`nudge-doctor-cmd.ts`) for why the stronger check is
  deferred.
