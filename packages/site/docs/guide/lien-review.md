# Lien Review

Lien Review is a self-hostable **GitHub Action** that reviews pull requests: complexity analysis, an agent-driven bug review, and a PR summary — posted back to GitHub as inline comments and workflow annotations. There's no server, no database, and no recurring bill: the action clones the PR by SHA, reviews it, and writes results straight to GitHub using the workflow's built-in `GITHUB_TOKEN`.

This page covers setup. For the complete input/output reference, fork-PR handling, and security notes, see [`packages/action/README.md`](https://github.com/getlien/lien/blob/main/packages/action/README.md) in the repo.

## Quick start

Add a workflow at `.github/workflows/lien-review.yml`:

```yaml
name: Lien Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: getlien/lien-review@v1
        with:
          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

That single `uses:` line is the whole integration — **no `actions/checkout` step is needed**. Lien self-clones the PR head (and base, for complexity deltas) by SHA using the same token.

## Required permissions

The workflow must grant these or the comment writes will 403:

```yaml
permissions:
  contents: read # clone the PR head/base by SHA
  pull-requests: write # post inline review comments
```

## LLM key setup

The agent (bug) review needs an LLM key, provided as a workflow **secret**:

1. Get an [OpenRouter](https://openrouter.ai/) API key (preferred — runs OpenRouter's calibrated default model, currently `moonshotai/kimi-k2.7-code`; see [`packages/review/src/defaults.ts`](https://github.com/getlien/lien/blob/main/packages/review/src/defaults.ts) for the source of truth) or an Anthropic API key.
2. Add it under **Settings → Secrets and variables → Actions → New repository secret** as `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`).
3. Pass it through the action's `with:` block, as shown above.

If both keys are omitted, the review still runs but **complexity-only** — the agent bug/summary/architectural passes are skipped.

**Cost:** a typical PR review costs roughly $0.02–$0.15 in OpenRouter tokens on the default model (measured across the 2026-07 cross-repo study; ~$0.03/vote median, with complex multi-pass reviews at the high end — OpenRouter's own billing can run ~1.5–2× the harness-reported figure). The exact cost of every run is printed in the job's step summary.

## What it checks

| Feature | Description |
|---------|-------------|
| Complexity analysis | Flags new/worsened cyclomatic, cognitive, and Halstead complexity violations |
| Agent bug review | LLM-driven review for correctness bugs (OpenRouter or Anthropic) |
| PR summary | A concise summary of the change, posted as a step summary |
| Advisory by default | `fail-on: never` — review findings never block a PR unless you opt in (a total LLM-provider failure still fails the check regardless) |

## Advanced configuration

One behavior is tunable only via an environment variable on the action step, not a formal input: set `LIEN_REVIEW_DOC_PASS=0` to disable the dedicated doc-truth second pass that checks documentation/guidance prose against the code it describes (on by default, and only runs on PRs touching doc surfaces). There is currently no `model` input — the OpenRouter path pins the calibrated default deliberately, since the calibration evidence backing this review only covers that one model. See [`packages/action/README.md`](https://github.com/getlien/lien/blob/main/packages/action/README.md#advanced-configuration) for details.

## Blocking a PR on the review

By default the review is **advisory** for its own findings — it never fails CI on those. To gate merges on findings, set `fail-on: error` (or `any`) and mark the workflow's job as a **Required status check** in your branch protection rules. See the [inputs table](https://github.com/getlien/lien/blob/main/packages/action/README.md#inputs) for the full set of options (`threshold`, `review-types`, `block-on-new-errors`, `fail-on`). A total LLM-provider failure is a separate case that always fails the check, even under `fail-on: never` — see the paragraph below.

If the agent review's main pass never runs at all (every LLM provider request failed — insufficient credits, an invalid key, a provider outage), Lien marks the result with an error-severity finding and a `failure` conclusion instead of a clean-looking review — and **fails the check regardless of `fail-on`**, including the advisory default `never`. A review that never ran isn't an advisory finding to gate on; a partial run (some turns completed before it bailed) still obeys `fail-on` as before. See [`packages/action/README.md`](https://github.com/getlien/lien/blob/main/packages/action/README.md#fail-loudly-guarantee) for the full behavior.

## Fork PRs

On a `pull_request` event from a fork, GitHub forces the built-in `GITHUB_TOKEN` to read-only, so Lien can still review the code but can't post inline comments (findings still show up as workflow annotations and in the step summary). To get inline comments on fork PRs, opt into the `pull_request_target` variant documented in [`packages/action/README.md`](https://github.com/getlien/lien/blob/main/packages/action/README.md#fork-prs) — read the security note there first.

Every rule above ships only after clearing a real-PR fixture harness — see
[How We Know Lien Review Works](/guide/review-harness) for the methodology
and [Review Evidence](/guide/review-evidence) for results on codebases Lien
wasn't tuned on.

## Relationship to the MCP tools

Lien Review is a separate product surface from the [MCP tools](/guide/mcp-tools): the MCP tools run locally inside your AI assistant, while Lien Review runs in CI against a pull request. Both share the same underlying AST parsing and complexity analysis (`@liendev/parser`), but Lien Review needs no local index and no `lien init` — it's a drop-in GitHub Action.
