# Contributing to Lien

Thank you for your interest in contributing to Lien! This document provides guidelines for development and releasing.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/getlien/lien.git
cd lien

# Install dependencies
npm install

# Build the project
npm run build

# Test locally
cd packages/cli
npm link
```

### Dogfooding Lien while working on Lien

The repo contains a Claude Code plugin at `plugins/claude/` and a marketplace manifest at `.claude-plugin/marketplace.json` — these are distribution files for end users. **Do not `/plugin install lien` in your dev environment** when working on Lien itself: that points the MCP server at the npm-published `@liendev/lien`, so you'd be testing the released build instead of your local changes.

Instead, register Lien per-project against your local `dist/`:

```jsonc
// .mcp.json in this repo, or the corresponding entry in ~/.claude.json
{
  "mcpServers": {
    "lien": {
      "command": "node",
      "args": ["/absolute/path/to/lien/packages/cli/dist/index.js", "serve", "-r", "."]
    }
  }
}
```

Rebuild (`npm run build`) and restart your MCP client to pick up changes.

### Working in a git worktree

A fresh `npm install`/`npm ci` in a linked git worktree fails to compile
(native `tree-sitter` bindings won't build there). See
[docs/development/worktree-development.md](docs/development/worktree-development.md)
for the symlink-from-main workaround.

## Project Structure

Lien is a 6-package monorepo. `CLAUDE.md`'s ["What is Lien?"](./CLAUDE.md#what-is-lien) section (which contains "Package Structure") is the single source of truth for the per-package directory layout — start there. In short:

```
lien/
├── packages/
│   ├── parser/    # @liendev/parser — AST parsing, chunking, complexity, scanning
│   ├── core/      # @liendev/core — SQLite structural store + FTS5 search, config, git (depends on parser)
│   ├── cli/       # @liendev/lien — CLI + MCP server (depends on core and parser)
│   ├── review/    # @liendev/review (private) — PR review engine (depends on parser only)
│   ├── action/    # @liendev/action (private) — self-hostable GitHub Action wrapping review
│   └── site/      # @liendev/site (private) — VitePress docs site (lien.dev)
├── docs/architecture/     # Architecture docs and ADRs
├── docs/development/      # Contributor how-tos (worktrees, adding a language)
└── .cursor/               # Cursor AI rules and guidelines
```

## Making Changes

### 1. Development Workflow

```bash
# Create a feature branch
git checkout -b feat/my-feature

# Make your changes
# ... edit files ...

# Build and test
npm run build

# Test the CLI locally
lien --help
```

### 2. Testing

`CLAUDE.md`'s ["Before EVERY Commit"](./CLAUDE.md#before-every-commit-mandatory)
section is the single source of truth for the 6 mandatory pre-commit gates
(`format:check`, `lint`, `typecheck`, `build`, `test`, `lien delta`) — run
that exact list before committing, no subset of it.

**Fast inner loop** while iterating, instead of the full suite each time:

```bash
# Single test file in one workspace
npm run test -w @liendev/<pkg> -- path/to/file.test.ts

# Full suite before committing
npm test
```

`npm test` excludes `packages/cli`'s e2e tests (`vitest run --exclude
'test/e2e/**'`). Those run separately via `npm run test:e2e:<lang>` (e.g.
`test:e2e:python`, `test:e2e:swift` — see `packages/cli/package.json` for the
full list) and in CI only when a PR carries a changeset or the `e2e` label.

**Native parser binary:** `packages/parser`'s `ast/native/compat.test.ts`
drives the native backend (`LIEN_PARSER=native`, set explicitly inside that
suite) against the compiled `parser-native.node`. Run
`npm run build:native -w @liendev/parser-native` first (compiles the Rust
crate via `cargo build --release`) — without it, that suite's
explicit-native assertions fail loudly rather than skipping. CI always
builds the native binary before running any test job.

**`LIEN_PARSER=native|legacy`:** selects the AST parser backend. Unset or
`native` uses `@liendev/parser-native`, the default since ADR-013 Phase 4-A.
`legacy` opts out to the previous `node-tree-sitter` path — it is
**transitional and scheduled for removal in a future release**; don't build
new work against it. **Fallback:** on the default (unset) path only, if the
native binding fails to *load* (e.g. an exotic platform with no prebuilt
package and no local build), lien automatically falls back to legacy for
the rest of the process and prints one `console.warn` naming the platform
and the remedy — a per-file parse error from an already-loaded binding is
unaffected and never triggers this. An **explicit** `LIEN_PARSER=native`
does not fall back — it fails loud, which is what CI's dedicated
native-mode coverage relies on. CI runs the whole test suite under both —
`build-and-test` (native, the default) and a dedicated `test-legacy` job —
and `e2e.yml` reruns the TypeScript and Kotlin e2e projects under legacy on
every changeset-triggered PR (the full 12-project suite in both modes is
available via that workflow's manual `workflow_dispatch`). To reproduce a
legacy-mode failure locally, run `LIEN_PARSER=legacy npm test`. See
[ADR-013](docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md)
for the staged rollout this flag is part of.

### 3. Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Features
git commit -m "feat: add Python test detection"
git commit -m "feat(indexer): support for Go modules"

# Bug fixes
git commit -m "fix: resolve reconnection race condition"
git commit -m "fix(mcp): handle empty search results"

# Documentation
git commit -m "docs: update README with new examples"

# Other types
git commit -m "refactor: simplify chunking logic"
git commit -m "test: add integration tests for MCP"
git commit -m "chore: update dependencies"
```

## Releasing

Lien versions and publishes via [Changesets](https://github.com/changesets/changesets), driven by `.changeset/config.json` and `.github/workflows/release.yml`. Published packages: `@liendev/parser`, `@liendev/core`, `@liendev/lien` (the `cli` package). `review`, `action`, and `site` are `"private": true` and never published. The three published packages are `linked` — they always bump together, even when only one has code changes.

### Flow

1. **In your PR**, run `npm run changeset` (or invoke the `/changeset` skill to draft one from your commits). Pick the affected packages and bump type, write a summary, commit the generated `.changeset/<name>.md` alongside your change. Skip this for changes scoped only to `packages/review`, `packages/action`, or `packages/site` — they're unpublished and never need one.
2. **Merge to main.** The release workflow runs on every push to main.
3. If there are pending changesets, the **changesets bot** opens (or updates) a "Version Packages" PR that bumps versions, rewrites each published package's `CHANGELOG.md` from the changeset summaries, and deletes the consumed changeset files.
4. **Merging the Version Packages PR publishes to npm** — the same workflow, seeing no pending changesets left, runs `npm run release` (`npm run build && changeset publish --provenance`) via npm OIDC trusted publishing (no `NPM_TOKEN` needed).

### Versioning

Lien follows [Semantic Versioning](https://semver.org/). Pick the bump when running `npm run changeset`:

| Change Type | Bump | Example |
|-------------|------|---------|
| Bug fix | Patch | Fixed reconnection timeout |
| New tool | Minor | Added `find_tests_for` tool |
| New language | Minor | Added Ruby support |
| Performance | Patch | Improved indexing speed |
| Breaking API | Major | Changed MCP tool signatures |
| Config change (breaking) | Major | New config file format |
| Config change (compatible) | Minor | Added optional field |

## Changelog Guidelines

Don't hand-edit any `CHANGELOG.md`. Each published package's `CHANGELOG.md` (e.g. `packages/cli/CHANGELOG.md`) is generated automatically from your changeset's body text when the Version Packages PR is created — write a clear, user-facing summary in the changeset itself; that text becomes the changelog entry.

## Adding a New Ecosystem Preset

Lien detects project type via lightweight **ecosystem presets** (marker file → include/exclude patterns), not a plugin/detector system. The old `FrameworkDetector` plugin architecture (~3,000 LOC) was removed in favor of this simpler model — see [ADR-007](docs/architecture/decisions/0007-replace-framework-detection-with-ecosystem-presets.md) for the full rationale.

To add support for a new ecosystem (e.g., a new language or build tool):

1. Add an entry to `ECOSYSTEM_PRESETS` in `packages/parser/src/ecosystem-presets.ts` — a `{ name, markerFiles, excludePatterns }` object literal.
2. Add a test case in `packages/parser/src/ecosystem-presets.test.ts`.
3. Update the ecosystem preset list in `packages/site/docs/guide/configuration.md` and README.md's Supported Languages section if relevant.

No detector classes, confidence levels, or registry — just add an object to the array.

## Adding a New AST Language

Each AST-supported language is a **single self-contained file** in `packages/parser/src/ast/languages/` — traverser, export extractor, import extractor, and the `LanguageDefinition` that wires them together — registered in `languages/registry.ts`. That's the small part; the real work is verifying the tree-sitter grammar, plus the e2e/docs/changeset follow-through it takes to actually ship.

See [docs/development/adding-a-language.md](docs/development/adding-a-language.md) for the full playbook: the grammar-verification gate, the complete wiring checklist, the 3-PR release arc, and every known gotcha (worktree native builds, lockfile grammar conflicts, no-field-name grammars, e2e project sizing).

---

## Code Review

All contributions should:

- Follow TypeScript best practices
- Include JSDoc comments for public APIs
- Handle errors gracefully
- Update documentation if needed
- Add tests for new features (when applicable)

## Questions?

Feel free to open an issue for:
- Bug reports
- Feature requests
- Questions about development
- Ideas for improvements

## License and Contributor Agreement

By contributing to Lien, you agree that:

1. **Your contributions will be licensed under the AGPL-3.0 license**, the same license as the project
2. **You grant the project maintainers** the right to use your contributions under the AGPL-3.0 license
3. **You have the right to submit** the contribution under these terms (either you own the copyright or have permission from the copyright holder)
4. **Your contribution is your original work** or you have obtained all necessary permissions

### Why AGPL?

Lien uses the AGPL-3.0 license to:
- Protect our innovative AST-based semantic chunking architecture
- Ensure improvements benefit the entire community
- Prevent proprietary forks that don't contribute back
- Enable sustainable long-term development

**Local use of Lien is and always will be free.**
