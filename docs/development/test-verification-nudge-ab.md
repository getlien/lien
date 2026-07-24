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
(`npm run test -w @liendev/cli -- packages/cli/src/foo.test.ts && npm run
test -w @liendev/core -- packages/core/src/bar.test.ts`, or the same with
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
