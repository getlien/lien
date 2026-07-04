# How It Works

Lien is a local-first **code-intelligence layer** for AI agents. Its core value is
structural — dependency graphs, complexity metrics, and test associations — with
fast lexical search alongside for discovery. Everything runs on your machine, and
there is **no embedding model to download**.

## The Journey of Your Code

### 1. 🔍 Indexing
When you run `lien index`, Lien scans your codebase and breaks each file into
manageable chunks using Tree-sitter AST parsing. Each chunk is a logical unit — a
function, a method, a class, or a related block — enriched with its symbol name,
signature, complexity metrics, imports/exports, and call sites.

### 2. 💾 Storage
Chunks and the import graph are written to a local **SQLite** database in
`~/.lien/indices/`. There is no vector step and no model: indexing is CPU-bound
parsing plus a SQLite write, so it starts instantly and works fully offline.

### 3. 🧩 Structural answers
Most of what an AI agent asks Lien is structural, and those questions are answered
directly from SQLite with indexed queries:
- **`get_files_context`** — chunks + test associations for a file (sub-millisecond)
- **`get_dependents`** — reverse dependencies and blast-radius risk
- **`get_complexity`** — complexity hotspots ranked by metric
- **`list_functions`** — symbols matching a name pattern

### 4. 🎯 Lexical search
For discovery ("where is the retry backoff handled?"), Lien runs **FTS5/BM25**
full-text search over three indexed columns: the symbol name, an identifier-split
copy of the symbol name (`parseImportStatement` → `parse import statement`), and
the chunk content (including comments and docstrings). Results are ranked by BM25,
weighting symbol-name matches highest.

## Why Lexical + Structural (Not Semantic)

Lien used to embed code into vectors for meaning-based search. Dogfooding showed
that the queries that actually make Lien valuable to an agent are **structural**,
not semantic — and that the embedding model imposed a ~100MB download and a heavy
install for a secondary capability. So Lien dropped embeddings entirely (see
[ADR-011](https://github.com/getlien/lien/blob/main/docs/architecture/decisions/0011-sqlite-structural-store-fts5-lexical-search.md)).

**What lexical search does well:**
- Exact and near-exact terminology — as good as embeddings, and **explainable**
  (you can see which query terms matched)
- Symbol/identifier lookup, including substrings of camelCase identifiers
- Joining relevance to structure (complexity thresholds, import graph, type/language)
- Code with good comments — docstrings bridge natural-language terms to identifiers

**Where lexical search cannot help (the honest gaps):**
- **Paraphrase/synonym queries that share no words with the code.** Searching
  "auth" will not surface `login`, `hashPassword`, or `verifyToken`; "check if the
  user is logged in" will not surface `verifyToken()`. There is no vocabulary in
  common, and no amount of stemming bridges a genuine synonym gap.
- **Sparsely-commented code.** When a match succeeds on natural-language phrasing,
  it usually succeeded because a nearby comment reused the query's words. Strip the
  comments and recall degrades.

**Practical guidance:** query with concrete keywords, identifiers, and domain
terms that appear in the code — not natural-language questions. For an exact symbol
name, use `list_functions`. For structure and impact, use the structural tools
above.

::: tip Coming from the semantic era?
The MCP tool is still named `search_code` for backward compatibility, but it
now performs full-text keyword search — it does not embed your query. Phrase
queries as keywords, not questions.
:::

## Privacy First

Everything runs locally:
- ✅ Your code never leaves your machine
- ✅ No external API calls
- ✅ No telemetry or tracking
- ✅ No internet required — not even for first-run setup

## Architecture

Lien is built with modern, performant tools:
- **TypeScript** for type-safe development
- **Tree-sitter** for AST-based semantic chunking and complexity analysis
- **SQLite** (`better-sqlite3`) for the structural store, with **FTS5/BM25** for lexical search
- **Model Context Protocol (MCP)** for AI assistant integration (Cursor, Claude Code, etc.)

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
- **Monorepos** - Multiple ecosystems in one repo (e.g., Node.js frontend + Laravel backend)

Each ecosystem preset applies appropriate file exclusions (e.g., ignoring `node_modules` or `vendor`). Additionally, 15+ languages (including Liquid, Go, C/C++, and more) are indexed out of the box via the default scan pattern.

## Supported Languages

Lien indexes and understands code in:

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

**Indexed for lexical search** (chunking + FTS5):
- All of the above, plus C/C++, Vue, Scala, Markdown, and more!

## Complexity Analysis

Lien tracks four complementary complexity metrics:

| Metric | What it Measures | Best For |
|--------|-----------------|----------|
| **Cyclomatic** | Decision paths (if, for, switch) | Testability - how many tests needed? |
| **Cognitive** | Mental effort (nesting depth, breaks) | Understandability - how hard to read? |
| **Halstead Effort** | Reading time based on operators/operands | Learning curve - how long to understand? |
| **Halstead Bugs** | Predicted bug count (Effort^(2/3) / 3000) | Reliability - how bug-prone is this? |

All metrics are calculated during indexing using Tree-sitter AST parsing. Cognitive complexity is based on [SonarSource's specification](https://www.sonarsource.com/docs/CognitiveComplexity.pdf), Halstead metrics are based on Maurice Halstead's "Elements of Software Science" (1977).

## Git Worktree Support

A linked git worktree (`git worktree add`) shares the main checkout's index
instead of building its own full copy. When Lien's root is a linked worktree,
it opens the main checkout's index as a read-only **base** and stores only a
small **overlay** at the worktree's own index location — chunk rows for
whatever files differ from the base (edited or new), plus a small "mask" that
suppresses base rows for files the worktree changed or deleted. Reads merge
the two: an unchanged file resolves from the base, a changed or new file
resolves from the overlay, and a file deleted in the worktree resolves from
neither.

This is automatic — `lien index` and `lien serve` detect a linked worktree
(`git rev-parse --git-dir` differs from `--git-common-dir`) and locate the
main checkout via `git worktree list`, no configuration needed. It's also safe
by construction: the base is opened read-only, so a worktree process can never
write to the main checkout's index. Every uncertain case — the main checkout
has no index yet, its index format doesn't match, or the base becomes
unavailable mid-session — falls back to a full, independent index rather than
erroring.

**Escape hatch:** set `LIEN_WORKTREE_STANDALONE=1` to force the old,
fully-independent behavior for a worktree.

**Known v1 limitations:**
- Full-text search ranks are merged approximately across the base and overlay
  corpora — BM25 scores are corpus-relative, so this isn't a single
  statistically correct ranking. In practice the overlay is small and
  exact-symbol matches dominate, so this rarely changes what you see.
- The base index is located by the exact path string the main checkout was
  indexed under. If that checkout lives behind a symlink and was indexed under
  a different path spelling than `git worktree list` reports, its worktrees
  fall back to a standalone index instead of sharing (safe, just not shared).

**Why this matters:** without this, every linked worktree got its own
complete index. A ~30-worktree agent setup on one repo produced a 21 GB pile
of near-identical indexes before this existed
([#651](https://github.com/getlien/lien/pull/651)). Sharing cuts that down to
the base size once, plus a typically kilobytes-to-low-megabytes overlay per
worktree.

## Performance

- **File context lookup:** sub-millisecond (indexed lookup by file)
- **Small projects** (1k files): minutes to index
- **Medium projects** (10k files): ~15-20 minutes to index
- **Native install:** ~1.8MB (SQLite binding) — no model download
- **Disk usage:** roughly comparable to the source it indexes for a standalone
  index; a linked git worktree instead pays only for its overlay (see
  [Git Worktree Support](#git-worktree-support) above)

---

Ready to get started? Check out our [Quick Start Guide](/guide/getting-started)!
