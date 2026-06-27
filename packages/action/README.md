# Lien Review — GitHub Action

Self-contained PR review as a GitHub Action: complexity analysis, agent bug
review, and a summary, posted back to the PR as **inline comments** and
**workflow annotations**, with the workflow job as the single status check. No
server, no database, no recurring bill — the action clones the PR
by SHA, reviews it, and writes the results straight to GitHub using the
workflow's built-in `GITHUB_TOKEN`.

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

That single `uses:` line is the whole integration — **no `actions/checkout`
step is needed**. Lien self-clones the PR head (and base, for deltas) by SHA
using the same token, so adding `actions/checkout` is unnecessary and, on fork
PRs, unsafe (see [Fork PRs](#fork-prs)).

A copy-paste workflow (including the fork variant) lives in
[`examples/lien-review.yml`](./examples/lien-review.yml).

## Required permissions

The consumer workflow MUST grant these permissions or the comment writes will 403:

```yaml
permissions:
  contents: read # clone the PR head/base by SHA
  pull-requests: write # post inline review comments
```

Put the `permissions:` block at the workflow top level (as above) or on the
individual job. If your repository's default `GITHUB_TOKEN` permissions are set
to "read-only" in **Settings → Actions → General → Workflow permissions**, the
explicit block is what re-grants the write scopes this action needs.

## LLM key setup

The agent (bug) review needs an LLM key, provided as a workflow **secret**:

1. Get an [OpenRouter](https://openrouter.ai/) API key (preferred — cheaper
   Gemini path) or an Anthropic API key.
2. Add it to your repo under **Settings → Secrets and variables → Actions →
   New repository secret** as `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`).
3. Pass it through the action's `with:` block:

   ```yaml
   with:
     openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
     # or:
     # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

If **both** keys are omitted the review still runs, but **complexity-only** —
the agent bug/summary/architectural passes are skipped. When both are present
OpenRouter wins.

> Never hard-code an API key in the workflow YAML. Always reference it from
> `secrets`.

## Inputs

| Input                 | Required | Default                         | Description                                                                                                                                |
| --------------------- | -------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`        | no       | `${{ github.token }}`           | Token used to clone the PR and post inline comments. Needs `contents:read` and `pull-requests:write`.                                    |
| `openrouter-api-key`  | no       | `''`                            | OpenRouter API key for agent review (preferred provider — runs Gemini). If omitted, falls back to `anthropic-api-key`, then complexity-only. |
| `anthropic-api-key`   | no       | `''`                            | Anthropic API key for agent review (fallback when `openrouter-api-key` is not set). If both are omitted, review is complexity-only.       |
| `threshold`           | no       | `15`                            | Complexity threshold above which violations are reported.                                                                                 |
| `review-types`        | no       | `complexity,bugs,summary`       | Comma-separated review types to enable. `complexity` toggles the complexity check. `bugs`, `architectural`, and `summary` all come from the single agent reviewer, so they switch it on/off as a group (and only when an API key is set) — they can't be toggled independently. |
| `block-on-new-errors` | no       | `false`                         | Post `REQUEST_CHANGES` (instead of `COMMENT`) when the PR introduces new error-level complexity violations.                               |
| `fail-on`             | no       | `never`                         | Whether the review fails the check (so a Required check can block the PR). Default `never` — **advisory**, never fails CI. Opt into gating with `error` (a failure conclusion / new error-level findings) or `any` (any error or warning finding). |

> The action posts **no check run of its own** — the workflow job is the single
> status check. Findings surface as workflow annotations (inline on the diff),
> inline PR comments, and a step summary. Use `fail-on` to decide whether the job
> check gates the PR.

## Outputs

| Output           | Description                                            |
| ---------------- | ----------------------------------------------------- |
| `conclusion`     | The review conclusion: `success`, `failure`, or `neutral`. |
| `findings-count` | Total number of findings produced.                    |
| `error-count`    | Number of error-severity findings.                    |

Reference them from a later step via the step `id`:

```yaml
- uses: getlien/lien-review@v1
  id: lien
  with:
    openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
- run: echo "Lien found ${{ steps.lien.outputs.error-count }} errors"
```

## Blocking a PR on the review

By default the review is **advisory** (`fail-on: never`) — it never fails CI, so
adding the action can't break anyone's pipeline. To gate merges on it, opt in by
setting `fail-on` and marking the workflow's job as a **Required status check**
in your branch protection rules. With `fail-on: error` the action exits non-zero
only when the review's overall conclusion is a failure (driven by
`block-on-new-errors`); `fail-on: any` is stricter (any error- or warning-level
finding fails the check).

## Fork PRs

On a `pull_request` event triggered from a **fork**, GitHub forces the built-in
`GITHUB_TOKEN` to **read-only** — so Lien can clone and review the code, and its
findings still appear as **workflow annotations** and in the **step summary**,
but it cannot post **inline PR comments** (those writes 403). Lien emits a clear
`::warning::` about this. The check still reflects the findings per `fail-on`
(the review ran and its results are delivered via annotations) — set
`fail-on: never` if you'd rather fork reviews never block CI.

To get inline comments on fork PRs too, opt in via the
`pull_request_target` event, which runs in the **base** repo's context and
therefore gets a writable token:

```yaml
on:
  pull_request_target:

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

### Security note (read before enabling `pull_request_target`)

`pull_request_target` is normally dangerous because the writable token plus a
naive `actions/checkout` of the **PR head** would let an attacker's fork run its
own code with your secrets. **Lien is safe here for one specific reason: it
never executes the checked-out code.** It self-clones the head by SHA with
`git init`/`fetch`/`checkout` (object fsck + symlink-escape guards on), then only
reads and parses the source with tree-sitter. There is no `npm install`, no
build, no test run, no script execution.

To keep that guarantee, with the `pull_request_target` variant you MUST:

- **NOT** add an `actions/checkout` step that checks out the PR head ref
  (`ref: ${{ github.event.pull_request.head.sha }}` or `head.ref`). Lien does
  its own read-only clone; an explicit head checkout would place untrusted code
  on disk for other steps to potentially execute.
- Keep this workflow minimal — ideally the single `uses: getlien/lien-review@v1`
  step and nothing that runs PR-authored code.

If you add other steps to this workflow, treat the PR contents as untrusted and
do not execute them.

## How it works

1. Reads the `pull_request` event payload (`$GITHUB_EVENT_PATH`) to get the PR
   number and the **head SHA** (`event.pull_request.head.sha` — not
   `GITHUB_SHA`, which on `pull_request` is the ephemeral merge commit).
2. Clones the head (and base, for complexity deltas) by SHA over HTTPS using the
   `github-token`. A base-clone failure degrades gracefully to a no-delta review.
3. Runs the enabled review passes (`@liendev/review`): complexity analysis and
   the agent bug/summary/architectural review.
4. Posts inline PR comments for each finding and emits the findings as workflow
   annotations (inline on the diff), writes a run summary to
   `$GITHUB_STEP_SUMMARY`, sets the action outputs, and exits per `fail-on`. It
   creates no check run of its own — the workflow job is the status check.

The action ships as a Docker container action pulling a prebuilt image from
`ghcr.io/getlien/lien-review` (tree-sitter's native bindings rule out a
JavaScript/composite action), so each run pulls the image rather than building
it.
