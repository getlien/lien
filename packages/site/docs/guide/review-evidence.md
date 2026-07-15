# How Good Is Lien Review?

Lien Review's agent-driven bug review is validated the same way any rule in it
ships: fixtures scored against committed assertions, not a demo reel. This page
summarizes a 2026-07 study that ran the production pipeline against real,
historical bugs in codebases Lien has never been tuned on, to check whether the
quality holds up outside the lien repo itself.

## Method

Every fixture is mined from the real regression history of an external
open-source repo: find a merged PR that shipped a bug, capture the codebase at
the commit right before the fix, and use the actual later fix commit as ground
truth. There are no hand-labeled opinions — a fixture either reproduces a bug
the project's own maintainers later had to patch, or it doesn't exist. Each
fixture is replayed through the production review pipeline against the
production default model (`moonshotai/kimi-k2.7-code`) and scored by the same
committed Tier-1/2 assertions used to gate every in-repo rule change (see
`packages/review/test/harness/`). For the full methodology — the distractor
smoke test, the canary/characterization split, and the deterministic
no-regression proofs — see [How We Know Lien Review Works](/guide/review-harness).

To keep this affordable, a free blind screen (Claude Code on a Claude
subscription, no OpenRouter spend) triages fixtures before paying for
confirmation: a 3-vote Kimi screen confirms the screen's catches, and a
`--calibrate 10` run (≥9/10 required) certifies the ones promoted to permanent
canaries. The full study — 24 fixtures across 8 external repos in 6 languages,
mined 2026-07-11/12 — cost **$13.11 of a $15 authorized OpenRouter budget**.

The screen isn't infallible: across all 24 fixtures it produced one
false negative (`starlette` #2334 below) — a blind miss that Kimi caught
3/3 anyway. That's the only counter-example found to date.

## Results

| Language | Repo(s) | Regressions tested | Result |
|---|---|---|---|
| TypeScript | hono | 3 | Kimi 10-vote calibration: **10/10, 10/10, 8/10** |
| Ruby | rack | 3 (2 blind-catches, 1 miss) | Kimi 3-vote screen on the 2 catches: **3/3, 3/3** |
| Go | gin | 3 (2 blind-catches, 1 miss) | Kimi 3-vote screen on the 2 catches: **2/3, 3/3** |
| Python | starlette + werkzeug | 6 | Kimi 3-vote screen: **16/18 votes, 6/6 fixtures at majority**. One promoted to a canary via 10-vote calibration: starlette #2191 (positional-args off-by-one) = **10/10** |
| Rust | reqwest | 3 (1 blind-catch, 2 misses) | Kimi 3-vote screen on the 1 catch: **0/3** — judgment-shaped miss (spec-knowledge-bounded) |
| PHP | guzzle | 3 (1 blind-catch, 2 misses) | Kimi 3-vote screen on the 1 catch: **0/3** — judgment-shaped miss (adversarial-depth) |

"Blind-catch" means Claude Code, reviewing with no knowledge of the fixture's
intended finding, flagged the bug unaided — that's the free filter before any
paid confirmation. Fixtures the blind screen missed weren't automatically
wrong calls: every one is trace-attributed to a specific frontier below, not
to a broken pipeline. Rust and PHP each had three fixtures total; only one per
language cleared the blind screen, and that one came back a paid-confirmation
miss in both cases — the taxonomy below explains why.

## What It Misses — The Honest Part

Four miss shapes showed up across the whole study, stable across both models
that were tried (Claude Code and Kimi):

**Deep-traced, wrong conclusion.** The reviewer engages the exact question and
reasons its way to the wrong answer, rather than not noticing the question at
all. Example: `reqwest` #1645 — a redirect-limit off-by-one. Both models
traced the limit-check logic directly and still concluded it was correct.

**Omission.** The bug is what *isn't* there — a silently-skipped code path
with no local diff to point at. Example: `guzzle` #3740 — an `on_trailers`
callback that silently no-ops. This is the weakest shape the study found, in
both docs and code review.

**External-usage blindness.** Every in-repo caller is fine; the break only
shows up in downstream consumers the reviewer can't see. Example: `guzzle`
#3714 — a validation-before-middleware ordering change that's safe for every
caller inside the repo but breaks consumers' own middleware.

**Judgment/framing acceptance.** The reviewer sees the change and accepts the
PR's own framing of it — including a spec-knowledge-bounded variant, where
catching the bug requires knowledge the PR body actively contradicts. Example:
`reqwest` #1927 — a deflate-decoder change that violates RFC 9110 (deflate is
zlib-wrapped), which the reviewer would need to know independently of what
the PR says it's doing.

All four miss examples cite public PRs from the study record, so each is
independently checkable against the linked project's history — but note that
only a subset of the study's 24 fixtures is committed in the repo's corpus
(the miss examples above are documented in the study log, not all carried as
replayable fixtures).

## Reproducing This

- The committed corpus lives in the repo:
  `packages/review/test/harness/fixtures/crossrepo/` plus the per-rule
  canaries.
- Fixture JSONs are gitignored and regenerate from the public PRs — each
  fixture's `.assertions.ts` header carries the exact `capture-pr.ts` recipe
  (clone the public repo, fetch the PR ref, run the capture script).
- The calibration bar is the same everywhere: **≥9/10** on a 10-vote
  `--calibrate 10` run against the production default model.
- Fixtures tagged `characterization` (e.g. `werkzeug` #2678, #2017) document
  known frontiers without gating anything — they're allowed to sit below the
  bar until someone iterates on the rule that should catch them.

See `packages/review/test/harness/README.md` for the full corpus table and
the harness workflow.
