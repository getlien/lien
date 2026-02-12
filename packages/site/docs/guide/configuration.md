# Configuration

Lien works with **zero configuration** for most projects. It auto-detects your project structure and uses sensible defaults.

::: tip Most Users Don't Need This
If Lien is working well for you, skip this page! Configuration is only needed for advanced customization.
:::

## When You Might Need Configuration

- **Qdrant backend**: For cross-repository search across your organization
- **Custom exclusions**: To ignore specific directories beyond defaults
- **Performance tuning**: For very large codebases (50k+ files)
- **Complexity thresholds**: To customize code quality analysis

## Global Configuration

Global settings live in `~/.lien/config.json` and control the vector database backend. You can manage them via the CLI:

```bash
lien config set backend qdrant
lien config set qdrant.url http://localhost:6333
lien config get backend
lien config list
```

Or edit the file directly:

```json
{
  "backend": "lancedb",
  "qdrant": {
    "url": "http://localhost:6333",
    "apiKey": "your-api-key"
  }
}
```

| Key | Values | Description |
|-----|--------|-------------|
| `backend` | `lancedb` (default), `qdrant` | Vector database backend |
| `qdrant.url` | any URL | Qdrant server URL |
| `qdrant.apiKey` | any string | Qdrant API key |

## Per-Project Configuration

Per-project settings live in `.lien.config.json` in your project root. Most users don't need this — Lien works with sensible defaults.

```json
{
  "core": {
    "concurrency": 4,
    "embeddingBatchSize": 50
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
export LIEN_BACKEND=qdrant

# Qdrant configuration
export LIEN_QDRANT_URL=http://localhost:6333
export LIEN_QDRANT_API_KEY=your-api-key

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
- `app/**/*.rb`, `config/**/*.rb`, `lib/**/*.rb`
- Excludes: `db/migrate`, `db/seeds`, `storage`, `tmp`, `log`, `public/assets`, `public/packs`
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
    "concurrency": 4,
    "embeddingBatchSize": 50
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | 4 | Files processed in parallel. Use 6-8 for 8+ cores. |
| `embeddingBatchSize` | 50 | Chunks per embedding batch. Reduce to 25 for <8GB RAM. |

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

## Performance Tuning

These settings go in per-project `.lien.config.json` under the `core` key:

| Use Case | `concurrency` | `embeddingBatchSize` |
|----------|---------------|---------------------|
| Large codebases (50k+ files) | 8 | 100 |
| Limited RAM (<8GB) | 2 | 25 |
| Modern machine (SSD, 8+ cores) | 6 | 75 |
| Default (works for most) | 4 | 50 |

## Qdrant Backend (Cross-Repo Search)

For cross-repository search across your organization:

```json
{
  "backend": "qdrant",
  "qdrant": {
    "url": "http://localhost:6333",
    "apiKey": "your-api-key"
  }
}
```

Or via environment variables:

```bash
export LIEN_BACKEND=qdrant
export LIEN_QDRANT_URL=http://localhost:6333
export LIEN_QDRANT_API_KEY=your-api-key
```

::: tip
The `orgId` is automatically extracted from your git remote URL. Cross-repo search requires all repos to share the same `orgId`.
:::

## Migrating from Old Config Files

If you have an existing `.lien.config.json` with a `frameworks` array from older versions, the `frameworks` field is deprecated. Lien now uses:

1. **Ecosystem presets** for auto-detecting project type and patterns
2. **Global config** at `~/.lien/config.json` for backend selection (managed via `lien config`)
3. **Per-project config** at `.lien.config.json` for indexing/chunking tuning (optional)
4. **Environment variables** for Qdrant configuration

Your indices will continue to work—no need to re-index.


