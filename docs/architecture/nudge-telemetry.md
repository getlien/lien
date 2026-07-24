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
| read-time impact | read annotation | an annotation emitted on Read | `get_files_context` **or** `get_dependents` call |
| exported-signature | blast-radius | an exported-signature warning fired | `get_dependents` call |
| did-you-run-tests | test-verification | the Stop advisory fired | a recognized `test_run` |

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

### The join (cheap, at report time)

`computeNudgeFunnels` groups in-window events by session and, per session,
remembers the **latest timestamp of each signal type**. A `shown` counts as
acted-on when some signal its nudge cares about has a latest timestamp ≥ the
shown timestamp. That's an O(n) pass — no per-pair comparison, no live
correlation (the brief's "cheap joins at report time"). Both the shown and the
signal must fall inside the window; since a signal after an in-window shown is
necessarily also in-window (the window ends at "now"), no join is lost at the
edge.

**Why the join is session+time, not file-matched.** The `shown` event records
the file path the Read tool gave it (typically **absolute**), while a
`get_dependents`/`get_files_context` signal records the path the MCP tool arg
gave it (typically **repo-relative**). Those don't string-match, so v1 joins on
`sessionId` + time only — exactly the brief's baseline ("a subsequent
get_dependents call (any)"). The raw file/symbol are still recorded on both
sides, so a future revision can normalize and tighten to a file-matched count;
v1 does not, and the disclaimer says the join is a same-session co-occurrence,
nothing stronger.

### Where each event is recorded

| Event | Recorded by |
| --- | --- |
| `shown{annotate}` | `annotate-read.sh`, after it emits a (non-empty) annotation |
| `shown{blast}` | `api-delta-write.sh`, after it emits a warning |
| `shown{test-verify}` | `test-verify-stop.sh`, after the advisory fires |
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
than stacking a second mechanism: when the guard is on, the touchfile's mere
existence (any age) means "already annotated this file this session" → stay
silent. The dirs are already GC'd by the SessionStart/SessionEnd hooks, so this
is naturally session-scoped with no new cross-session state. Guard **off**
restores the old TTL-windowed behavior.

### (b) Risk floor

The annotation now passes `--min-risk <level>` to `lien annotate`
(`LIEN_ANNOTATE_MIN_RISK`, default `medium`). Below-floor files stay silent
**unless** they carry a complexity or headroom concern — those are the
high-value plan-time nudges and always fire. The floor is a pure, unit-tested
predicate (`belowRiskFloor`): `complexity/headroom present → emit`, else `risk
rank < floor rank → suppress`. An unset or unrecognized floor never suppresses
(fail-open), so the default (no floor) is byte-for-byte the old behavior.

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
- **The join is loose by design.** v1 counts *any* qualifying same-session signal
  after the shown, not one provably about the flagged file/symbol (see the
  path-form mismatch above). It can over-count. The raw file/symbol are recorded
  so this can be tightened later without a schema change.
- **The complexity-delta funnel is cross-run, not same-session.** Its "acted" is
  `resolvedAfterFlag` — a function flagged then later seen clean, across runs and
  possibly across sessions. That is the honest v1 definition it already had; it
  is presented in the same table for continuity, with the difference noted.
- **Volume is not usage of the funnels themselves.** `shown` counts an emission,
  not whether the model read it. The hook channels doc
  ([claude-code-hook-channels.md](claude-code-hook-channels.md)) is the authority
  on which channel actually reaches the model.
- **Guard thresholds are repo-shaped.** The `medium` default was chosen from this
  repo's distribution; a very differently shaped codebase may want a different
  `LIEN_ANNOTATE_MIN_RISK`. The knob exists for exactly that.
