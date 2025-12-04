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
      
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Install Lien
        run: npm install -g @liendev/lien
      
      - name: Initialize Lien
        run: lien init --yes

      # Restore base branch index cache (shared across PRs targeting same base)
      - name: Restore base branch Lien index
        id: cache-base
        uses: actions/cache/restore@v4
        with:
          path: ~/.lien
          key: lien-base-${{ runner.os }}-${{ github.event.pull_request.base.sha }}
      
      # Generate baseline complexity from base branch (for delta tracking)
      # NOTE: Use same threshold as the action for accurate delta calculation
      - name: Get base complexity
        run: |
          git checkout ${{ github.event.pull_request.base.sha }}
          if [ "${{ steps.cache-base.outputs.cache-hit }}" != "true" ]; then
            lien index
          fi
          lien complexity --format json --threshold 10 > /tmp/base-complexity.json || echo '{}' > /tmp/base-complexity.json
      
      # Save base cache BEFORE switching to head
      - name: Save base branch cache
        if: steps.cache-base.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ~/.lien
          key: lien-base-${{ runner.os }}-${{ github.event.pull_request.base.sha }}
      
      # Switch to head branch - Lien does incremental indexing
      - name: Checkout head branch
        run: git checkout ${{ github.sha }}
      
      - name: Index head branch (incremental)
        run: lien index
      
      - name: AI Code Review
        uses: getlien/lien/packages/action@main
        with:
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
          baseline_complexity: '/tmp/base-complexity.json'
```

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
2. **Scan**: Gets list of changed files from GitHub API
3. **Analyze**: Runs `lien complexity` on changed code files
4. **Review**: Sends violations + code snippets to OpenRouter
5. **Comment**: Posts AI-generated review as PR comment

## Example Output

The action posts a comment like this:

> ## 🔍 Lien AI Code Review
> 
> **Summary**: 2 complexity violations found (1 error, 1 warning)
> 
> **Complexity Change:** +8 ⬆️ | 1 improved | 1 degraded
> 
> ---
> 
> ### File-by-File Analysis
> 
> **src/utils/parser.ts**
> 
> 🔴 `parseConfig` (complexity 18, +6 ⬆️)
> - Problem: Nested switch statements create hard-to-follow logic
> - Suggestion: Extract each case into separate handler functions
> 
> 🟢 `validateInput` (complexity 12, -3 ⬇️)
> - Great improvement! This function got simpler.
> 
> ---
> 
> *Generated by [Lien](https://lien.dev) AI Code Review*

## Requirements

- Node.js 20+
- Repository must be indexable by Lien (supports TypeScript, JavaScript, Python, PHP)

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
