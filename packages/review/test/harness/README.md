# Agent-Rule Test Harness

Replay code-review fixtures through the agent plugin's prompts to validate
prompt changes offline. Two modes — pick the right one for the task:

| Mode               | Entry                                            | Model                              | Cost             | Use when                                |
| ------------------ | ------------------------------------------------ | ----------------------------------- | ---------------- | --------------------------------------- |
| **CC iteration**   | `/test-harness <rule>`                           | Claude (subagent)                   | Free             | Authoring / iterating on a prompt       |
| **OpenRouter run** | `npm run test:harness -w @liendev/review`        | `moonshotai/kimi-k2.7-code` (prod default) | ~$0.05/run       | Final verification / 9/10 bar           |
| **CI dispatch**    | Run "Agent-Rule Test Harness (LLM)" workflow     | `moonshotai/kimi-k2.7-code` (prod default) | ~$0.05/run       | Repeatable verification                 |

**The 9/10 reliability bar is measured in OpenRouter mode only, against the
prod default model** (`moonshotai/kimi-k2.7-code`, from
`packages/review/src/defaults.ts` — the harness resolves to it whenever
`--model` is omitted). Claude is materially smarter than Kimi, so a passing
CC run does not certify production behavior. Always re-calibrate against
OpenRouter before merging a prompt change. (Issue #538.)

Pass `--model <slug>` to calibrate against a different model (e.g. for an
A/B comparison, or to reproduce the historical Gemini baseline some older
canaries were tuned against — see "Known-red reconciliation" below).

## Quick start

The harness auto-loads `OPENROUTER_API_KEY` from `.env` at the repo root via
`process.loadEnvFile()` — set it once, run anywhere:

```bash
# One-time setup (or use the existing platform .env)
echo 'OPENROUTER_API_KEY=sk-or-v1-…' >> .env

# 1. Free CC iteration (in a Claude Code session):
/test-harness boundary-change

# 2. Calibration baseline (the 9/10 bar):
npm run test:harness -w @liendev/review -- --rule boundary-change --calibrate 10

# 3. Run a single fixture with K=3 voting:
npm run test:harness -w @liendev/review -- \
  --fixture test/harness/fixtures/boundary-change/<name>.fixture.json --votes 3
```

An inline `OPENROUTER_API_KEY=…` still wins over the `.env` value if you want
to override per-invocation (e.g., to test against a different account's quota).

## Canary corpus

One captured fixture per `BUILTIN_RULES` rule, all from closed planted-regression
test PRs in this repo. Each fixture is gitignored (regenerate with
`capture-pr.ts`), but the `.assertions.ts` is committed and tagged `canary`:

| Rule                  | PR    | Fixture                                                      |
| --------------------- | :---: | ------------------------------------------------------------ |
| `boundary-change`     | #520  | `boundary-change/ge-5-threshold-shift`                       |
| `structural-analysis` | #399  | `structural-analysis/removed-export`                         |
| `edge-case-sweep`     | #509  | `edge-case-sweep/percent-change-sign-flip`                   |
| `concurrency-race`    | #511  | `concurrency-race/credit-service-toctou`                     |
| `incomplete-handling` | #437  | `incomplete-handling/enum-variant-removed`                   |
| `error-swallowing`    | #411  | `error-swallowing/payment-error-swallowed`                   |
| `stale-duplicate`     | #539  | `stale-duplicate/model-partial-update` (capture at `--sha f780541`) |
| `untrusted-input-validation` | #541 | `untrusted-input-validation/harness-initial` (capture at `--sha 7cb0149`) |
| `doc-truth`           | #658  | `doc-truth/pr658-search-code-rename`                          |

Regenerate the whole corpus:

```bash
ROOT=packages/review/test/harness/fixtures
npx tsx packages/review/test/harness/capture-pr.ts 520 "$ROOT/boundary-change/ge-5-threshold-shift.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 399 "$ROOT/structural-analysis/removed-export.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 509 "$ROOT/edge-case-sweep/percent-change-sign-flip.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 511 "$ROOT/concurrency-race/credit-service-toctou.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 437 "$ROOT/incomplete-handling/enum-variant-removed.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 411 "$ROOT/error-swallowing/payment-error-swallowed.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 539 "$ROOT/stale-duplicate/model-partial-update.fixture.json" --sha f780541
npx tsx packages/review/test/harness/capture-pr.ts 541 "$ROOT/untrusted-input-validation/harness-initial.fixture.json" --sha 7cb0149
npx tsx packages/review/test/harness/capture-pr.ts 658 "$ROOT/doc-truth/pr658-search-code-rename.fixture.json"
```

## Negative-regression fixtures

These capture real-world false positives the rule produced on a non-bug
PR. The assertion is `expectEmpty` — the rule must stay quiet on this
diff. Bundled with the canary so calibration covers both directions
(must-fire on planted regressions, must-stay-silent on these).

| Rule | PR | Fixture | Why |
|---|---|---|---|
| `error-swallowing` | #574 | `error-swallowing/scanall-null-guard-fp` | Early `if (!table) throw` before try/catch was flagged as unguarded deref ([thread](https://github.com/getlien/lien/pull/574#discussion_r3252525960)) |
| `error-swallowing` | #575 | `error-swallowing/harness-gitignore-convention-fp` | Gitignored `.fixture.json` (per project-wide convention) flagged as missing test data ([thread](https://github.com/getlien/lien/pull/575#discussion_r3252554373)) |

Regenerate:

```bash
ROOT=packages/review/test/harness/fixtures
npx tsx packages/review/test/harness/capture-pr.ts 574 "$ROOT/error-swallowing/scanall-null-guard-fp.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 575 "$ROOT/error-swallowing/harness-gitignore-convention-fp.fixture.json" --sha b1e36fc
```

## Documented-miss fixtures (real bugs, not yet reliably caught)

These capture a real bug from a merged PR that another reviewer (CodeRabbit)
caught but Lien Review missed — filed under the existing rule whose mandate
is the closest match, so the fixture is ready the moment someone iterates on
that rule's prompt. Unlike the canary corpus, these are **not** claimed to
pass `--calibrate 10` today; that's the point of capturing them. Not tagged
`canary` (no green baseline to protect from drift yet) — see each fixture's
own doc comment for exactly which mechanism (deterministic-scan gap,
diff-render truncation, missing parser support, etc.) keeps the current
prompt/pipeline from reaching it.

| Rule | PR | Fixture | Why |
|---|---|---|---|
| _(none currently)_ | | | The one entry this table used to carry — `doc-truth/pr658-search-code-rename` — was **promoted to the canary corpus on 2026-07-04** (see the table above): a `--calibrate 10` run scored 10/10 on Finding A and, after re-verifying via `build-prompts.ts` that the guidance-surface passthrough (#665) now carries the fixture's second real finding (`plugins/claude/hooks/augment-explore-task.sh:64`) into the prompt, 9/10 votes from that same calibration run independently reproduced it too — so it's now asserted (Tier 2) alongside Finding A rather than only documented. Full evidence chain and per-run breakdown live in the fixture's `.assertions.ts` header comment. |

Run the full multi-model sweep:

```bash
OPENROUTER_API_KEY=… ./packages/review/test/harness/sweep.sh
# or with custom models:
OPENROUTER_API_KEY=… ./packages/review/test/harness/sweep.sh anthropic/claude-haiku-4.5 deepseek/deepseek-chat-v3.1
```

## Captured fixtures aren't committed (size)

Snapshot-captured fixtures are typically 10MB+ (a full repo's `repoChunks`).
They're gitignored — regenerate locally via `capture-pr.ts`:

```bash
npx tsx packages/review/test/harness/capture-pr.ts 520 \
  packages/review/test/harness/fixtures/boundary-change/ge-5-threshold-shift.fixture.json
```

The capture is deterministic given the same PR head SHA and parser version,
so the fixture is reproducible. A leftover git worktree at
`/tmp/lien-capture-<sha>` is reused on re-runs (clean up with
`git worktree remove --force <path>` when done).

**Prerequisite: the native parser must be built** in the checkout you capture
from (`npm run build:native -w @liendev/parser-native` — the binding is
gitignored and per-worktree). Without it, every AST-language file silently
chunks to zero and the fixture's corpus ends up markdown/Vue-only (~800
chunks instead of ~5300). `capture-pr.ts` now fails loudly on that signature
(`assertIndexComplete`) instead of writing a partial fixture.

Hand-authored placeholder fixtures (small, committed) live alongside.

## Layout

```text
packages/review/test/harness/
  run.ts                # OpenRouter CLI entrypoint
  runner.ts             # drives a single fixture against AgentReviewPlugin
  build-prompts.ts      # emits {systemPrompt, initialMessage} for any fixture
  assert-cli.ts         # runs an .assertions.ts module against a result JSON
  assertions.ts         # tiered helpers (expectRuleFired, expectFindingMentions, …)
  voting.ts             # K-of-M voting and N-run calibration
  fixture-loader.ts     # JSON fixture I/O with Map / Set tagging
  reporter.ts           # text / JSON output
  tsconfig.json         # harness typecheck (npm run typecheck:harness)
  fixtures/
    <rule-id>/
      <scenario>.fixture.json     # serialized ReviewContext
      <scenario>.assertions.ts    # what to expect — default-export FixtureAssertions
```

## Fixture format

A fixture is a JSON serialization of a `ReviewContext`, the same object the
review engine builds before invoking the agent plugin. Maps and Sets are
tagged so JSON round-trips preserve them:

```jsonc
{
  "chunks": [...],          // CodeChunk[] — changed-file AST chunks
  "changedFiles": [...],
  "complexityReport": {...},
  "baselineReport": null,
  "deltas": null,
  "pluginConfigs": {},
  "config": {},
  "pr": {
    "owner": "...",
    "patches": { "__type": "Map", "entries": [["src/foo.ts", "@@ -1 +1 @@\n..."]] },
    "diffLines": { "__type": "Map", "entries": [["src/foo.ts", { "__type": "Set", "values": [12, 13] }]] }
  },
  "repoChunks": [...],      // full-repo CodeChunk[] — what AgentReviewPlugin investigates
  "repoRootDir": "/path/to/checked-out/pr/branch"
}
```

You can author one by hand for narrow scenarios, but per the reliability
section in #538 the **first non-trivial fixture per rule must be snapshot-captured
from a real PR.** Hand-authored fixtures are too clean and miss
real-world chunk noise; the captured snapshot anchors realism.

### Capturing a fixture from a real PR

The runner will dump its post-index `ReviewContext` to disk if you set
`LIEN_REVIEW_CAPTURE_CTX`:

```bash
# Locally check out the PR you want to snapshot
gh pr checkout 520

# Run the runner / CLI review path with the env var set.
# Capture happens inside engine.ts after lazy repo indexing finishes,
# so the dump includes repoChunks.
LIEN_REVIEW_CAPTURE_CTX=/tmp/pr520.json \
  <invocation that calls ReviewEngine.run for that PR>

# Inspect what was captured
jq '.pr.title, (.repoChunks | length), (.chunks | length)' /tmp/pr520.json

# Move it into place and author the assertions
mkdir -p packages/review/test/harness/fixtures/<rule>/
mv /tmp/pr520.json packages/review/test/harness/fixtures/<rule>/<scenario>.fixture.json
$EDITOR packages/review/test/harness/fixtures/<rule>/<scenario>.assertions.ts
```

Once captured, you can edit `repoRootDir` to a path that exists on the
machine running the harness (so `read_file`-style tools can resolve), or
leave it pointing at the original checkout — the harness will surface read
errors but not crash.

## Assertions — tiers

| Tier | Stable at T=0? | Helper                                    | Use for                            |
| ---- | -------------- | ----------------------------------------- | ---------------------------------- |
| 1    | Yes            | `expectRuleFired`, `expectEmpty`,         | "rule fires", "no findings",       |
|      |                | `expectFindingsCount`, `expectToolCalled` | "tool was called"                  |
| 2    | Mostly         | `expectFindingMentions(['kw1','kw2',…])`  | Prompt-tweak wording verification  |
| 3    | No             | (intentionally not exposed)               | —                                  |

Tier 2 takes a list of accepted phrasings, not one exact string. Pick 2–4
keywords that any correct rendering would use (e.g.,
`['test pair', 'both sides', 'divergence']`).

A fixture's `.assertions.ts` default-exports:

```ts
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description: 'PR #520 — > 5 → >= 5 in classifyLevel',
  rule: 'boundary-change',
  expect: (result, h) => {
    h.expectRuleFired('boundary-change', result);
    h.expectToolCalled('get_files_context', result);
    h.expectFindingMentions(['test pair', 'both sides', 'divergence'], result);
  },
  votes: 3,
  passThreshold: 9, // out of 10 calibration runs
  tags: ['canary'],
};

export default assertions;
```

`tags: ['canary']` marks a fixture as a drift signal — when multiple
canaries flip simultaneously after a model update, the harness should be
re-baselined under human review, not silently re-pinned.

## The 9/10 reliability bar (#538)

Before declaring the harness "trusted" for any rule:

1. Run `--calibrate 10` against the unmodified rule prompt. Pass rate must
   be ≥ 9/10. If lower, the assertion is too tight or the fixture is too
   ambiguous — iterate.
2. After making a prompt change, run `--calibrate 10` against the new prompt
   with the new assertion. Same ≥ 9/10 bar.
3. If either is below the bar, do **not** ship the prompt change. Document
   the failure mode and iterate via CC mode first, then re-calibrate.

This bar is what gates the harness from "shipped" to "trusted for the
parked prompt-tweak issues" (#284, #286, #287, #288, #289, #302, #339, and
the §4.3 "test pair" tweak in `.wip/retro-blast-radius.md`).

### Known-red reconciliation: resolved 2026-07-10

The corpus previously carried two canaries flagged "known-red on Kimi"
(`stale-duplicate/model-partial-update` and
`untrusted-input-validation/harness-initial`), attributed to drift from the
Kimi cutover (#592). A dedicated reconciliation found neither was a model
capability gap:

- **untrusted-input-validation** — the assertion demanded
  `get_files_context` while the rule prompt offers "get_files_context (or
  read_file)"; correct Kimi runs failed Tier 1 purely on tool choice
  (7/10, all misses `read_file`-only with Tier-2-passing findings). Fixed by
  `expectAnyToolCalled(['get_files_context', 'read_file'])`. **10/10 on Kimi**
  (2026-07-10, healthy fixture).
- **stale-duplicate** — red only when replayed against a *broken capture*: a
  fixture whose corpus was markdown/Vue-only because the native parser wasn't
  built at capture time, so `<stale_literal_candidates>` rendered "None" and
  suppressed the finding. With a healthy capture the deterministic scan finds
  the candidate and the rule is **10/10 on Kimi** (2026-07-10). `capture-pr.ts`
  now fails loudly on partial-index captures (`assertIndexComplete`).

Also reconciled the same day: `error-swallowing/scanall-null-guard-fp`'s
header claimed it "will fail on the current prompt" — that was true on
Gemini (2026-05-16) but the gap is closed on Kimi: **10/10 empty**, no prompt
change needed. `payment-error-swallowed` **10/10**,
`harness-gitignore-convention-fp` **9/10** (single miss was a stray
`incomplete-handling`-labeled finding).

The calibration bars are unchanged: **touching an existing rule's prompt**
requires ≥ 9/10 on the rule(s) you actually changed. **Full-corpus changes**
(model swap, shared prompt scaffolding) require **no regression vs main's
pass/fail pattern**, checked by running the sweep (`sweep.sh`, or
`--calibrate 10` with no `--rule` filter) on both branches and diffing which
fixtures flip. Before trusting any red, verify the fixture is a healthy
capture (the capture guard now enforces this at capture time).

## Runbook: §4.3 boundary-change "test pair" tweak

The motivating example for #538. To execute:

1. **Snapshot fixture** — capture PR #520 ctx via the steps above. Save
   under `fixtures/boundary-change/ge-5-threshold-shift.fixture.json` and
   author `ge-5-threshold-shift.assertions.ts` with Tier 1 assertions only
   (`expectRuleFired`, `expectToolCalled('get_files_context')`).
2. **Baseline calibration** — `npm run test:harness -w @liendev/review --
   --rule boundary-change --calibrate 10`. Confirm ≥ 9/10. If not, tighten
   assertions.
3. **Apply §4.3 prompt change** — edit `BOUNDARY_CHANGE.prompt` in
   `packages/review/src/plugins/agent/rules.ts`: add a sentence requiring
   tests for **both sides** of the divergence, and update the worked
   example accordingly.
4. **Add Tier 2 assertion** — extend the `.assertions.ts` `expect` to
   `h.expectFindingMentions(['test pair', 'both sides', 'divergence'], result)`.
5. **Re-calibrate** — `--calibrate 10` again. Confirm ≥ 9/10 on the new
   assertion.
6. **Land the PR** — paste the calibrate output into the PR description as
   evidence. Bundle the rule change, the new fixture, and the new assertion
   in one commit.

## Workflow: adding a new rule

This is the end-to-end recipe a rule author (human or agent) follows. The
harness lets you do it autonomously once `OPENROUTER_API_KEY` is in `.env`.

1. **Find a candidate PR.** Look for a closed planted-regression PR that
   exhibits the pattern the rule should catch. The repo has a tradition
   of these (#519, #520, #399, #509, #437, #411, #511 are all "test:" or
   small synthetic-bug PRs). `gh pr list --state closed --search "test:"`
   is a good starting query. Pick one with <500 changed lines if possible
   — the agent's investigation is faster on smaller diffs. No real PR fits?
   `lien-review-testbed/` at the repo root is a tracked multi-language sample
   app kept as fixture material — not wired into any existing fixture, but
   available to plant a synthetic regression in and capture against.

2. **Capture the fixture.** From the repo root:

   ```bash
   npx tsx packages/review/test/harness/capture-pr.ts <pr-num> \
     packages/review/test/harness/fixtures/<rule-id>/<scenario>.fixture.json
   ```

   `capture-pr.ts` clones the PR head into a `/tmp/lien-capture-<sha>` git
   worktree, indexes it, and writes the JSON. The worktree stays in place
   so the harness can resolve `repoRootDir` for tool calls; clean up with
   `git worktree remove --force <path>` when done.

3. **Author Tier 1 assertions.** Create the sibling
   `<scenario>.assertions.ts`. Start with just `expectRuleFired` and
   `expectToolCalled` for whatever tool the rule's prompt mandates.
   Don't add Tier 2 keyword checks until after baseline calibration is
   green — they're what proves the prompt produces the *right* finding,
   and you need a reliable Tier 1 first.

4. **Add the rule to `BUILTIN_RULES`** in
   `packages/review/src/plugins/agent/rules.ts`. Mirror the existing
   shape: `id`, `name`, `prompt`, optional `example`, `triggers`. The
   prompt is the lever — start by copying a similar existing rule's
   structure.

5. **Iterate via CC mode (free).** Open a Claude Code session, run
   `/test-harness <rule-id>`. The Skill spawns a Claude subagent per
   fixture and reports pass/fail. Cycle through prompt edits in `rules.ts`
   until CC reliably produces the expected finding. **CC mode is *not*
   sufficient for shipping** — Claude is much smarter than Kimi (the prod
   default), so passing here doesn't certify production behavior. Treat it
   as smoke-testing.

6. **Calibrate against OpenRouter (the gate).**

   ```bash
   npm run test:harness -w @liendev/review -- \
     --rule <rule-id> --calibrate 10
   ```

   The fixture's `passThreshold` (default 9 from `assertions.passThreshold`)
   gates the run. If pass-rate < 9/10, iterate: widen Tier 2 keywords,
   tighten the prompt, or capture a more realistic fixture. Don't ship
   sub-9/10 prompts — that's the discipline that prevents silently flaky
   rules.

7. **Open a PR** with the rule, the new fixture's `.assertions.ts`, and
   the calibrate output pasted into the PR description as evidence.

The whole loop, end-to-end, is ~30 minutes once you have the fixture
captured.

## Failure modes — what each error means

| Error in `failureMessage` | Cause | Action |
|---|---|---|
| `LLM error: API error (403): Key limit exceeded` | Daily-spend cap on the OpenRouter key (set in their dashboard) | Raise the limit, switch keys, or wait until midnight UTC |
| `LLM error: terminated` | OpenRouter killed the request mid-stream — usually upstream (provider) capacity issue, occasionally rate-limit at high concurrency | Retry; if it persists for one specific model, that model is having problems — try another |
| `LLM error: fetch failed` | Network blip between us and OpenRouter | Retry |
| `Tier 1: expected rule 'X' to fire. Got: (no findings)` | Model bailed without producing a finding (silence-mode bias) | Tighten the rule prompt to mandate emission; check `.wip/retro-blast-radius.md` §2.3 |
| `Tier 2: expected at least one finding to mention any of […]` | Rule fired but the suggestion uses different vocabulary | Widen the keyword set, or the prompt is producing wrong-shaped findings |
| `0/10 passed cost $0.0000` | Every call failed silently | Re-run with `--votes 3 --json` and inspect `failureMessage` per vote |

If you can't tell what's happening, `--json` is your friend — pipe through
`jq` and look at each vote's `failureMessage`.

## Debugging a failing vote with `--trace`

When the `failureMessage` alone doesn't tell you why a vote bailed —
typically `Tier 1: ... (no findings)` where the model investigated but
decided silence — capture per-vote traces and compare a passing vote to
a failing one.

```bash
npm run test:harness -w @liendev/review -- \
  --rule concurrency-race --calibrate 10 --trace /tmp/cal-trace
```

Each vote produces `/tmp/cal-trace/<rule>/<scenario>/vote-<N>.json`
containing the rendered system prompt, the rendered initial message, the
full per-turn assistant response (including reasoning prose outside the
JSON fence — normally stripped), and tool-call inputs + outputs.

To compare a passing vote (say vote 3) with a failing one (vote 7):

```bash
npx tsx packages/review/test/harness/compare-votes.ts \
  /tmp/cal-trace/concurrency-race/credit-service-toctou/vote-3.json \
  /tmp/cal-trace/concurrency-race/credit-service-toctou/vote-7.json
```

Output starts with a header (passed?, failure tier, turn count,
tool-call summary for each vote), then prints `diff -u` per turn
between the two response texts. If the systemPrompt or initialMessage
differ across votes (rare for same-fixture voting; common when comparing
across fixtures), those diffs print first.

Typical reads:

- Both votes call the same tools but the failing one's last-turn prose
  says "I could not identify a race condition" — silence-mode bias the
  rule's MUST-emit language didn't overcome.
- The failing vote made fewer tool calls and never opened the file
  containing the bug — the rule's protocol step "MUST call
  get_files_context" needs strengthening.
- Tool output for `read_file` was truncated to 4 KB, missing the lines
  with the bug — investigate whether the fixture's `repoRootDir` is
  correct or the file is huge.

Trace files are typically 10-50 KB per vote (5-15 turns × ~2 KB each
including 4 KB-capped tool outputs). A `--calibrate 10` run on one
fixture writes ~100-500 KB to disk.

## Modes — when to use which

- **`/test-harness <rule>` (CC)** — fast inner loop. Free. Use while
  drafting a prompt change. Catches "the prompt is broken" but not "Kimi
  will misbehave."
- **`npm run test:harness -w @liendev/review -- --votes 3`** — sanity check
  after iterating in CC. ~$0.18 per fixture. Tells you Kimi (the prod
  default) agrees with the assertion at K=3.
- **`npm run test:harness -w @liendev/review -- --calibrate 10`** — the
  9/10 bar. ~$0.50 per
  fixture. **The only mode that gates merging a prompt change.**
- **GitHub workflow ("Agent-Rule Test Harness (LLM)")** — same as
  `--calibrate`, in CI, with the result attached to the workflow run for
  audit. Triggered manually via the Actions UI.

### Cost discipline

`--calibrate 10` runs the real model ~10x per fixture against OpenRouter —
real money, not a free inner loop (~$0.05-0.50/fixture, ~$5-8 for a full
corpus sweep). Before spending another round:

- **Diagnose from existing `--trace` dumps first** (free) — most "why did
  this fail" questions are answerable from a trace already on disk without
  another network call.
- **Stop after one non-converging iteration.** If a prompt/tool-fallback
  change doesn't move the pass rate, don't chain another calibration sweep on
  the same hypothesis — reassess and report the cost spent so far before the
  next round.
- **Prefer a zero-LLM deterministic-signal fix** (see `stale-literal-signals.ts`
  for the pattern) over an LLM-calibration-gated prompt tweak where the
  failure mode is structural, not a reasoning gap — no spend, no flakiness.

## Common failure modes

- `OPENROUTER_API_KEY missing` — the Node CLI requires it. For free
  iteration, use the CC Skill instead.
- Fixture fails schema validation — `fixture-loader.ts` reports which field
  is missing or wrong. Captured fixtures from `LIEN_REVIEW_CAPTURE_CTX`
  should always validate.
- `read_file` errors during a run — the fixture's `repoRootDir` doesn't
  exist on this machine. Either point it at a real checkout or accept that
  read-side tool calls will fail (the model usually proceeds anyway).
- `harness-meta` block missing in CC mode — the subagent didn't follow the
  wrapper template. Re-run; if persistent, simplify the wrapper.
- Calibration <9/10 with Tier 2 keyword check — widen the keyword set to
  include the phrasings the model actually produces. If you have to widen
  to >5 keywords, the prompt itself probably needs work.

## Typechecking

The harness has its own tsconfig because the package's main `tsconfig.json`
excludes `**/*.test.ts` (and the harness lives next to test files):

```bash
npm run typecheck:harness -w @liendev/review
```

Run this whenever you touch a harness file.
