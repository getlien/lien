# Configuration

Lien works with **zero configuration** for every command. It auto-detects your project structure and uses sensible defaults.

::: tip Most Users Don't Need This
If Lien is working well for you, skip this page! Configuration is only needed for customizing complexity thresholds.
:::

## When You Might Need Configuration

- **Complexity thresholds**: To customize the thresholds `lien delta` gates on

That's the only thing left to configure — there's no index, no storage backend, and no global settings file.

## Per-Project Configuration

Per-project settings live in `.lien.config.json` in your project root. It supports exactly one field, `complexity.thresholds` (read by `lien delta`), so most users don't need this file at all.

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

Any other key in this file is ignored with a one-time warning telling you what to delete. `lien delta --threshold <n>` overrides these thresholds for a single run without editing the file.

::: info `lien complexity` uses fixed thresholds
`.lien.config.json`'s `complexity.thresholds` is read only by `lien delta`. `lien complexity` (the whole-codebase report) uses its own fixed severity bands — see [CLI Commands](/guide/cli-commands#lien-complexity).
:::

## Auto-Detected Ecosystems

Lien automatically detects your project type via **ecosystem presets** and applies appropriate include/exclude patterns when it scans:

### Node.js/TypeScript

Detected via `package.json`. Scans:
- `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`
- Excludes: `node_modules`, `dist`, `build`, `coverage`
- Test patterns: `*.test.ts`, `*.spec.ts`, `__tests__/**`

### Laravel/PHP

Detected via `composer.json`. Scans:
- `app/**/*.php`, `routes/**/*.php`, `config/**/*.php`
- Vue/React files in `resources/js/`
- Excludes: `vendor`, `storage`, `bootstrap/cache`
- Test patterns: `tests/**/*Test.php`

### Python

Detected via `requirements.txt`, `setup.py`, `pyproject.toml`, or `Pipfile`. Scans:
- `**/*.py`
- Excludes: `venv`, `.venv`, `__pycache__`, `*.pyc`, `*.pyo`, `*.pyd`, `*.egg-info`, `.tox`, `.pytest_cache`, `.mypy_cache`, `.coverage`, `htmlcov`, `docs/_build`, `migrations`
- Test patterns: `test_*.py`, `*_test.py`, `tests/**`

### Django

Detected via `manage.py`. Scans:
- `**/*.py`
- Excludes: `staticfiles`, `media`, `*.sqlite3`
- Test patterns: `test_*.py`, `*_test.py`

### Ruby

Detected via `Gemfile`. Scans:
- `**/*.rb`
- Excludes: `tmp`, `.bundle`, `log`, `coverage`, `public/assets`, `public/packs`
- Test patterns: `*_test.rb`, `*_spec.rb`

### Rails

Detected via `bin/rails`. Scans:
- `**/*.rb` (the Rails preset adds Rails-specific excludes)
- Excludes: `db/migrate`, `db/seeds/**`, `storage`, `tmp`, `log`, `public/assets`, `public/packs`
- Test patterns: `*_test.rb`, `*_spec.rb`

### Rust

Detected via `Cargo.toml`. Scans:
- `**/*.rs`
- Excludes: `target`
- Test patterns: `#[test]` annotations, `tests/**`

### JVM (Java/Kotlin/Scala)

Detected via `pom.xml`, `build.gradle`, or `build.gradle.kts`. Scans:
- `**/*.java`, `**/*.kt`, `**/*.scala`
- Excludes: `.gradle`, `target`, `out`, `.idea`, `*.class`
- Test patterns: `*Test.java`, `*Spec.kt`

### Swift

Detected via `Package.swift`, `*.xcodeproj`, or `*.xcworkspace`. Scans:
- `**/*.swift`
- Excludes: `.build`, `DerivedData`, `*.xcodeproj`, `Pods`
- Test patterns: `*Tests.swift`

### .NET

Detected via `*.csproj` or `*.sln`. Scans:
- `**/*.cs`
- Excludes: `bin`, `obj`, `packages`, `.vs`
- Test patterns: `*Tests.cs`, `*Test.cs`

### Astro

Detected via `astro.config.*`. Scans:
- `**/*.ts`, `**/*.tsx`
- Excludes: `.astro`

### Liquid

Liquid (`.liquid`) files are scanned via the default pattern: no ecosystem preset or auto-detection is required. They work out of the box alongside all other supported file types.

### YAML

YAML (`.yml`/`.yaml`) files are chunked by top-level key (e.g. a GitHub Actions `jobs.review` block) via the default scan pattern. This includes `.github/**` explicitly, so CI workflow files under `.github/workflows/` are scanned even though the default scan otherwise skips dot-directories. Other dot-directory CI configs (e.g. `.circleci/config.yml`, a root `.gitlab-ci.yml`) are **not yet scanned**: only `.github/**` is covered today.

### Monorepos

Lien automatically detects multiple ecosystems in monorepos. For example, a repo with both `package.json` and `backend/composer.json` will scan both Node.js and Laravel code with appropriate patterns.

## Complexity Analysis

Configure the thresholds `lien delta` gates on. Lien tracks **four metrics**:

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

Older versions of `.lien.config.json` supported a lot more: `core`, `chunking`, `mcp`, `gitDetection`, `fileWatching`, `storage`, a deprecated `frameworks` array, and an even older `indexing`-based shape — plus, until recently, a global `~/.lien/config.json` for storage-backend selection. None of it ever affected the commands that remain today. `.lien.config.json`'s `complexity.thresholds` is now the only configuration Lien reads, anywhere.

If your `.lien.config.json` still has any of the retired top-level sections, Lien warns once per section, telling you what to delete, and ignores the rest — no re-index needed (there's no index to rebuild).
