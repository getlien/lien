# Nudge A/B v2 — the task-decoupled, discriminating protocol (FROZEN pre-registration)

This document is the **pre-registration** for a second-generation A/B test of two
Lien nudges that the first-generation experiments could only measure as nulls:

- **Blast-radius warning** — `plugins/claude/hooks/api-delta-write.sh` (PR #841).
- **Did-you-run-the-tests advisory** — the Stop hook `recap-stop.sh`'s unrun-tests
  section (`lien recap`, the successor to PR #843's `test-verify-stop.sh`).

It is frozen before the first trial runs. Once any arm has executed, nothing below
changes: no metric is added, redefined, or reinterpreted post hoc; a null is
reported as a null. The runner that executes it is
`scripts/experiments/nudge-ab-v2/run.mjs`; this document and that runner are the
whole instrument, and running it later requires **zero further design decisions**.

> **Status: designed and frozen. NOT YET RUN.** The arms cost real OpenRouter/API
> budget (see [Cost](#cost-estimate)); they run only after the owner approves the
> spend. The runner refuses to start an arm until the contamination probe has
> passed in the same invocation.

---

## 1. The problem this design exists to defeat: task-forcing

Both first-generation A/Bs
([blast-radius-nudge-ab.md](blast-radius-nudge-ab.md),
[test-verification-nudge-ab.md](test-verification-nudge-ab.md)) returned an honest
**8/8 vs 8/8 null on the primary metric**, and the context-neutral re-runs (PR #844)
reproduced the null in a verified-clean environment (7/8 vs 8/8 on the sharper blast
sub-metric; 8/8 vs 8/8 on test-verification). The diagnosis was **not** "the nudge
does nothing." It was that the frozen scenarios were **task-forced**: the scenario
text made the nudged behavior derivable from the task itself, so any competent model
did it with or without the nudge, leaving no headroom to measure a difference.

- Blast: the target file showed all its call sites in-file, and the task
  ("thread `opts` through") *required* updating them. Checking callers was the task.
- Test-verification: the associated tests were **named in the prompt**, and "run the
  tests you just touched" is close to a current model's default on any edit.

v2 removes the task-forcing on both axes. The nudged behavior must **not** be
derivable from the task or the edited file:

1. **Out-of-file dependents.** The changed symbol's callers live in *other
   directories*; nothing in the edited file names or hints at them. Finding them
   requires a search the task never asks for.
2. **A test not named after its source.** The associated test is linked to the
   source only by an `import`, never by filename, so "which test covers this?" has
   **no lexical answer** — you either already know (the nudge tells you) or you go
   and run the import-graph query.
3. **Plain feature/fix tasks.** Each prompt is a normal feature request. It never
   mentions callers, dependents, tests, risk, coverage, or Lien.

The two nudges are also each **isolated**: every *other* nudge is held off in both
arms, so exactly one signal varies per experiment (see [§4](#4-arms-the-real-kill-switches)).

---

## 2. Scenario fixtures (frozen)

Pristine trees live under `scripts/experiments/nudge-ab-v2/fixtures/`. The runner
copies one to a fresh temp dir per trial, `git init`s + commits it, and
`lien index`es it, so each trial is independent. They are plain JS/TS projects
outside `packages/`, so the repo's build/lint/typecheck/test/format tooling never
touches them.

### 2a. Blast fixture (`fixtures/blast/`, project `pricing-app`)

```
src/pricing/discount.ts     export applyDiscount(price, rate)   ← the edited file
src/checkout/cart.ts        imports + calls applyDiscount        ← out-of-dir dependent #1
src/reports/invoice.ts      imports + calls applyDiscount        ← out-of-dir dependent #2
```

`discount.ts` is self-contained on its face — nothing in it names `cart.ts` or
`invoice.ts`. **Task** (`prompts/blast.task.txt`): add an *optional* minimum-price
floor to `applyDiscount`. The natural implementation adds a parameter, which changes
an exported signature → `api-delta` fires. Because the new parameter is optional,
the two dependents still compile and behave correctly, so **the only thing that
surfaces their existence is the blast warning** — nothing about the task forces the
agent to go look for them.

Verified (zero-LLM, `run.mjs check`): after the edit, `lien api-delta` reports
`applyDiscount signature-changed, dependentCount 2, untestedDependentCount 2,
riskLevel medium, enriched`, and `api-delta-write.sh` renders:

```
⚠ lien: exported signature changed — applyDiscount (2 dependents, 2 untested, risk medium). Run get_dependents before relying on callers.
```

### 2b. Verify fixture (`fixtures/verify/`, project `orders-app`)

```
src/order-status.ts             export formatStatus(order)        ← the edited file
test/regression-suite.test.ts   imports formatStatus (vitest)     ← associated by IMPORT, not name
```

**Task** (`prompts/verify.task.txt`): include the customer's name in the formatted
status string — a tiny, low-stakes edit that does not read as "test me." There is
**no `test` script** in `package.json`, so running the suite is a deliberate,
discovery-requiring act (`npx vitest run <path>`), not a reflex. The test's filename
(`regression-suite`) shares no stem with its source (`order-status`), so a naive scan
of source names gives no path to it.

Verified (zero-LLM, `run.mjs check`): `lien verify-tests note-edit` associates
`src/order-status.ts → test/regression-suite.test.ts` (import-based, via
`findTestAssociationsFromChunks`); `lien verify-tests report` raises it as unrun; and
after a covering `npx vitest run test/regression-suite.test.ts` the report goes
silent. `recap-stop.sh` wraps that report text as `{"decision":"block","reason":…}`.

---

## 3. Execution environment (frozen)

Each trial is one headless, agentic `claude -p` run **with tools enabled** (Edit,
Write, Read, Bash, Grep, Glob), from inside the trial's scenario dir. This is the
core departure from v1, whose trials were tool-free single-turn generations: the v2
metrics are about what the agent *does* in a repo, so it must be able to act.

Clean context is enforced by three independent controls, all identical across arms:

1. **Isolated config dir.** `CLAUDE_CONFIG_DIR` points at a runner-generated dir with
   a minimal `settings.json` and **no `enabledPlugins` and no user `rules/`**. This is
   what disables the ambient, user-level `lien@lien` plugin — both its MCP
   *instructions* (the confound PR #844 discovered) and its *hooks* — for the run.
   macOS auth lives in the Keychain, not this dir, so headless `claude` still
   authenticates.
2. **Stripped MCP.** `--strict-mcp-config --mcp-config <{"mcpServers":{}}>` — belt and
   braces; zero MCP servers, no Lien tool instructions.
3. **Explicit hooks only.** The nudge under test is wired by absolute path via
   `--settings` (see §4), so the experiment exercises **this checkout's** hook
   scripts, not a commit-pinned plugin snapshot.

The hooks shell out to the bare `lien` binary; the runner puts a `lien` shim on
`PATH` that resolves to this checkout's build (`packages/cli/dist/index.js`), so the
CLI under test is unambiguous.

### 3a. Mandatory contamination + plumbing probe (hard precondition)

Before **any** arm runs, `run.mjs probe` executes one `claude -p` with the exact arm
invocation (isolated config dir, stripped MCP, `--settings {hooks:{}}`) from a
git-free, `CLAUDE.md`-free directory, asking the model to quote verbatim every project
instruction / repo rule / tool-usage policy in its context (`prompts/probe.txt`,
"…if there are none, reply NONE"). It **passes only if**:

- the output is non-empty (proves auth + the isolated-config plumbing work), **and**
- the output contains **none** of: `get_dependents`, `get_files_context`,
  `search_code`, `claude.md`, `lien`, `blast radius`, `complexity threshold`,
  `test association` (the frozen `contaminationScan` list), **and**
- programmatically: no `CLAUDE.md` in the scenario dir or any ancestor up to `/`, and
  the mcp-config is empty.

The runner writes a `.probe-passed` marker only on success and **refuses to run any
arm without it**. The probe output is archived to `.wip/nudge-ab-v2/probe.jsonl`.
(The user's ambient `~/.claude/rules/context7.md` is removed by control #1 above, so
unlike PR #844 it is *not* present in this environment — a strictly cleaner context.)

### 3b. Hook-liveness precondition (zero-LLM)

`run.mjs check` materializes both fixtures and asserts the real hooks render the
intended nudges against them (the exact output quoted in §2). It runs with no LLM and
must pass; a fixture that no longer triggers its nudge is an instrument failure, not a
result. **This check has been run and passes on the frozen fixtures** (it is part of
this PR's dogfooding evidence).

---

## 4. Arms: the real kill switches

Arms differ **only** by the real env kill switch of the nudge under test. Everything
else — prompt, fixture, model, tools, config — is byte-identical. The base env
(`LIEN_DELTA_HOOK=off`, `LIEN_ANNOTATE_GUARD=off`) plus each experiment's `baseEnv`
neutralizes every other nudge in both arms.

| Experiment | Signal (ON) | Control (OFF) | Held off in BOTH arms |
|---|---|---|---|
| **blast** | `LIEN_BLAST_HOOK` unset (on) | `LIEN_BLAST_HOOK=off` | `LIEN_RECAP=off`, `LIEN_TEST_REMINDER=off`, `LIEN_DELTA_HOOK=off` |
| **verify** | `LIEN_RECAP` unset (on) | `LIEN_RECAP=off` | `LIEN_BLAST_HOOK=off`, `LIEN_TEST_REMINDER=off`, `LIEN_DELTA_HOOK=off` |

Wiring (`--settings`, absolute paths):

- **blast** — one hook: `PostToolUse Edit|Write|MultiEdit → api-delta-write.sh`. Recap
  is off in both arms, so the edit-time warning is the *only* delivery of the blast
  signal; the OFF arm gets nothing.
- **verify** — three hooks: `PostToolUse Edit|Write|MultiEdit → silent-note-edit.sh`
  (scaffolding), `PostToolUse Bash → test-run-note.sh` (real, records observed runs),
  `Stop → recap-stop.sh` (real, the nudge under test).

### 4a. Why the `silent-note-edit.sh` scaffolding is legitimate, not a cheat

The Stop advisory can only fire if the session ledger records that the target file was
edited and has an associated test. In production, the *edit-time* reminder
(`test-reminder.sh`) does that recording — **but it also prints the associated test's
name**, which would hand the agent the very fact this experiment withholds, collapsing
the discriminator. So `test-reminder.sh` is held off in both arms
(`LIEN_TEST_REMINDER=off`), and the ledger recording it would do is provided instead
by `scripts/experiments/nudge-ab-v2/hooks/silent-note-edit.sh` — the same
`lien verify-tests note-edit` call, output discarded, **identical in both arms**. It
adds nothing the model can see; it only holds ledger population constant so the *only*
variable is the Stop advisory. This isolates the Stop hook (PR #843's target) rather
than bundling it with the edit-time reminder. The fidelity trade-off is stated in
[§8](#8-validity-caveats).

---

## 5. Sample size, randomization, N

- **N = 10 per arm**, 20 per experiment, **40 arm trials total**. This deviates from
  v1's N = 8, deliberately: v1 was confirming an expected null and needed no power;
  v2 is built to *detect* a real difference and to survive a single-trial flip. At
  N = 10, an 8/10-vs-2/10 or 9/10-vs-3/10 split clears one-sided Fisher p < 0.05 with
  margin, where the same effect at N = 8 would sit on the significance boundary. 10
  also matches the repo's established `--calibrate 10` convention.
- **Interleaving.** Arms run in a single fixed, seeded Fisher-Yates order
  (`INTERLEAVE_SEED = 20260725`) mixing all 20 `on`/`off` labels, so neither arm
  clusters in time. The order is reproducible from the seed.
- **Each trial is independent**: fresh temp repo, fresh index, fresh `--session-id`.

---

## 6. Primary metrics and exact detection rules (frozen)

Detection is deterministic and offline, over the captured `stream-json` transcript
plus the FEATURE-2 ledger. All rules are implemented in
`scripts/experiments/nudge-ab-v2/detect.mjs`; the prose here and that code are the
same specification.

### 6a. Blast — concrete beyond-file caller action

**Positive iff the agent, anywhere in the trial, takes a concrete action to identify
callers of `applyDiscount` beyond the edited file** — ANY of:

- a `Grep` (or `Bash` grep/rg/git-grep) whose pattern is the symbol `applyDiscount`;
- a `Grep`/`Read`/`Glob`/`Bash` that targets a specific out-of-directory dependent
  (`cart.ts`, `cartTotal`, `invoice.ts`, `invoiceLine`, `checkout/`, `reports/`);
- a final answer that **names** a specific dependent by one of those identifiers.

**Explicitly NOT counted:** generic hedging ("other callers may need updating",
"external usages could break") that neither searches for nor names a specific
dependent. That sentiment is exactly the ceiling v1 hit (7/8 in clean control), so the
v2 discriminator is raised to *observable action*. The generic-sentiment rate is still
recorded, as a **secondary/context** signal only, never the primary.

- **Hypothesis:** signal (ON) positive-rate > control (OFF).
- **Validity of an ON trial:** the blast warning actually fired (a `blast` note-shown
  event for the session in `nudge-events.jsonl`). An ON trial where the agent made no
  qualifying signature change (no warning) is **invalid** and re-drawn.

> Note: MCP is stripped, so the literal `get_dependents` tool does not exist in-trial;
> a nudged agent acts via grep/read instead. The metric counts that. This makes the
> blast number a *lower bound* on the warning's pull relative to production, where the
> named tool is present (see §8).

### 6b. Verify — ran the associated test

**Positive iff the associated test (`test/regression-suite.test.ts`) was observed run**
this session. The **authoritative oracle** is the FEATURE-2 ledger, queried post-run
by `lien verify-tests report --session <id>` from the trial dir (reuses the shipped
`classifyTestCommand`/coverage logic, so no detection drift): empty report ⇒ the test
was covered (positive); the file still listed ⇒ not run (negative). This captures
*any* covering run — scoped-by-path or whole-suite — including runs the agent makes in
the extra turn the Stop `block` grants. The transcript's test commands are recorded as
a cross-check but the ledger is authoritative.

- **Hypothesis:** signal (ON, advisory present) positive-rate > control (OFF).
- **Mechanism note (context, not a separate primary):** in the ON arm the Stop
  advisory only fires when the agent has *not* already run the test; the comparison of
  final run-rates therefore measures exactly the advisory's rescue of the
  otherwise-non-testers. If current models test-by-default even here, both arms sit
  high and the null is real information (v1 already suggested this is likely) — it is
  reported as such.

### 6c. Decision rule (frozen)

For each experiment: report raw rates `hits/N` per arm. **Primary separation is
declared iff one-sided Fisher's exact p < 0.05 in the hypothesized direction (ON >
OFF).** Per the standing launch rule, **no lift claim** is made for either nudge unless
its pre-registered primary metric separates by that test. A non-separating result is a
null, reported as a null — not reframed as "inconclusive, therefore supportive."

Contamination guard: any OFF-arm transcript containing a `contaminationScan` term is
flagged as a leak in the summary; leaks invalidate the affected trials.

---

## 7. Abort criteria (frozen)

The run aborts (no result claimed) if any holds:

1. **Contamination probe fails** (§3a) — non-empty-and-clean not satisfied.
2. **Hook-liveness check fails** (§3b) — a fixture no longer triggers its nudge.
3. **> 20% invalid trials** in either arm of an experiment (agent never edited the
   target, transcript unparseable, ON-arm nudge never fired). Invalid trials up to that
   cap are re-drawn with fresh session ids; beyond it, the experiment is declared an
   instrument failure, not a measured null.
4. **Any OFF-arm contamination leak** that cannot be isolated to specific re-drawable
   trials.

---

## 8. Validity caveats (carried forward, stated before running)

- **Lower-bound environment.** Like PR #844, this removes not just the contamination
  but *every* ambient instruction (no CLAUDE.md, no plugin, no user rules, no prior
  turns). It is a floor for isolating the mechanism, not a forecast of the effect in a
  real, richly-contextualized session under time pressure — the exact gap these nudges
  exist to close. A separation here is strong evidence; a null here does **not** prove
  the nudge is useless in production, only that a maximally-naive agent doesn't need it
  at this task scale.
- **Blast tool absence.** With MCP stripped, the ON agent cannot literally call
  `get_dependents`; it greps instead. The blast rate is thus a lower bound vs
  production where the tool exists.
- **Verify isolates the Stop hook.** By holding the edit-time reminder off in both
  arms, this measures the Stop advisory *alone*, not the full test-verification feature
  (edit-time reminder + Stop) a user actually enables. A positive result is
  attributable to the Stop hook specifically; the bundled feature could be stronger.
- **N = 10.** Real but modest power. A 7/10-vs-9/10-type flicker is not a result and is
  reported as a null, exactly as v1's 7/8-vs-8/8 was.

---

## 9. Cost estimate

- **41 headless `claude -p` invocations**: 40 arm trials (10 × 2 arms × 2 experiments)
  + 1 contamination probe. The zero-LLM instrument check and all ledger/`api-delta`
  oracles are free.
- Each arm trial is **agentic** (reads a few files, greps, edits, sometimes runs a
  test, 1–2 Stop cycles) on `--model sonnet`. Rough order: tens of thousands of
  (largely cache-eligible) input tokens + a few thousand output tokens per trial ⇒
  **≈ $0.10–0.30 per trial**.
- **Total ≈ $5–12**, comparable to one harness `--calibrate 10` sweep (~$5–8). Dropping
  to N = 8 (v1 parity) would cut ~20% (32 trials).

These are estimates; actual spend is metered by the provider. The run is gated on
owner approval of this budget.

---

## 10. How to run (after approval)

```bash
# 0. one-time: build this checkout so the lien shim resolves to it
npm ci && npm run build && npm run build:native -w @liendev/parser-native

# 1. zero-LLM instrument check (free) — must pass
node scripts/experiments/nudge-ab-v2/run.mjs check

# 2. mandatory contamination + plumbing probe (1 claude call) — must pass
node scripts/experiments/nudge-ab-v2/run.mjs probe

# 3. the arms (gated on the probe marker)
node scripts/experiments/nudge-ab-v2/run.mjs run blast
node scripts/experiments/nudge-ab-v2/run.mjs run verify
```

Raw transcripts, per-trial verdicts, the probe output, and the `*-summary.json`
(rates + Fisher p + separation decision) are written under `.wip/nudge-ab-v2/`
(gitignored). Results get a dated section appended to
[blast-radius-nudge-ab.md](blast-radius-nudge-ab.md) and
[test-verification-nudge-ab.md](test-verification-nudge-ab.md), reported as whatever
they are.

---

## 11. Artifacts (this PR)

- Pre-registration: this document (frozen).
- Fixtures: `scripts/experiments/nudge-ab-v2/fixtures/{blast,verify}/`.
- Prompts: `scripts/experiments/nudge-ab-v2/prompts/`.
- Scaffolding hook: `scripts/experiments/nudge-ab-v2/hooks/silent-note-edit.sh`.
- Runner + detection: `scripts/experiments/nudge-ab-v2/run.mjs`, `detect.mjs`.
- Kit overview: `scripts/experiments/nudge-ab-v2/README.md`.
