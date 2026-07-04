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
not crash — Lien warns once and uses the SQLite backend. Old `code_chunks.lance`
directories left under `~/.lien/indices/` are inert after reindexing and can be
deleted to reclaim disk space.
:::

## Per-Project Configuration

Per-project settings live in `.lien.config.json` in your project root. Most users don't need this — Lien works with sensible defaults.

```json
{
  "core": {
    "concurrency": 4
  },
  "complexity": {
    "enabled": true,
    "thresholds": {
      "testPaths": 15,
      "mentalLoad": 15
    }
  }
}
```

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

Liquid (`.liquid`) files are indexed via the default scan pattern—no ecosystem preset or auto-detection is required. They work out of the box alongside all other supported file types.

### Monorepos

Lien automatically detects multiple ecosystems in monorepos. For example, a repo with both `package.json` and `backend/composer.json` will index both Node.js and Laravel code with appropriate patterns.

## Indexing Options

These options go in the per-project `.lien.config.json` under the `core` key:

```json
{
  "core": {
    "concurrency": 4
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | 4 | Files processed in parallel. Use 6-8 for 8+ cores. |

## Complexity Analysis

Configure complexity analysis for the `lien complexity` command and `get_complexity` MCP tool. Lien tracks **four metrics**:

- **Test Paths (Cyclomatic)**: Number of test cases needed for full branch coverage
- **Mental Load**: How hard it is to follow the code (penalizes nesting depth)
- **Time to Understand**: Estimated reading time based on Halstead effort
- **Estimated Bugs**: Predicted bug count based on Halstead volume (Volume / 3000)

```json
{
  "complexity": {
    "enabled": true,
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

## Chunking

Control how Lien splits your source files into semantic chunks:

```json
{
  "chunking": {
    "useAST": true,
    "astFallback": "line-based"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `useAST` | `true` | Use AST-based chunking for supported languages. When `false`, falls back to line-based chunking. |
| `astFallback` | `"line-based"` | What to do when AST parsing fails. `"line-based"` falls back to line-based chunking; `"error"` throws an error. |

## Performance Tuning

These settings go in per-project `.lien.config.json` under the `core` key:

| Use Case | `concurrency` |
|----------|---------------|
| Large codebases (50k+ files) | 8 |
| Limited RAM (<8GB) | 2 |
| Modern machine (SSD, 8+ cores) | 6 |
| Default (works for most) | 4 |

## Migrating from Old Config Files

If you have an existing `.lien.config.json` with a `frameworks` array from older versions, the `frameworks` field is deprecated. Lien now uses:

1. **Ecosystem presets** for auto-detecting project type and patterns
2. **Global config** at `~/.lien/config.json` for backend selection (managed via `lien config`)
3. **Per-project config** at `.lien.config.json` for indexing/chunking tuning (optional)

Your indices will continue to work—no need to re-index.


