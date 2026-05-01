# Agent-Rule Test Harness

Replay code-review fixtures through the agent plugin's prompts to validate
prompt changes offline. Two modes — pick the right one for the task:

| Mode               | Entry                                            | Model                | Cost             | Use when                                |
| ------------------ | ------------------------------------------------ | -------------------- | ---------------- | --------------------------------------- |
| **CC iteration**   | `/test-harness <rule>`                           | Claude (subagent)    | Free             | Authoring / iterating on a prompt       |
| **OpenRouter run** | `npm run test:harness -w @liendev/review`        | Gemini 2.5 Flash     | ~$0.05/run       | Final verification / 9/10 bar           |
| **CI dispatch**    | Run "Agent-Rule Test Harness (LLM)" workflow     | Gemini 2.5 Flash     | ~$0.05/run       | Repeatable verification                 |

**The 9/10 reliability bar is measured in OpenRouter mode only.** Claude is
materially smarter than Gemini, so a passing CC run does not certify
production behavior. Always re-calibrate against OpenRouter before merging
a prompt change. (Issue #538.)

## Quick start

```bash
# 1. Free CC iteration (in a Claude Code session):
/test-harness boundary-change

# 2. Calibration baseline (the 9/10 bar):
OPENROUTER_API_KEY=… npm run test:harness -w @liendev/review -- \
  --rule boundary-change --calibrate 10

# 3. Run a single fixture with K=3 voting:
OPENROUTER_API_KEY=… npm run test:harness -w @liendev/review -- \
  --fixture test/harness/fixtures/boundary-change/<name>.fixture.json \
  --votes 3
```

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

Regenerate the whole corpus:

```bash
ROOT=packages/review/test/harness/fixtures
npx tsx packages/review/test/harness/capture-pr.ts 520 "$ROOT/boundary-change/ge-5-threshold-shift.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 399 "$ROOT/structural-analysis/removed-export.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 509 "$ROOT/edge-case-sweep/percent-change-sign-flip.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 511 "$ROOT/concurrency-race/credit-service-toctou.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 437 "$ROOT/incomplete-handling/enum-variant-removed.fixture.json"
npx tsx packages/review/test/harness/capture-pr.ts 411 "$ROOT/error-swallowing/payment-error-swallowed.fixture.json"
```

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

Hand-authored placeholder fixtures (small, committed) live alongside.

## Layout

```
test/harness/
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

## Runbook: §4.3 boundary-change "test pair" tweak

The motivating example for #538. To execute:

1. **Snapshot fixture** — capture PR #520 ctx via the steps above. Save
   under `fixtures/boundary-change/ge-5-threshold-shift.fixture.json` and
   author `ge-5-threshold-shift.assertions.ts` with Tier 1 assertions only
   (`expectRuleFired`, `expectToolCalled('get_files_context')`).
2. **Baseline calibration** — `npm run test:harness -- --rule boundary-change
   --calibrate 10`. Confirm ≥ 9/10. If not, tighten assertions.
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

## Modes — when to use which

- **`/test-harness <rule>` (CC)** — fast inner loop. Free. Use while
  drafting a prompt change. Catches "the prompt is broken" but not "Gemini
  will misbehave."
- **`npm run test:harness --votes 3`** — sanity check after iterating in CC.
  ~$0.18 per fixture. Tells you Gemini agrees with the assertion at K=3.
- **`npm run test:harness --calibrate 10`** — the 9/10 bar. ~$0.50 per
  fixture. **The only mode that gates merging a prompt change.**
- **GitHub workflow ("Agent-Rule Test Harness (LLM)")** — same as
  `--calibrate`, in CI, with the result attached to the workflow run for
  audit. Triggered manually via the Actions UI.

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
