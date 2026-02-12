---
name: changeset
description: Analyze commits since last release and create a changeset .md file to trigger the release CI workflow.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git *), Read, Glob, Grep, Write, AskUserQuestion
---

# Create Changeset for Next Release

You are creating a changeset file (`.changeset/<name>.md`) that will trigger the Changesets CI workflow to version and publish the `@liendev/core` and `@liendev/lien` packages.

## Step 1: Find the Last Release

Run this to find the latest release tag:

```bash
git tag --sort=-v:refname | grep '^@liendev/lien@' | head -1
```

This gives you the tag to diff against (e.g., `@liendev/lien@0.35.0`).

## Step 2: Gather Commits Since Last Release

Get all non-merge commits since the last release tag that touch `packages/`:

```bash
git log --oneline --no-merges <tag>..HEAD -- packages/
```

Also get the full commit messages for categorization:

```bash
git log --format="%h %s" --no-merges <tag>..HEAD -- packages/
```

## Step 3: Determine Affected Packages

For each commit, check which packages it touches:

```bash
git diff --name-only <tag>..HEAD -- packages/core/
git diff --name-only <tag>..HEAD -- packages/cli/
```

- If **only** `packages/core/` changed → only `@liendev/core` in frontmatter
- If **only** `packages/cli/` changed → only `@liendev/lien` in frontmatter
- If **both** changed (most common) → both packages in frontmatter

Note: These packages are `linked` in `.changeset/config.json`, so they version together. When in doubt, include both.

## Step 4: Determine Version Bump

Categorize commits by their conventional commit prefix:

| Prefix | Category | Bump |
|--------|----------|------|
| `feat` | Features | **minor** |
| `fix` | Fixes | **patch** |
| `refactor` | Refactors | **patch** |
| `perf` | Performance | **patch** |
| `docs` | Documentation | none (skip unless substantial) |
| `chore` | Maintenance | none (skip unless user-facing) |
| `test` | Tests | none (skip) |
| `BREAKING` or `!:` | Breaking change | **major** |

The **highest bump wins**: if there's at least one `feat`, bump is `minor`. If there's a breaking change, bump is `major`. Otherwise `patch`.

Skip commits that are purely internal (`chore`, `test`, `docs`, `ci`) unless they have user-facing impact.

## Step 5: Build the Changeset Content

Group the relevant commits into these categories (only include sections that have entries):

- `### Features` — from `feat` commits
- `### Fixes` — from `fix` commits
- `### Refactors` — from `refactor` commits
- `### Performance` — from `perf` commits

For each entry:
- Write a clear, user-facing description (rewrite commit messages if needed for clarity)
- Include PR numbers in parentheses: `(#123)`
- Do NOT include commit hashes — changesets adds those automatically

## Step 6: Determine the File Name

Read the current version from `packages/cli/package.json` (the `version` field). The changeset file name should be the **next version** based on the bump type:

- Current `0.35.0` + patch → `v0-35-1`
- Current `0.35.0` + minor → `v0-36-0`
- Current `0.35.0` + major → `v1-0-0`

File path: `.changeset/<version-name>.md`

## Step 7: Ask User for Confirmation

Before writing the file, present the user with:

1. The determined version bump (patch/minor/major)
2. The list of commits being included
3. The full changeset content you're about to write
4. Any commits you're skipping and why

Ask the user to confirm or adjust before writing.

## Step 8: Write the Changeset File

Write the file in this exact format:

```markdown
---
"@liendev/core": <bump>
"@liendev/lien": <bump>
---

### Features
- Description of feature (#PR)

### Fixes
- Description of fix (#PR)

### Refactors
- Description of refactor (#PR)
```

Only include package lines for affected packages. Only include sections that have entries.

## Example Output

For reference, here's what a real changeset looked like (v0.35.0):

```markdown
---
"@liendev/core": minor
"@liendev/lien": minor
---

### Features
- Upgrade to @huggingface/transformers v3 with GPU support + `lien config` command (#160)
- Parallelize embedding generation and file processing for faster indexing (#156)

### Fixes
- Support nested `.gitignore` files in incremental indexing (#147)
- Filter gitignored files in watcher and unify ignore patterns (#140, #146)

### Refactors
- Remove dead embeddings.device (cpu|gpu) config (#161)
- Extract helper functions from indexing pipeline (#158)
```

## Important Notes

- Do NOT include `@liendev/action` — it's ignored in changeset config
- The packages are **linked** — they always get the same version bump
- Commits with scope `(core)` usually affect `@liendev/core`, scope `(cli)` or `(mcp)` affect `@liendev/lien`, no scope or `(security)` may affect both
- Skip merge commits (`chore: version packages`, `Merge pull request`)
- Skip CI-only changes (`ci:`, workflow files)
- When in doubt about whether to include a commit, include it — better to over-document than under-document
