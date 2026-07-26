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

---

## 2026-07-24: A/B #1b, context-neutral re-run

The null result above was diagnosed as a ceiling effect caused by trial
subagents inheriting this repo's own CLAUDE.md (they were launched via the
`Agent` tool from a session rooted in this Lien repository). This section
re-runs the same experiment with prompts, target file, warning block,
rubric, exclusion rules, and N identical to the frozen protocol above (see
`.wip/ab-neutral/protocol-1b.md`, gitignored, for the full pre-registration).
The only change is the execution environment: each trial ran headlessly via
`claude -p --model sonnet`, from a synthetic directory outside any git
repository and outside any directory carrying a CLAUDE.md, instead of via
the `Agent` tool from within this repo.

### Mandatory contamination probe (run before any trial)

Before pre-registering, a probe was run against the planned invocation from
a confirmed-clean directory (no git repo, no CLAUDE.md anywhere up to `/`).
The probe asked the model to quote, verbatim, any project instructions or
repo-specific rules present in its context.

Result: contaminated. The response's own system-reminder block listed
`plugin:lien:lien` among "MCP servers ... still connecting," even though the
directory had no git repo and no CLAUDE.md. Root cause: the Lien plugin is
enabled at user level in `~/.claude/settings.json` (`enabledPlugins`), not
per repo, so its MCP instructions (which state, verbatim, "REQUIRED before
renaming, removing, or changing the signature of any exported symbol:
get_dependents(...)") auto-attach to every `claude` session on this machine
regardless of directory. This is a second, independent contamination
channel from the one originally diagnosed (repo CLAUDE.md inheritance): the
confound was two-layered all along. The original A/B #1 trials, launched
from a session with this same plugin enabled, carried both layers at once,
which strengthens rather than weakens the original ceiling-effect
interpretation.

Fix, verified before any trial ran: adding `--strict-mcp-config
--mcp-config <empty mcpServers file>` to the invocation (identical for both
arms) produced a re-probe with zero mention of lien, get_dependents,
complexity, or test-association content. The only remaining ambient item in
context was the user's global `~/.claude/rules/context7.md` rule (fetch
current docs via Context7 MCP for library/framework questions), present
identically in every trial regardless of condition; it is orthogonal to
caller-impact checking and cannot produce a control vs. signal difference,
recorded here honestly rather than scrubbed. Raw probe outputs (both the
contaminated run and the verified-clean run) are archived at
`.wip/ab-neutral/probes/probe-contaminated.txt` and
`.wip/ab-neutral/probes/probe-clean.txt`.

### Results

32 headless trials for this document's experiment plus its #2b sibling ran
without error (0 invalid, matching the original's 0/16). Zero control
trials, across either experiment, mention Lien, CLAUDE.md, get_dependents,
or any repo-specific rule, confirming the fix held at trial time, not just
at probe time (checked by grepping all 32 raw outputs for those terms).

**Primary metric, as literally specified (criterion a or b):**

| Condition | Addressed caller impact | Rate |
|---|---|---|
| Control (no warning) | 8 / 8 | 100% |
| Signal (warning injected) | 8 / 8 | 100% |

Same non-discrimination as the original, and for the same reason: "thread
`opts` through" mechanically forces every competent completion to update the
3 in-file call sites (criterion a), so this half of the metric still cannot
discriminate between conditions. Not new information; reproduced here for
completeness.

**The real discriminator: spontaneous reasoning about callers beyond the 3
visible in-file call sites (criterion b alone):**

| Condition | Explicitly discussed beyond-file callers/dependents | Rate |
|---|---|---|
| Control (no warning) | 7 / 8 | 87.5% |
| Signal (warning injected) | 8 / 8 | 100% |

This is a small, directional difference (one trial), not the 8/8 vs. 8/8
dead heat the original (contaminated) run produced. Every signal trial
explicitly flagged that the file's 3 visible call sites don't account for
the warning's claimed "4 dependents" and recommended locating the 4th (five
of eight named `get_dependents` specifically, echoing the warning's own
wording, which is expected since the tool name is literally in the injected
text). Seven of eight control trials, despite never seeing any dependent
count or tool name, independently raised the general risk that "any code
outside this file" or "external callers" of the four exported functions
would need auditing, in generic language with no mention of Lien or any
specific tool. One control trial (control-8) did not raise this at all.

With N=8 per arm, a 7/8 vs. 8/8 split is not a result that supports a lift
claim: it could easily reverse on a re-roll. It is reported plainly, not
inflated. What it does establish, cleanly, is that in a genuinely
context-free environment, most naive agents (not just contaminated ones)
already reason about beyond-file caller impact when asked to change an
exported function's signature, control or signal alike. That is a different
and more interesting finding than the original's ceiling effect: it
suggests this specific caller-impact instinct is close to a baseline
property of the model on this kind of task, not solely an artifact of
repo-specific instructions or of Lien's plugin. The signal condition's 8/8
sits at the same ceiling as control's 7/8, so this run still cannot cleanly
isolate the warning's marginal lift over that baseline; it only narrows how
much headroom there was to move.

**Secondary metric: acknowledging the specific "1 untested" dependent
(signal only, unchanged rubric):**

| Condition | Acknowledges "1 untested" specifically | Rate |
|---|---|---|
| Control (no warning) | 0 / 8 | 0% (never shown the figure) |
| Signal (warning injected) | 8 / 8 | 100% |

Identical to the original: every signal trial read and repeated the
warning's specific numbers faithfully. As before, this shows the warning's
content is legible, not that it changed behavior the agent wouldn't
otherwise have reached.

### Honest read

This re-run removed the two identified contamination channels (repo
CLAUDE.md and the user-level Lien plugin) and still could not produce a
clean control vs. signal separation on the primary metric: both remain at
100%, because the task itself forces criterion (a). On the sharper
criterion (b) measure, the gap narrowed from 8/8 vs. 8/8 (original,
contaminated) to 7/8 vs. 8/8 (this run, verified clean), a one-trial
difference that is directionally consistent with the warning having some
effect but is far too small, at N=8, to call a result. Read plainly: this is
a second null for the question this protocol was designed to answer,
arrived at with a materially cleaner environment than the first attempt,
and it is reported as a null rather than reframed as inconclusive-therefore-
supportive, per this document's own standing rule against post-hoc
reframing.

**Validity caveat.** This is not a literally zero-context environment: the
user's ambient `~/.claude/rules/context7.md` rule remained active throughout
(see above), unrelated to either nudged behavior but present nonetheless.
What was actually achieved is an environment free of repository context,
CLAUDE.md, and the Lien plugin (no enabled plugins, no prior conversation,
single forced generation turn), which is a ceiling on how large a nudge's
measured effect can be in the other direction too: it removes not only the
contamination that produced the original's false ceiling, but also every
ordinary source of context a real coding session carries (a real project's
own conventions, prior turns, accumulated task framing). A real repository
usually does carry some instructions, just not, usually, the specific ones
under test here. So this number should be read as a lower bound on what a
genuinely naive agent does by default, not as a forecast of the nudge's
effect inside an actual, more richly contextualized coding session. An
environment free of repository, CLAUDE.md, and Lien-plugin context is a
floor for isolating the mechanism, not a simulation of production use.

### Artifacts (this section)

- Pre-registration: `.wip/ab-neutral/protocol-1b.md` (gitignored)
- Probe outputs: `.wip/ab-neutral/probes/probe-contaminated.txt`,
  `.wip/ab-neutral/probes/probe-clean.txt` (gitignored)
- Raw per-trial outputs: `.wip/ab-neutral/trials/blast/{control,signal}-{1..8}.md`
  (gitignored)

---

## 2026-07-26: A/B v2 (task-decoupled) — the discriminating re-run **separates**

Both prior sections returned nulls diagnosed as **task-forcing**: the target's callers
were visible in-file and the task ("thread `opts` through") *required* touching them, so
caller-checking *was* the task and the warning had no headroom. The v2 protocol —
frozen pre-registration in
[nudge-ab-v2-protocol.md](nudge-ab-v2-protocol.md) — removes that confound. The changed
symbol's dependents live in **other directories** (`src/checkout/cart.ts`,
`src/reports/invoice.ts`) with nothing in the edited file hinting at them; the task is a
plain feature request ("add an optional minimum-price floor to `applyDiscount`") that
never mentions callers or risk; and the primary metric is raised from *sentiment* to
**concrete action** — the agent must actually search for / open / name a specific
out-of-directory dependent. Generic "other callers may need updating" hedging (the prior
run's 7/8 ceiling) explicitly does **not** count.

**Result: the blast warning separates.**

| Condition | Concrete beyond-file caller action | Rate |
|---|---|---|
| Signal (`LIEN_BLAST_HOOK` on) | 10 / 10 | **100%** |
| Control (`LIEN_BLAST_HOOK` off) | 3 / 10 | **30%** |

One-sided Fisher exact **p = 0.0015** — the pre-registered separation threshold
(p < 0.05) is met, so this document's standing launch rule now **permits a lift claim**
for this nudge. Every signal trial grepped for `applyDiscount` and named the specific
out-of-directory dependents; the 3 control hits are the real, non-zero baseline (some
agents check callers unprompted), but 7 of 10 do not when the task doesn't demand it and
the dependents aren't visible in the edited file. This is the first clean separation in
the series, and it confirms the prior nulls were the task-forcing artifact, not evidence
the warning is inert.

**Environment (mechanism b', see protocol §3).** 20 headless `claude -p --model sonnet`
trials (10/arm, seeded interleave), from fixture sandboxes with no `CLAUDE.md`; the
**default** config dir (Keychain auth) with the ambient `lien@lien` plugin disabled
per-invocation via a `--settings enabledPlugins` override (saved settings byte-identical
before/after), `--strict-mcp-config` (so `get_dependents` itself isn't available — the
signal agents grepped instead, making this rate a **lower bound** vs production where the
tool exists), scoped `acceptEdits` + explicit allowlist. 0 invalid, 0 logged-out, 0
timed-out, **0 tool denials** (symmetric). Recap held off in both arms, so the edit-time
warning is the *only* blast delivery.

**Contamination:** 0/10 OFF trials in this experiment on a word-boundary re-scan (0/20
across both experiments). The runner's raw substring scan flagged all 10/10 — every hit
the substring `lien` inside the ambient skill name `…client…` the default config dir
exposes; symmetric across arms, outside the primary metric. Reported raw-and-corrected
per the honesty rule.

**Validity audit (post-review).** A review flagged that the runner hardcoded OFF-arm
validity to `true`, asymmetric with the signal arm's edit-completed gate — so a control
*no-op* would have scored as a MISS rather than INVALID. Re-scoring every blast trial in
**both** arms under a symmetric rule — did the agent's edit actually change
`applyDiscount`'s signature (the same `api-delta` oracle the signal arm used)? — confirms
**all 20 trials completed the task edit, 0 no-ops in either arm**, so the counts are
unchanged. An offline re-run of the *corrected* scoring pipeline over the archived
transcripts reproduces the published counts exactly (10/10 vs 3/10, p = 0.001548 — the
0.0015 above was 4-dp rounding). The runner has been fixed to gate both arms
symmetrically. Evidence is in the PR transparency note. The user's ambient
`~/.claude/rules/context7.md` and other non-Lien plugins' skill lists are present
identically in both arms (unrelated to caller-checking).

**Validity caveat (unchanged from #844).** This is a lower-bound environment — no
CLAUDE.md, no Lien plugin, single-repo sandbox — a floor for isolating the mechanism,
not a forecast of the effect inside a richly-contextualized production session. A clean
separation here is strong evidence the nudge moves behavior; it does not by itself
quantify the production lift.

Artifacts: pre-registration `docs/development/nudge-ab-v2-protocol.md`; runner
`scripts/experiments/nudge-ab-v2/`; raw per-trial transcripts + verdicts + summary under
`.wip/nudge-ab-v2/blast/` (gitignored).
