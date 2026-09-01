# How It Works

Lien is a local-first **code-intelligence CLI** for AI agents. Its core value is
structural: complexity metrics, fan-in/dependency signals, and deterministic
review signals over a diff. Everything runs on your machine, on demand, and
there is **no persisted index, no server, and no embedding model to download**.

## The Journey of Your Code

### 1. Parsing

Every command starts the same way: Lien scans your codebase and breaks each
file into manageable chunks using Tree-sitter AST parsing, in memory, for the
life of that one command. Each chunk is a logical unit (a function, a method,
a class, or a related block) enriched with its symbol name, signature,
complexity metrics, and imports/exports. Nothing is written to disk — the
next command you run parses fresh again.

### 2. Structural answers

Each of Lien's four commands answers a structural question directly from
that fresh parse:

- **`lien complexity`**: complexity hotspots ranked by metric, across the whole codebase
- **`lien health`**: functions ranked by complexity × fan-in ÷ test coverage
- **`lien review`**: deterministic signals over your working-tree diff (stale literals, removed exports, doc drift, and more)
- **`lien delta`**: complexity threshold crossings introduced since `HEAD`

## Privacy First

Everything runs locally:
- Your code never leaves your machine
- No external API calls
- No telemetry or tracking
- No internet required, not even for first-run setup

## Architecture

Lien is built with:
- **Rust** (`@liendev/parser-native`) for parsing: a small native crate that statically links Tree-sitter and all supported language grammars, and returns one serialized tree per file instead of a live object graph, which avoids the per-node call overhead of a JS-to-native binding. It ships as prebuilt binaries for every supported platform, so installing Lien never compiles anything
- **TypeScript** for type-safe development

## Want to Learn More?

For detailed technical architecture, flow diagrams, and implementation details, see the [Architecture Documentation on GitHub](https://github.com/getlien/lien/tree/main/docs/architecture).

## Ecosystem-Aware & Monorepo Support

Lien automatically detects your project type via **12 ecosystem presets**:
- **Node.js/TypeScript** - via package.json
- **Python** - via pyproject.toml, setup.py, requirements.txt
- **PHP** - via composer.json
- **Laravel** - via artisan
- **Django** - via manage.py
- **Ruby** - via Gemfile
- **Rails** - via bin/rails
- **Rust** - via Cargo.toml
- **JVM (Java/Kotlin/Scala)** - via pom.xml, build.gradle
- **Swift** - via Package.swift, *.xcodeproj
- **.NET** - via *.csproj, *.sln
- **Astro** - via astro.config.*

Each preset applies file exclusions appropriate to that ecosystem (for example, ignoring `node_modules` or `vendor`). Monorepos with multiple ecosystems (a Node.js frontend alongside a Laravel backend, say) are handled by combining the detected presets, not through a preset of their own. See [Supported Languages](#supported-languages) below for the full language list, including languages scanned without an ecosystem preset (Liquid, YAML, and more).

## Supported Languages

Lien parses and understands code in:

**Full AST Support** (function detection, complexity analysis):
- TypeScript, JavaScript (JSX/TSX)
- Python
- PHP
- Rust
- Go
- Java
- C#
- Ruby
- Kotlin
- Swift

**Chunked without full AST** (used by `lien review`'s whole-repo cross-file signals, e.g. detecting a stale literal duplicated elsewhere):
- All of the above, plus C/C++, Vue, Scala, Markdown, YAML (config sections, e.g. GitHub Actions workflows), and more!

## Complexity Analysis

Lien tracks four complementary complexity metrics:

| Metric | What it Measures | Best For |
|--------|-----------------|----------|
| **Cyclomatic** | Decision paths (if, for, switch) | Testability - how many tests needed? |
| **Cognitive** | Mental effort (nesting depth, breaks) | Understandability - how hard to read? |
| **Halstead Effort** | Reading time based on operators/operands | Learning curve - how long to understand? |
| **Halstead Bugs** | Predicted bug count (Effort^(2/3) / 3000) | Reliability - how bug-prone is this? |

All metrics are calculated fresh on every run, from the same Tree-sitter AST parse. Cognitive complexity is based on [SonarSource's specification](https://www.sonarsource.com/docs/CognitiveComplexity.pdf), Halstead metrics are based on Maurice Halstead's "Elements of Software Science" (1977).

## Performance

Real numbers from `lien health` against this repo (Apple Silicon, M3 Pro, 2026-08): 606 files, 8,923 chunks, parsed in 1.5 seconds — every run, since nothing is cached.

- **Parsing:** 1.82-2.21x faster end-to-end than Lien's previous `node-tree-sitter`-based parser, measured across benchmarked languages (see [ADR-013](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md))
- **Native install:** ~22MB of native binaries for your platform (~20MB prebuilt parser binary; only the one matching platform variant is downloaded), with no model download and no compiler toolchain
- **Scaling:** parsing is CPU-bound and roughly linear in file count, with no embedding step to slow it down. The largest corpus measured here is Lien's own 606-file monorepo, so anything past that is extrapolation rather than direct measurement, but scaling these numbers out lands a 10k-file project in the tens of seconds, not minutes.

---

Ready to get started? Check out our [Quick Start Guide](/guide/getting-started)!
