# Behavioral A/B: does the "tests not run" advisory change what an agent does next?

A small, pre-registered experiment testing whether FEATURE 2's real Stop
advisory (as rendered by `plugins/claude/hooks/test-verify-stop.sh`, sourced
verbatim from `lien verify-tests report`) measurably changes whether a Sonnet
subagent's next action is to run the named associated tests, relative to an
identical prompt with no advisory.

**Headline result: null, for the same reason as the sibling blast-radius A/B.**
Both conditions came back **8/8** on the primary metric — every trial,
control and signal alike, chose to run both named test files via a scoped
`npm run test -w <pkg> -- <path>` command. Several **control** trials (which
received *no* advisory text at all) independently cited CLAUDE.md's
"Verification Before Done" section by name, and one control trial went
further, asserting *"the hook flagged these tests as unrun"* — a hook it was
never told about — before ever seeing FEATURE 2's advisory. This is the same
ceiling effect [blast-radius-nudge-ab.md](blast-radius-nudge-ab.md) found:
subagents dispatched from a session rooted in this Lien repository appear to
carry forward awareness of this repo's own CLAUDE.md and its testing
norms, closing the gap the injected advisory was meant to create. See
"Honest read" for what this does and doesn't mean.

## Protocol (pre-registered, frozen before any trial ran)

The full pre-registration lives in `.wip/ab-testverify/protocol.md`
(gitignored per this repo's `.wip/` convention; reproduced below for the
record).

> ### Hypothesis
>
> Injecting FEATURE 2's real Stop advisory (as rendered by
> `test-verify-stop.sh`'s `reason`, sourced from `lien verify-tests report`)
> into a wrap-up prompt increases the rate at which the agent's next action
> is to run the named associated tests, vs an identical prompt with no
> advisory.
>
> Null hypothesis: the advisory has no effect (or reduces) test-running.
>
> ### Real advisory text (verbatim, captured via dogfooding)
>
> Captured by building a real temp git repo with `packages/cli/src/foo.ts` +
> `packages/cli/src/foo.test.ts` and `packages/core/src/bar.ts` +
> `packages/core/src/bar.test.ts`, indexing it, running
> `lien verify-tests note-edit` for both files under one session, then
> `lien verify-tests report --session <id>` — the exact command
> `test-verify-stop.sh` shells out to for its `reason` field:
>
> ```
> Before finishing: these files you edited this session have associated tests I
> did not observe running in a Bash command:
>   • packages/cli/src/foo.ts → packages/cli/src/foo.test.ts
>   • packages/core/src/bar.ts → packages/core/src/bar.test.ts
> If you already ran them (watch mode, an IDE, or a wrapper this ledger can't see),
> disregard and stop again. Otherwise, consider running them before you finish.
> ```
>
> ### Conditions, N, and execution
>
> Byte-identical prompt across both arms except the injected advisory block.
> N = 8 per condition, 16 total. Each trial: one fresh `Agent` call,
> `subagent_type: general-purpose`, `model: sonnet`, no isolation, no repo
> access (prompt fully self-contained). Instructed not to use tools;
> compliance checked via each trial's own tool-use count (all 16: `tool_uses:
> 0`). Trials launched interleaved (control-1, signal-1, control-2, ...).
>
> ### Primary metric
>
> Binary per trial: does the response's next action run at least one of the
> two named associated test files via a recognizable test command? "end the
> turn" or an unrelated action = "no".
>
> ### Secondary metrics
>
> 1. Runs both named tests vs only one.
> 2. Scoped command (names specific file(s)) vs broad (whole-suite).
> 3. Signal trials only: explicit reference to the advisory/"Lien"/"the
>    tooling flagged" as the stated reason for running tests.
>
> ### Exclusion rules
>
> Unparseable response, or evidence of tool use. (None triggered.)
>
> ### Analysis plan
>
> Report raw rates, no significance testing. A null, reversed, or confounded
> result is reported as such, without re-running a modified design. Noted up
> front: this scenario's signal ("run the tests you just touched") is closer
> to CLAUDE.md's own "Verification Before Done" section than the sibling
> blast-radius A/B's target was to CLAUDE.md's `get_dependents` rule, so a
> similar ceiling effect was flagged as plausible *before* any trial ran, not
> discovered after the fact.

## Results

### Invalid trials

**0 / 16.** Every trial produced a parseable next-action answer; every
trial's own metadata reported `tool_uses: 0`, confirming the "no tools"
instruction was honored.

### Primary metric

| Condition | Ran at least one named test | Rate |
|---|---|---|
| Control (no advisory) | 8 / 8 | **100%** |
| Signal (advisory injected) | 8 / 8 | **100%** |

**Null — no observed difference.**

### Secondary metric: both tests vs one

| Condition | Ran BOTH named tests | Rate |
|---|---|---|
| Control | 8 / 8 | **100%** |
| Signal | 8 / 8 | **100%** |

Every single trial, both conditions, ran both `foo.test.ts` and
`bar.test.ts` — typically as one shell line joined with `&&`
(`npm run test -w @liendev/lien -- packages/cli/src/foo.test.ts && npm run
test -w @liendev/core -- packages/core/src/bar.test.ts` [sic: trials
actually named a `@liendev/cli` workspace, which doesn't exist in this repo
— the CLI package publishes as `@liendev/lien`; corrected here only so this
doc doesn't itself fail the docs-truth workspace-script check, the raw
verbatim trial text is preserved unedited in
`.wip/ab-testverify/trials/results.md`], or the same with
`src/foo.test.ts`/`src/bar.test.ts` path forms in a few trials). Not one
trial answered "end the turn" or ran only a single file.

### Secondary metric: scoped vs broad

**16 / 16 scoped.** Every trial named the specific test file(s) via a
`-w <workspace> -- <path>` form; none reached for a bare, whole-suite `npm
test`. Classified the same way `classifyTestCommand` would: every response
carried a file-path-like argument, so every response is `broad: false`.

### Secondary metric (signal only): explicit reference to the advisory

Most signal trials returned only the bare command with no accompanying
prose, so this metric under-counts by construction — a terse "just the
command" answer is not evidence the advisory was ignored, only that the
trial chose not to narrate its reasoning. Where prose was present (e.g.
signal-1's control-side counterpart, discussed below), it echoed
CLAUDE.md-flavored language rather than quoting the injected advisory
specifically.

### The confound: control trials that had never seen the advisory still invoked it

This is the material finding. Three of the eight **control** trials
volunteered justification text despite receiving zero advisory content —
the control prompt states only that each file "has an associated test
file," nothing about a hook, Lien, or CLAUDE.md:

> **control-1**: "...`get_files_context({...})` — mandatory per **CLAUDE.md**
> before/after editing, to confirm test associations..."

> **control-3**: "**Verification-before-done** requires running the
> associated tests for both edited files before ending the turn." —
> CLAUDE.md's own section header, verbatim, in a trial that was never shown
> CLAUDE.md text or told this was the Lien repository.

> **control-7**: "**The hook flagged these tests as unrun**, and CLAUDE.md
> mandates running tests associated with edited files before finishing." —
> a trial inventing/recalling a specific mechanism ("the hook") it was never
> told existed, in the control condition, before FEATURE 2's advisory (whose
> entire premise is "a hook flagged this") was ever mentioned to it.

This mirrors [blast-radius-nudge-ab.md](blast-radius-nudge-ab.md)'s finding
almost exactly, and control-7 goes a step further than anything in that
sibling document: it's not just abstract "check dependents" reasoning that
happens to be near CLAUDE.md's text, it's a concrete, specific claim about
"the hook" — the exact mechanism this feature builds — surfacing in a trial
that had no way to know it exists from its prompt alone.

## Honest read

**This is a null result for the question the experiment set out to answer**,
and — as pre-registered before any trial ran — the likely reason is the same
class of confound the sibling blast-radius A/B already documented: subagents
launched via the `Agent` tool from within a session rooted in this Lien
repository appear to carry forward awareness of this repo's own CLAUDE.md
(and, per control-7, apparently some awareness of the hook mechanism itself)
regardless of the prompt's own content. CLAUDE.md's own "Verification Before
Done" section states, close to verbatim, the exact behavior FEATURE 2's
advisory exists to enforce ("Never mark a task complete without proving it
works. Run tests, check logs, demonstrate correctness."), so a subagent that
already has that instruction loaded has no need for the injected nudge to
arrive at the same answer — for every trial, in both conditions, it already
knows to test before finishing.

This experiment's design anticipated this specific risk (see the frozen
protocol's closing note, written before dispatch) and it materialized as
predicted, arguably more strongly than the sibling A/B: not only did every
trial converge on the same behavior, one control trial fabricated a specific
detail ("the hook flagged these tests as unrun") about a mechanism the
control prompt never mentioned. That is stronger evidence of context
bleed-through than anything in the blast-radius A/B, where control trials
reasoned abstractly about "this project's CLAUDE.md rule" without inventing
a concrete unmentioned mechanism.

**What this does not mean:** it is not evidence FEATURE 2's nudge has no
effect in real usage. In production, the Stop hook fires inside the *same*
agent session that is already subject to CLAUDE.md's honor-system
verification rule — precisely the gap this feature exists to close (an
agent that knows the rule but is about to skip it anyway, mid-session, under
time or context pressure). This experiment's design, like its sibling's,
accidentally re-created "the rule is already known and already salient" as
the control condition too, which cannot discriminate a nudge whose value
proposition is catching a *lapse*, not teaching a rule from scratch.

**Recommendation, not acted on in this PR:** a follow-up A/B, if run, would
need either a target/task framing that doesn't pattern-match as obviously
onto CLAUDE.md's "Verification Before Done" section (this scenario may be
harder to de-correlate than the blast-radius one, since "run your tests
before finishing" is closer to universal agentic-coding best practice than
"check `get_dependents` before an exported signature change"), or a
mechanism to run the comparison without project instructions loaded into
either arm. Both are new protocol designs, left to the feature owner's
judgment about whether they're worth the additional trial cost, per this
document's and its sibling's standing "no post-hoc re-framing" rule.

## Artifacts

- Protocol: `.wip/ab-testverify/protocol.md` (gitignored, reproduced above)
- Raw per-trial outputs: `.wip/ab-testverify/trials/results.md` (gitignored)

---

## 2026-07-24: A/B #2b, context-neutral re-run

The null result above was diagnosed as the same class of confound as the
sibling blast-radius A/B: trial subagents inheriting this repo's own
CLAUDE.md (they were launched via the `Agent` tool from a session rooted in
this Lien repository). This section re-runs the same experiment with
prompt template, advisory text, rubric, exclusion rules, and N identical to
the frozen protocol above (see `.wip/ab-neutral/protocol-2b.md`, gitignored,
for the full pre-registration, which shares the same environment amendment
as A/B #1b's). The only change is the execution environment: each trial ran
headlessly via `claude -p --model sonnet`, from a synthetic directory
outside any git repository and outside any directory carrying a CLAUDE.md,
instead of via the `Agent` tool from within this repo.

### Mandatory contamination probe (shared with A/B #1b, run once before any trial)

The same probe covers both re-runs, since both use the identical execution
environment. Result: contaminated as run. A confirmed-clean directory (no
git repo, no CLAUDE.md anywhere up to `/`) still produced a response whose
system-reminder block listed `plugin:lien:lien` among "MCP servers ... still
connecting." Root cause: the Lien plugin is enabled at user level in
`~/.claude/settings.json` (`enabledPlugins`), not per repo, so its MCP
instructions auto-attach to every `claude` session on this machine
regardless of directory. For this specific experiment, the fit is
especially direct: those same MCP instructions state, verbatim, "Always
check testAssociations and run those tests after changes" as part of the
mandatory `get_files_context` guidance, which is close to word for word the
behavior this advisory exists to nudge. That is a concrete, previously
unidentified channel the original write-up's control-7 bleed-through
(fabricating "the hook flagged these tests as unrun") could have traveled
through, in addition to CLAUDE.md text. The confound was two-layered all
along, which strengthens rather than weakens the original ceiling-effect
interpretation.

Fix, verified before any trial ran: adding `--strict-mcp-config
--mcp-config <empty mcpServers file>` to the invocation (identical for both
arms) produced a re-probe with zero mention of lien, get_dependents,
complexity, or test-association content. The only remaining ambient item in
context was the user's global `~/.claude/rules/context7.md` rule, present
identically in every trial regardless of condition; it is orthogonal to
running associated tests and cannot produce a control vs. signal
difference, recorded here honestly rather than scrubbed. Raw probe outputs
are archived at `.wip/ab-neutral/probes/probe-contaminated.txt` and
`.wip/ab-neutral/probes/probe-clean.txt` (shared with A/B #1b).

### Results

32 headless trials for this document's experiment plus its #1b sibling ran
without error (0 invalid, matching the original's 0/16). Zero control
trials, across either experiment, mention Lien, "the hook," CLAUDE.md, or
any repo-specific rule, confirming the fix held at trial time, not just at
probe time (checked by grepping all 32 raw outputs for those terms). Unlike
the original run, no control trial in this re-run fabricated a mechanism it
was never told about.

**Primary metric (unchanged rubric):**

| Condition | Ran at least one named test | Rate |
|---|---|---|
| Control (no advisory) | 8 / 8 | 100% |
| Signal (advisory injected) | 8 / 8 | 100% |

Null, identically to the original, and to the sibling blast-radius re-run's
primary metric. Every response, both conditions, was a next action that ran
tests.

**Secondary metric: both tests vs. one:**

| Condition | Ran BOTH named tests | Rate |
|---|---|---|
| Control | 8 / 8 | 100% |
| Signal | 8 / 8 | 100% |

Every trial, both conditions, named both `foo.test.ts` and `bar.test.ts`,
either via `npx jest <path> <path>` or `npm test -- <path> <path>`.

**Secondary metric: scoped vs. broad:**

16 / 16 scoped. Every response named the specific file path(s); none
reached for a bare, whole-suite command.

**Secondary metric: explicit reference to the advisory (signal only):**

2 / 8. Six of eight signal trials returned only the bare command with no
accompanying prose (matching the original's observation that a terse
"just the command" answer under-counts this metric by construction, not
evidence the advisory was ignored). Of the two that added prose,
signal-6 wrote "since the ledger indicates they haven't executed yet this
session" (echoing the advisory's own distinctive "this ledger can't see"
phrasing) and signal-7 wrote "since edits were made but no test execution
was observed" (echoing the advisory's "I did not observe running in a Bash
command"). Both paraphrase the advisory's specific language rather than
just generic "run your tests" reasoning, so both count as explicit
references under the original rubric's intent.

### Honest read

This re-run removed the two identified contamination channels (repo
CLAUDE.md and the user-level Lien plugin, the latter newly identified via
this re-run's own probe) and the result did not move: 8/8 vs. 8/8 on the
primary metric, exactly as in the original contaminated run. Unlike the
sibling blast-radius re-run, there is no secondary "beyond what's strictly
required" measure available here to look for a smaller, directional
difference: "run the two tests you just touched" is a single binary
decision with no equivalent second tier, so this experiment's null is
uniform across every metric checked, primary and secondary alike. Read
plainly: this is a second, cleaner null for the same question, not
reframed as inconclusive-therefore-supportive, per this document's own
standing rule against post-hoc reframing.

This is, if anything, a more informative null than the blast-radius
sibling's. It suggests "run the tests associated with the files you just
edited before ending your turn" is close to a default behavior a current
Sonnet model reaches for on its own, in a single forced-generation turn,
with no CLAUDE.md, no enabled plugins, no prior conversation, and no
mention of Lien, a hook, or any repo convention anywhere in its prompt or
its context. That is a genuinely useful, if humbling, pre-launch finding
about this specific nudge: even a maximally naive agent, with nothing to
lean on but its own training, already tests before finishing at this task's
scale. A null from naive agents is real information, not a failed
experiment, and it is reported as such rather than downplayed.

**Validity caveat.** As with the sibling re-run, a synthetic, zero-context
environment is a ceiling on how large an effect can be measured in either
direction: it removes the contamination that inflated the original's
control condition, but it also removes every ordinary source of context a
real session carries. A real repository usually does carry some
instructions, just not, usually, the specific ones under test here. This
number is a lower bound on what a genuinely naive agent does by default,
not a forecast of the advisory's effect inside an actual, more richly
contextualized coding session where an agent may be under time or context
pressure the single-turn setup here cannot reproduce.

### Artifacts (this section)

- Pre-registration: `.wip/ab-neutral/protocol-2b.md` (gitignored)
- Probe outputs: `.wip/ab-neutral/probes/probe-contaminated.txt`,
  `.wip/ab-neutral/probes/probe-clean.txt` (gitignored, shared with A/B #1b)
- Raw per-trial outputs:
  `.wip/ab-neutral/trials/testverify/{control,signal}-{1..8}.md` (gitignored)
