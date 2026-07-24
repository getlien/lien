# Behavioral A/B: does the blast-radius warning change what an agent says about callers?

A small, pre-registered experiment testing whether Feature 1's real blast-radius
warning (as rendered by `plugins/claude/hooks/api-delta-write.sh`) measurably
changes whether a Sonnet subagent addresses caller/dependent impact when asked
to change an exported function's signature, relative to an identical prompt
with no warning.

**Headline result: null, for an identified and explained reason.** Both the
primary metric and the "does it flag callers beyond the ones the task itself
requires updating" secondary check came back **8/8 in both conditions** —
every trial, control and signal alike, spontaneously discussed running
`get_dependents` / checking dependents before finalizing, several by name and
several explicitly citing "this project's CLAUDE.md rule" or "this repo's Lien
workflow." The confound: subagents spawned from a session rooted in this
Lien repository appear to inherit this repo's own `CLAUDE.md` (which contains
the exact rule this nudge automates — "run `get_dependents` before renaming,
removing, or changing the signature of any exported function, class, or
interface") regardless of whether the injected warning is present or the task
has anything to do with Lien. This ceiling effect made the chosen protocol
unable to isolate the nudge's marginal effect. See "Honest read" for what this
does and doesn't mean.

## Protocol (pre-registered, frozen before any trial ran)

The full pre-registration lives in `.wip/ab-blast/protocol.md` (gitignored per
this repo's `.wip/` convention; preserved here by reference and reproduced
below for the record).

> ### Hypothesis
>
> Injecting Feature 1's real blast-radius warning (as rendered by
> `api-delta-write.sh`) into a prompt that asks the agent to change an
> exported function's signature increases the rate at which the response
> proactively addresses caller/dependent impact (updates or enumerates call
> sites, or explicitly says it must check dependents before relying on
> callers), vs an identical prompt with no warning.
>
> Null hypothesis: the warning has no effect (or reduces) caller-impact-addressing.
>
> ### Target (frozen, identical in both arms)
>
> A small self-contained TypeScript module, `user-utils.ts`, with one exported
> function `formatUser(user)` and 3 in-file call sites:
>
> ```typescript
> export function formatUser(user) {
>   return `${user.firstName} ${user.lastName}`;
> }
>
> export function renderUserCard(user) {
>   return `<div class="user-card">${formatUser(user)}</div>`;
> }
>
> export function renderUserList(users) {
>   return users.map(u => `<li>${formatUser(u)}</li>`).join('');
> }
>
> export function logUserAction(user, action) {
>   console.log(`${formatUser(user)} performed action: ${action}`);
> }
> ```
>
> Task: "change `formatUser` to take `(user, opts)` and thread `opts` through."
>
> ### Signal warning block (verbatim from the real hook's rendering)
>
> ```
> ⚠ lien: exported signature changed — formatUser (4 dependents, 1 untested, risk medium). Run get_dependents before relying on callers.
> ```
>
> Injected as a `NOTE — Lien's tooling flagged this edit:` paragraph after the
> file, before the task. Control: that block is the empty string. This exact
> template was independently confirmed to match the real hook's output during
> dogfooding (see the PR body): running `api-delta-write.sh` against a real
> signature-changed, enriched, single-symbol case produced the identical
> sentence shape, differing only in symbol name and the actual numbers.
>
> ### Conditions, N, and execution
>
> Byte-identical prompt across both arms except the warning block. N = 8 per
> condition, 16 total. Each trial: one fresh `Agent` call, `subagent_type:
> general-purpose`, `model: sonnet`, no isolation, no repo access (the prompt
> is fully self-contained; no cwd or Lien context was deliberately supplied).
> Instructed not to use tools; compliance verified per-trial via the agent's
> own `tool_uses` metadata (all 16 trials: `tool_uses: 0`).
>
> ### Primary metric
>
> Binary per trial, against a frozen rubric: does the response (a) update or
> enumerate the affected call sites, or (b) explicitly state it should check
> dependents/callers before finalizing? A bare signature change with no
> caller mention = "no".
>
> ### Secondary metrics
>
> Literal mention of "dependents"/"callers"/`get_dependents`; whether the
> injected "1 untested" dependent is specifically acknowledged (signal only,
> since control never sees that number).
>
> ### Exclusion rules
>
> Unparseable output, or evidence of tool use. (None triggered — see Results.)
>
> ### Analysis plan
>
> Report raw rates per condition, no significance testing. A null or reversed
> result is reported as such.

## Results

### Invalid trials

**0 / 16.** Every trial produced a coherent response; every trial's own
metadata reported `tool_uses: 0`, confirming the "no tools" instruction was
honored.

### Primary metric, as literally specified

| Condition | Addressed caller impact (criterion a or b) | Rate |
|---|---|---|
| Control (no warning) | 8 / 8 | **100%** |
| Signal (warning injected) | 8 / 8 | **100%** |

**Null — no observed difference.** Every single trial, in both conditions,
satisfied the primary metric: all 16 updated the 3 in-file call sites (the
literal task requirement — "thread `opts` through" mechanically forces this)
**and** all 16 additionally discussed checking for callers beyond what's
visible in the file, several by explicit reference to `get_dependents` or
this repository's own CLAUDE.md.

### Why criterion (a) turned out not to discriminate

Re-reading the rubric against the actual responses surfaced a task-design
flaw, reported honestly rather than patched after the fact: "thread `opts`
through" **requires** updating the 3 in-file call sites as the core
deliverable of the assigned task. Every minimally-competent completion —
control or signal — therefore satisfies criterion (a) by construction. That
half of the primary metric was never capable of discriminating between
conditions; it measures task compliance, not nudge-driven behavior.

### The real (attempted) discriminator: unprompted `get_dependents`/CLAUDE.md reasoning

Set that design flaw aside and look only at criterion (b) — spontaneous
reasoning about checking dependents/callers *beyond* the visibly-required
call sites. This is genuinely optional; nothing in the task asks for it.

| Condition | Explicitly discussed checking beyond-file callers/dependents | Rate |
|---|---|---|
| Control (no warning) | 8 / 8 | **100%** |
| Signal (warning injected) | 8 / 8 | **100%** |

Still a dead heat. Every control trial, having received **no warning at all**
and a task framed as "a hypothetical internal utils module" with no mention
of Lien, still volunteered language like:

> Control trial 1: "...in the real repo I'd run `get_dependents` on
> `formatUser`, `renderUserCard`, `renderUserList`, and `logUserAction` before
> touching their signatures (**per this project's CLAUDE.md rule**)..."

> Control trial 5: "...**In the real Lien repo, CLAUDE.md mandates running
> `get_dependents`** on each before changing them..."

> Control trial 8: "If this were a real Lien-tracked file, **the project's
> CLAUDE.md** would require running `get_files_context` and `get_dependents`
> on `formatUser` before editing..."

Raw trial text: `.wip/ab-blast/trials/control-{1..8}.md`,
`.wip/ab-blast/trials/signal-{1..8}.md` (gitignored).

### Secondary metric: acknowledging the specific "1 untested" figure

| Condition | Acknowledges the specific "1 untested" dependent | Rate |
|---|---|---|
| Control (no warning) | 0 / 8 | 0% (never given the figure — nothing to acknowledge) |
| Signal (warning injected) | 8 / 8 | 100% |

This is the one clean, unconfounded difference in the dataset — but it's not
informative about the nudge's *persuasive* effect. Control trials had no way
to reference a number they were never shown; signal trials could only be
quoting information handed to them verbatim. It demonstrates the warning's
*numbers were read and repeated*, not that the warning *changed anything the
agent wouldn't otherwise have done*.

## Honest read

**This is a null result for the question the experiment set out to answer**,
and the reason is identifiable rather than mysterious: subagents launched
from within a session whose working directory is this Lien repository appear
to inherit this repo's own `CLAUDE.md` — which already states, near-verbatim,
the exact rule ("run `get_dependents` before ... changing the signature of
any exported function, class, or interface") that Feature 1's warning exists
to reinforce. Every trial, control included, had that rule already loaded
before it ever saw (or didn't see) the injected warning text. That produces a
ceiling effect: there was no headroom left for the warning to move the needle
on "does the agent think about checking dependents," because the answer was
already yes for every trial regardless of condition.

This differs qualitatively from the companion `lien delta` A/B in
[nudge-behavioral-ab.md](nudge-behavioral-ab.md), which ran under the same
"no isolation" subagent setup and did **not** hit this confound — that
experiment's signal was a specific numeric complexity-threshold crossing,
which doesn't textually overlap with any rule already sitting in this
repo's CLAUDE.md, so control trials there had no pre-loaded reason to reason
about it. The blast-radius warning's content, by contrast, restates a rule
CLAUDE.md already states almost word-for-word, so any subagent that has
CLAUDE.md loaded will reflexively invoke it once it recognizes "this is an
exported-signature change" — independent of whether Lien's tooling actually
told it so.

**What this does not mean:** it is not evidence that the nudge has no real
effect in production. In real usage, the nudge fires inside the *same* agent
session that already has CLAUDE.md loaded and is already subject to its
"honor system" — that's precisely the gap this feature exists to close (an
agent forgetting to act on a rule it technically knows). This experiment's
design accidentally re-created "the rule is already known" as the *control*
condition too, which is a different (and less informative) comparison than
"does an agent that has forgotten or is about to skip the rule get pulled
back by seeing the warning." A cleaner test of that specific question would
need either a target/task pairing whose "exported signature changed" shape is
harder for the model to pattern-match onto CLAUDE.md from the task alone (so
control trials don't reflexively cite the rule), or a way to run the
comparison without CLAUDE.md loaded into either arm — neither of which this
protocol, once frozen, could be revised to attempt without violating the "no
post-hoc re-framing" rule the sibling A/B document also holds itself to.

**What the dataset does support:** the warning's numbers were read and acted
on faithfully. Every signal trial correctly identified that the visible 3
call sites don't account for the full "4 dependents" the warning claims, and
7 of 8 explicitly named the "1 untested" dependent as the one needing test
coverage before merging — the warning's content was legible and its specific
claims were taken seriously where they appeared. That's a necessary
precondition for the nudge to work, just not sufficient to demonstrate the
comparative effect this experiment was designed to isolate.

**Recommendation, not acted on in this PR:** a follow-up A/B, if run, should
either pick a target/task shape that doesn't pattern-match onto CLAUDE.md's
already-known rule text, or find a mechanism to exclude project instructions
from the trial subagents' context — both are design changes to a fresh
protocol, not a re-run of this one, and are left to the feature owner's
judgment about whether they're worth the additional trial cost.

## Artifacts

- Protocol: `.wip/ab-blast/protocol.md` (gitignored, referenced above)
- Raw per-trial outputs: `.wip/ab-blast/trials/{control,signal}-{1..8}.md`
  (gitignored)
