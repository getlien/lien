# Lien AI Code Review Action

A GitHub Action that analyzes code complexity in pull requests and posts AI-generated review comments using [Lien](https://lien.dev) and OpenRouter.

## Features

- 🔍 **Complexity Analysis** - Detects functions exceeding complexity thresholds
- 📊 **Delta Tracking** - Shows how complexity changed vs base branch (⬆️ worse, ⬇️ better)
- 🤖 **AI-Powered Reviews** - Generates actionable refactoring suggestions via OpenRouter (Claude, GPT-4, etc.)
- 📍 **Line-Specific Comments** - Posts inline comments directly on the problematic code lines
- 💬 **Smart Fallback** - Falls back to summary comment if lines aren't in the diff
- ⚡ **Incremental** - Only analyzes changed files in the PR

## Quick Start

Add this workflow to your repository at `.github/workflows/ai-review.yml`:

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
      
      - name: AI Code Review
        uses: getlien/lien-action@v1
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
```

That's it! The action now bundles all dependencies and handles indexing automatically.

### Advanced: Delta Tracking (Optional)

To track complexity changes vs the base branch, you can generate a baseline complexity report:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0  # Need full history for base branch checkout
  
  # Optional: Generate baseline from base branch for delta tracking
  - name: Get base complexity
    run: |
      git checkout ${{ github.event.pull_request.base.sha }}
      npm install -g @liendev/lien
      lien init --yes
      lien index
      lien complexity --format json --threshold 15 > /tmp/base-complexity.json || echo '{}' > /tmp/base-complexity.json
      git checkout ${{ github.sha }}
  
  - name: AI Code Review
    uses: getlien/lien-action@v1
    with:
      openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
      baseline_complexity: '/tmp/base-complexity.json'  # Enable delta tracking
```

With delta tracking enabled, the action shows:
- ⬆️ Functions that got more complex
- ⬇️ Functions that got simpler
- 🆕 New functions with violations
- ✅ Unchanged pre-existing violations (not re-commented to reduce noise)

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `openrouter_api_key` | OpenRouter API key for LLM access | Yes | - |
| `model` | LLM model to use | No | `anthropic/claude-sonnet-4` |
| `threshold` | Complexity threshold for violations | No | `10` |
| `github_token` | GitHub token for posting comments | No | `${{ github.token }}` |
| `review_style` | Review comment style: `line` (default) posts inline comments on all violations, `summary` posts a single summary comment only | No | `line` |
| `baseline_complexity` | Path to baseline complexity JSON for delta calculation | No | - |

## Outputs

| Output | Description |
|--------|-------------|
| `violations` | Total number of complexity violations found |
| `errors` | Number of error-level violations |
| `warnings` | Number of warning-level violations |
| `total_delta` | Net complexity change (positive = worse, negative = better) |
| `improved` | Number of functions that got simpler |
| `degraded` | Number of functions that got more complex |

## Configuration

### OpenRouter API Key

1. Get an API key from [OpenRouter](https://openrouter.ai)
2. Add it as a repository secret named `OPENROUTER_API_KEY`
   - Go to Settings → Secrets and variables → Actions → New repository secret

### Supported Models

Any model available on OpenRouter works. Popular choices:

- `anthropic/claude-sonnet-4` (default) - Best balance of quality and cost
- `anthropic/claude-opus-4` - Highest quality, higher cost
- `openai/gpt-4o` - Fast, good quality
- `openai/gpt-4-turbo` - Good for complex reviews

### Complexity Threshold

The `threshold` input sets the cyclomatic complexity limit. Functions exceeding this are flagged:

- `10` (default) - Standard threshold, catches most issues
- `15` - More lenient, fewer false positives
- `5` - Strict, flags even moderately complex functions

## How It Works

1. **Trigger**: Action runs on PR open/update
2. **Index**: Automatically indexes your codebase using bundled @liendev/core
3. **Scan**: Gets list of changed files from GitHub API
4. **Analyze**: Runs complexity analysis on changed code files
5. **Review**: Sends violations + code snippets to OpenRouter
6. **Comment**: Posts AI-generated review as PR comment

## Example Output

The action posts a comment like this:

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
> 
> **src/utils/parser.ts:78** - Moderate complexity (12, -3 ⬇️)
> 
> Great improvement! This function got simpler.
> 
> ---
> 
> *[Veille](https://lien.dev) by Lien*

## Requirements

- Node.js 20+ (automatically provided by GitHub Actions)
- Repository must be indexable by Lien (supports TypeScript, JavaScript, Python, PHP)

## Changes in v1.0

**Breaking Change**: The action now bundles @liendev/core directly. You no longer need to:
- ❌ Install Lien globally (`npm install -g @liendev/lien`)
- ❌ Run `lien init`
- ❌ Run `lien index` manually

The action handles all of this automatically! This simplifies your workflow from ~80 lines to just 2 steps.

## Features

### PR Description Badge

The action adds a complexity stats badge to your PR description:

```
### 👁️ Veille

✅ **Improved** - This PR makes the code easier to maintain.

<details>
<summary>📊 Details</summary>

| Violations | Max Complexity | Change |
|:----------:|:--------------:|:------:|
| 0 | 14 | -23 ⬇️ |

</details>
```

This badge is always visible at the top of the PR, not buried in comments.

### Smart Inline Comments

- Only posts inline comments for **new or degraded** violations
- Pre-existing unchanged violations are summarized, not re-commented
- Saves LLM costs by not regenerating comments for unchanged code

## Limitations

- Only runs on PRs from the same repository (not forks) due to secrets access
- Analyzes up to 10 violations per review to stay within token limits
- Inline comments only work for lines in the PR diff; violations outside the diff get a summary comment with a note about the boy scout rule

## Development

```bash
# Install dependencies
cd packages/action
npm install

# Type check
npm run typecheck

# Build (bundles to dist/index.js)
npm run build

# Run tests
npm test
```

The `dist/` folder must be committed for GitHub Actions to work.

## License

MIT - See [LICENSE](../../LICENSE)
