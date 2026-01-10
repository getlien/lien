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

Create `~/.lien/config.json` for settings that apply to all projects:

```json
{
  "backend": "lancedb",
  "indexing": {
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

## Auto-Detected Frameworks

Lien automatically detects and configures these frameworks:

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

### Shopify (Liquid)

Detected via `config/settings_schema.json`. Indexes:
- `layout/**/*.liquid`, `sections/**/*.liquid`, `snippets/**/*.liquid`
- `templates/**/*.liquid`, `blocks/**/*.liquid`
- Config JSON files

### Monorepos

Lien automatically detects multiple frameworks in monorepos. For example, a repo with both `package.json` and `backend/composer.json` will index both Node.js and Laravel code with appropriate patterns.

## Indexing Options

These options go in `~/.lien/config.json`:

```json
{
  "indexing": {
    "concurrency": 4,
    "embeddingBatchSize": 50,
    "indexTests": true,
    "useImportAnalysis": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | 4 | Files processed in parallel. Use 6-8 for 8+ cores. |
| `embeddingBatchSize` | 50 | Chunks per embedding batch. Reduce to 25 for <8GB RAM. |
| `indexTests` | true | Index test files and detect test associations |
| `useImportAnalysis` | true | Enable import-based test detection (more accurate) |

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

All settings go in `~/.lien/config.json`:

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

## Migrating from Config Files

If you have an existing `.lien.config.json` from older versions, you can safely delete it. Lien now uses:

1. **Auto-detection** for frameworks and patterns
2. **Global config** at `~/.lien/config.json` for advanced settings
3. **Environment variables** for Qdrant configuration

Your indices will continue to work—no need to re-index.


