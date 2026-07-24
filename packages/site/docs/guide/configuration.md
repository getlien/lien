# Configuration

Lien works with **zero configuration** for most projects. It auto-detects your project structure and uses sensible defaults.

::: tip Most Users Don't Need This
If Lien is working well for you, skip this page! Configuration is only needed for advanced customization.
:::

## When You Might Need Configuration

- **Custom exclusions**: To ignore specific directories beyond defaults
- **Performance tuning**: For very large codebases (50k+ files)
- **Complexity thresholds**: To customize code quality analysis

## Global Configuration

Global settings live in `~/.lien/config.json` and control the storage backend. You can manage them via the CLI:

```bash
lien config get backend
lien config list
```

Or edit the file directly:

```json
{
  "backend": "sqlite"
}
```

| Key | Values | Description |
|-----|--------|-------------|
| `backend` | `sqlite` (default) | Storage backend (SQLite structural store + FTS5 lexical search) |

::: info Retired backends
Lien is local-first: the SQLite structural store is the only backend. The earlier
LanceDB + embeddings backend was removed in favor of it (see
[ADR-011](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0011-sqlite-structural-store-fts5-lexical-search.md)),
and the Qdrant backend was retired before that. Existing configs that name a
retired backend (`backend: "lancedb"` / `"qdrant"`, or the old `qdrant.*` keys) do
not crash: Lien warns once and uses the SQLite backend. Old `code_chunks.lance`
directories left under `~/.lien/indices/` are inert after reindexing and can be
deleted to reclaim disk space.
:::

## Per-Project Configuration

Per-project settings live in `.lien.config.json` in your project root. It supports exactly one field, `complexity.thresholds` (read by `lien delta`), so most users don't need this at all.

```json
{
  "complexity": {
    "thresholds": {
      "testPaths": 15,
      "mentalLoad": 15
    }
  }
}
```

Any other key in this file is ignored with a one-time warning telling you what to delete.

## Environment Variables

You can also configure Lien via environment variables:

```bash
# Backend selection
export LIEN_BACKEND=sqlite

# Index location
export LIEN_HOME=/custom/path
```

## Auto-Detected Ecosystems

Lien automatically detects your project type via **ecosystem presets** and applies appropriate include/exclude patterns:

### Node.js/TypeScript

Detected via `package.json`. Indexes:
- `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`
- Excludes: `node_modules`, `dist`, `build`, `coverage`
- Test patterns: `*.test.ts`, `*.spec.ts`, `__tests__/**`

### Laravel/PHP

Detected via `composer.json`. Indexes:
- `app/**/*.php`, `routes/**/*.php`, `config/**/*.php`
- Vue/React files in `resources/js/`
- Excludes: `vendor`, `storage`, `bootstrap/cache`
- Test patterns: `tests/**/*Test.php`

### Python

Detected via `requirements.txt`, `setup.py`, `pyproject.toml`, or `Pipfile`. Indexes:
- `**/*.py`
- Excludes: `venv`, `.venv`, `__pycache__`, `*.pyc`, `*.pyo`, `*.pyd`, `*.egg-info`, `.tox`, `.pytest_cache`, `.mypy_cache`, `.coverage`, `htmlcov`, `docs/_build`, `migrations`
- Test patterns: `test_*.py`, `*_test.py`, `tests/**`

### Django

Detected via `manage.py`. Indexes:
- `**/*.py`
- Excludes: `staticfiles`, `media`, `*.sqlite3`
- Test patterns: `test_*.py`, `*_test.py`

### Ruby

Detected via `Gemfile`. Indexes:
- `**/*.rb`
- Excludes: `tmp`, `.bundle`, `log`, `coverage`, `public/assets`, `public/packs`
- Test patterns: `*_test.rb`, `*_spec.rb`

### Rails

Detected via `bin/rails`. Indexes:
- `**/*.rb` (the Rails preset adds Rails-specific excludes)
- Excludes: `db/migrate`, `db/seeds/**`, `storage`, `tmp`, `log`, `public/assets`, `public/packs`
- Test patterns: `*_test.rb`, `*_spec.rb`

### Rust

Detected via `Cargo.toml`. Indexes:
- `**/*.rs`
- Excludes: `target`
- Test patterns: `#[test]` annotations, `tests/**`

### JVM (Java/Kotlin/Scala)

Detected via `pom.xml`, `build.gradle`, or `build.gradle.kts`. Indexes:
- `**/*.java`, `**/*.kt`, `**/*.scala`
- Excludes: `.gradle`, `target`, `out`, `.idea`, `*.class`
- Test patterns: `*Test.java`, `*Spec.kt`

### Swift

Detected via `Package.swift`, `*.xcodeproj`, or `*.xcworkspace`. Indexes:
- `**/*.swift`
- Excludes: `.build`, `DerivedData`, `*.xcodeproj`, `Pods`
- Test patterns: `*Tests.swift`

### .NET

Detected via `*.csproj` or `*.sln`. Indexes:
- `**/*.cs`
- Excludes: `bin`, `obj`, `packages`, `.vs`
- Test patterns: `*Tests.cs`, `*Test.cs`

### Astro

Detected via `astro.config.*`. Indexes:
- `**/*.ts`, `**/*.tsx`
- Excludes: `.astro`

### Liquid

Liquid (`.liquid`) files are indexed via the default scan pattern: no ecosystem preset or auto-detection is required. They work out of the box alongside all other supported file types.

### YAML

YAML (`.yml`/`.yaml`) files are indexed via the default scan pattern, chunked by top-level key into `search_code`-able config sections (e.g. a GitHub Actions `jobs.review` block). This includes `.github/**` explicitly, so CI workflow files under `.github/workflows/` are indexed even though the default scan otherwise skips dot-directories. Other dot-directory CI configs (e.g. `.circleci/config.yml`, a root `.gitlab-ci.yml`) are **not yet indexed**: only `.github/**` is covered today.

### Monorepos

Lien automatically detects multiple ecosystems in monorepos. For example, a repo with both `package.json` and `backend/composer.json` will index both Node.js and Laravel code with appropriate patterns.

## Complexity Analysis

Configure complexity analysis for the `lien complexity` command and `get_complexity` MCP tool. Lien tracks **four metrics**:

- **Test Paths (Cyclomatic)**: Number of test cases needed for full branch coverage
- **Mental Load**: How hard it is to follow the code (penalizes nesting depth)
- **Time to Understand**: Estimated reading time based on Halstead effort
- **Estimated Bugs**: Predicted bug count based on Halstead effort (Effort^(2/3) / 3000)

```json
{
  "complexity": {
    "thresholds": {
      "testPaths": 15,
      "mentalLoad": 15,
      "timeToUnderstandMinutes": 60,
      "estimatedBugs": 1.5
    }
  }
}
```

#### Thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| `testPaths` | 15 | 🔀 Max test paths per function |
| `mentalLoad` | 15 | 🧠 Max mental load score (nesting penalty) |
| `timeToUnderstandMinutes` | 60 | ⏱️ Functions taking longer than 1 hour to understand |
| `estimatedBugs` | 1.5 | 🐛 Flag functions estimated to have >1.5 bugs |

::: tip Severity Levels
- **Warning**: When value exceeds threshold (e.g., testPaths ≥ 15)
- **Error**: When value exceeds 2× threshold (e.g., testPaths ≥ 30)
:::

## Migrating from Old Config Files

Older versions of `.lien.config.json` supported a lot more: `core`, `chunking`, `mcp`, `gitDetection`, `fileWatching`, `storage`, a deprecated `frameworks` array, and an even older `indexing`-based shape. None of it ever affected indexing, search, chunking, or the MCP server in practice. Lien now uses:

1. **Ecosystem presets** for auto-detecting project type and patterns (automatic, not configurable)
2. **Global config** at `~/.lien/config.json` for backend selection (managed via `lien config`)
3. **Per-project config** at `.lien.config.json` for `complexity.thresholds` only (optional)

If your `.lien.config.json` still has any of the retired sections, Lien handles it the same way it
handles a retired backend name above: it warns once per section, telling you what to delete, and
ignores the rest. No re-index needed, and your indices keep working.


