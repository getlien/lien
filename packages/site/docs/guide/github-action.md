# GitHub Action - Veille

Veille is a GitHub Action that provides AI-powered code review for pull requests. It analyzes code complexity, tracks changes over time, and posts intelligent inline comments with refactoring suggestions.

## Features

- 🔍 **Complexity Analysis** - Detects functions exceeding complexity thresholds
- 📊 **Delta Tracking** - Shows how complexity changed vs base branch (⬆️ worse, ⬇️ better)
- 🤖 **AI-Powered Reviews** - Generates actionable refactoring suggestions via OpenRouter
- 📍 **Line-Specific Comments** - Posts inline comments directly on problematic code
- 💬 **Smart Fallback** - Falls back to summary comment if lines aren't in the diff
- ⚡ **Incremental** - Only analyzes changed files in the PR

## Quick Start

Add this workflow to `.github/workflows/ai-review.yml`:

::: v-pre

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    # Skip on forks (secrets not available)
    if: github.event.pull_request.head.repo.full_name == github.repository
    
    permissions:
      contents: read
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Install Lien
        run: npm install -g @liendev/lien
      
      - name: Initialize Lien
        run: lien init --yes

      # Restore base branch index cache
      - name: Restore base branch Lien index
        id: cache-base
        uses: actions/cache/restore@v4
        with:
          path: ~/.lien
          key: lien-base-${{ runner.os }}-${{ github.event.pull_request.base.sha }}
      
      # Generate baseline complexity from base branch
      - name: Get base complexity
        run: |
          git checkout ${{ github.event.pull_request.base.sha }}
          if [ "${{ steps.cache-base.outputs.cache-hit }}" != "true" ]; then
            lien index
          fi
          lien complexity --format json --threshold 10 > /tmp/base-complexity.json || echo '{}' > /tmp/base-complexity.json
      
      # Save base cache
      - name: Save base branch cache
        if: steps.cache-base.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ~/.lien
          key: lien-base-${{ runner.os }}-${{ github.event.pull_request.base.sha }}
      
      # Switch to head branch
      - name: Checkout head branch
        run: git checkout ${{ github.sha }}
      
      - name: Index head branch
        run: lien index
      
      - name: AI Code Review
        uses: getlien/lien/packages/action@main
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          baseline_complexity: '/tmp/base-complexity.json'
```

:::

## Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `openrouter_api_key` | OpenRouter API key for LLM access | Yes | - |
| `model` | LLM model to use | No | `anthropic/claude-sonnet-4` |
| `threshold` | Complexity threshold for violations | No | `10` |
| `github_token` | GitHub token for posting comments | No | `github.token` |
| `review_style` | Comment style: `line` or `summary` | No | `line` |
| `baseline_complexity` | Path to baseline complexity JSON | No | - |

### Outputs

| Output | Description |
|--------|-------------|
| `violations` | Total complexity violations found |
| `errors` | Number of error-level violations |
| `warnings` | Number of warning-level violations |
| `total_delta` | Net complexity change (+ = worse, - = better) |
| `improved` | Functions that got simpler |
| `degraded` | Functions that got more complex |

### OpenRouter Setup

1. Get an API key from [OpenRouter](https://openrouter.ai)
2. Add it as a repository secret:
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `OPENROUTER_API_KEY`
   - Value: Your API key

### Supported Models

Any OpenRouter model works. Popular choices:

| Model | Best For |
|-------|----------|
| `anthropic/claude-sonnet-4` (default) | Balance of quality and cost |
| `anthropic/claude-opus-4` | Highest quality, complex analysis |
| `openai/gpt-4o` | Fast, good quality |
| `openai/gpt-4-turbo` | Complex reviews |

## Example Output

### PR Description Badge

Veille adds a complexity summary to your PR description:

```markdown
### 👁️ Veille

✅ **Improved** - This PR makes the code easier to maintain.

<details>
<summary>📊 Details</summary>

| Violations | Max Complexity | Change |
|:----------:|:--------------:|:------:|
| 0 | 14 | -23 ⬇️ |

</details>
```

### Inline Comments

For each violation, Veille posts an inline comment:

> **⚠️ High complexity (18, +6 ⬆️)**
>
> This function has deeply nested switch statements that make it hard to follow. Consider extracting each case into separate handler functions:
>
> ```typescript
> // Instead of switch in switch, use a handler map
> const handlers = {
>   'typeA': handleTypeA,
>   'typeB': handleTypeB,
> };
> ```
>
> *[Veille](https://lien.dev) by Lien*

### Summary Comment

When inline comments aren't possible (code outside diff), Veille posts a summary:

> ## 👁️ Veille
>
> 2 issues spotted in this PR.
>
> **Complexity Change:** +8 ⬆️ | 1 improved | 1 degraded
>
> ---
>
> ### Suggestions
>
> **src/utils/parser.ts:45** - High complexity (18, +6 ⬆️)
>
> Nested switch statements create hard-to-follow logic. Extract each case into separate handler functions.

## Delta Tracking

Veille compares complexity between the base branch and your PR:

| Indicator | Meaning |
|-----------|---------|
| `⬆️` | Complexity increased (worse) |
| `⬇️` | Complexity decreased (better) |
| No arrow | No change or new function |

### New Violations

When a function's complexity increases past the threshold:

```
src/api/handler.ts:45 - Moderate complexity (14, +6 ⬆️)
```

### Improved Functions

When complexity decreases:

```
src/utils/parser.ts:78 - Moderate complexity (12, -3 ⬇️)
Great improvement! This function got simpler.
```

## Smart Features

### Inline vs Summary

- **`review_style: line`** (default): Posts inline comments on each violation
- **`review_style: summary`**: Posts one summary comment

### New/Degraded Only

Veille only posts inline comments for:
- **New violations**: Functions that didn't exist or weren't violations before
- **Degraded violations**: Functions that got more complex

Pre-existing unchanged violations are summarized, not re-commented.

### Boy Scout Rule

Violations outside the PR diff are noted with a reminder:

> *Note: Some violations are in code not modified by this PR. Consider the "Boy Scout Rule" - leave code cleaner than you found it!*

## Limitations

- Only runs on PRs from the same repository (not forks)
- Analyzes up to 10 violations per review
- Inline comments require lines to be in the PR diff
- **Complexity analysis languages**: TypeScript, JavaScript, Python, PHP (requires AST support)

## Troubleshooting

### "OpenRouter API key required"

Ensure `OPENROUTER_API_KEY` is set in repository secrets.

### "Not running in PR context"

The action only works on `pull_request` events.

### Comments not appearing

Check:
1. `pull-requests: write` permission is set
2. Not running on a fork
3. The token has access to the repository

### No violations found

Your code is clean! Or check:
- The threshold setting (default: 10)
- File types are supported
- Files are not excluded from indexing

## Pricing

The action uses OpenRouter for AI reviews. Typical costs:
- ~$0.001-0.01 per violation reviewed (varies by model)
- Claude Sonnet 4: ~$3/million input tokens, ~$15/million output tokens

Use `review_style: summary` to reduce costs on PRs with many violations.

