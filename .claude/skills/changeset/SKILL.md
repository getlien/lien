---
name: changeset
description: Analyze commits since last release and create a changeset .md file to trigger the release CI workflow.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git *), Read, Glob, Grep, Write, AskUserQuestion
---

# Create Changeset for Next Release

You are creating a changeset file (`.changeset/<name>.md`) that will trigger the Changesets CI workflow to version and publish the three linked packages: `@liendev/parser`, `@liendev/parser-native`, and `@liendev/lien` (see `.changeset/config.json`'s `linked` group — `site` is `"private": true` and not part of it). `@liendev/core` used to be a fourth linked package; it was deleted and folded into `packages/cli` (`@liendev/lien`) in Phase 8 and is no longer published from this repo. `review` and `action` were private packages excluded from the group; both have been deleted too.

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
git diff --name-only <tag>..HEAD -- packages/parser/
git diff --name-only <tag>..HEAD -- packages/parser-native/
git diff --name-only <tag>..HEAD -- packages/cli/
```

- Check **all three** published packages: `@liendev/parser`, `@liendev/parser-native`, `@liendev/lien`
- Include every package that has changes in the frontmatter
- These packages are `linked` in `.changeset/config.json`, so they version together. When in doubt, include all three.

**IMPORTANT:** Always read `.changeset/config.json` to verify the current `linked` group. Do not assume which packages exist — check the config.

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

**Warning:** don't trust the scope label — check the Step 3 directory diff. A `(delta)` commit looks feature-scoped but lands in published cli/parser. (Historically `(review)` and `(action)` scopes touched private, unpublished packages and had to be excluded; both packages are deleted, so no new commit will carry those scopes.)

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

**Tag every fenced code block with a language.** A bare ``` trips markdownlint
MD040 and CodeRabbit flags it on the PR — twice so far, on two separate
changesets, because nothing here said so. Use `text` for command output,
measurements and before/after numbers; `bash`, `json`, `typescript` etc. where
they apply. The changeset body becomes the published CHANGELOG entry, so it is
linted like any other markdown in the repo.

Write the file in this exact format:

```markdown
---
"@liendev/parser": <bump>
"@liendev/parser-native": <bump>
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

Here's the current shape. Note it names only packages that exist — a changeset
naming a package that isn't in the workspace fails `changeset version` during
the release, so never copy a package line from an older example without
checking it against `.changeset/config.json`:

```markdown
---
"@liendev/parser": minor
"@liendev/lien": minor
---

### Fixes
- `lien review` no longer reports deleted files as parse failures (#1134)

### Refactors
- Fold `@liendev/core` into the CLI and delete the package (#1135)
```

Older changesets in `packages/*/CHANGELOG.md` name `@liendev/core` and describe
embeddings, the indexer and the MCP server. They are accurate history and
should not be edited — but they are not templates.

## Important Notes

- The three published packages are `@liendev/parser`, `@liendev/parser-native`, and `@liendev/lien` — they are **linked** and always get the same version bump
- Always read `.changeset/config.json` to verify the linked group — do not hardcode assumptions about which packages exist
- Commits with scope `(parser)` affect `@liendev/parser`, scope `(parser-native)` affect `@liendev/parser-native`, scope `(cli)`, `(core)`, or `(mcp)` affect `@liendev/lien` (config/errors/formatters live in `packages/cli` now, folded in from the deleted `@liendev/core` in Phase 8), no scope or `(security)` may affect all three
- `packages/review` and `packages/action` were deleted in Phase 7b; a `(review)`/`(action)` scope on a new commit means something else and should be checked against the directory diff
- Skip merge commits (`chore: version packages`, `Merge pull request`)
- Skip CI-only changes (`ci:`, workflow files)
- When in doubt about whether to include a commit, include it — better to over-document than under-document
