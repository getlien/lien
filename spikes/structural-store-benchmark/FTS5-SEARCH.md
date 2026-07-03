# FTS5 lexical + hybrid search demo — mechanism, shape, latency

**SPIKE — not for merge.** REPORT.md already settled the storage-backend
question (better-sqlite3). This is the follow-up question: now that LanceDB's
vector search is gone, does FTS5 keyword search + trigram substring search +
hybrid lexical-structural JOINs actually work, and is it fast enough?

**This validates the MECHANISM and SHAPE (and latency), not a quality
verdict.** The eyeball section below is honest about hits *and* misses. The
real verdict comes from dogfooding the actual tool.

## What was built

`lib/fts5-store.mjs` builds a fresh `better-sqlite3` database with the same
relational schema the A/B benchmark's adapter uses (`chunks` + `chunk_imports`,
same columns, same indices — see REPORT.md/README.md), plus two FTS5 virtual
tables, both **external content** (no duplicated row storage; they index
`chunks` in place via `content_rowid`):

| Table | Tokenizer | Columns | Role |
|---|---|---|---|
| `chunks_fts` | `porter unicode61` | `symbolName`, `content` | BM25-ranked keyword search. `symbolName` is a separate column so a match on the symbol's own name can be weighted higher (`bm25(chunks_fts, 4.0, 1.0)`). |
| `chunks_symtri` | `trigram` | `symbolName` | Indexed substring search — the `list_functions` use case, without a full-table scan + regex. Case-insensitive by default. |

Both are populated in one shot via FTS5's `INSERT INTO tbl(tbl) VALUES('rebuild')`
command (no per-row insert loop needed — it reads the whole `chunks` table).

`fts5.mjs` builds the index, benchmarks all three query modes plus the
existing regex baseline, and dumps real example output. Run it with
`npx tsx fts5.mjs` per the README.

**One real bug caught and fixed while building this**: the first hybrid query
(FTS match → chunk → `chunk_imports` filtered by `import_path`) took **~4.4s**
per call. `EXPLAIN QUERY PLAN` showed why — `chunk_imports` (387,640 rows) only
had an index on `import_path`, so for *every* FTS-matched chunk, SQLite
re-scanned all 27,480 rows sharing the target import path looking for a
`chunk_id` match, instead of doing an indexed point lookup. Adding
`CREATE INDEX idx_chunk_imports_chunk_id ON chunk_imports(chunk_id, import_path)`
(the direction the join actually walks) dropped it to **~0.5ms** — a ~9000x
difference from one missing composite index. Kept as a genuine caveat: hybrid
queries need their join-direction indices designed on purpose, they don't fall
out for free.

## Latency (p50/p95 ms, N≥100, warm-ups discarded, darwin-arm64)

| Query mode | p50 | p95 | mean | N |
|---|---:|---:|---:|---:|
| **A) Keyword search (BM25, porter)** | **6.79** | 13.37 | 7.79 | 100 |
| — vs. current `list_functions` regex scan (baseline, same corpus) | 332.59 | 379.98 | 337.55 | 100 |
| **B) Symbol/substring search (trigram)** | **0.21** | 0.36 | 0.19 | 150 |
| **C) Hybrid — content∩imports** (traverse, imports `@liendev/parser`) | **0.50** | 0.65 | 0.52 | 100 |
| **C) Hybrid — symbol∩complexity** (process, complexity≥6) | **0.21** | 0.24 | 0.22 | 100 |
| **C) Hybrid — content∩structural** (cache, function+typescript) | **0.34** | 0.40 | 0.35 | 100 |

Index build: 1.4–1.6s for the full 44,430-chunk corpus (both FTS5 tables +
structural indices), in line with the plain `better-sqlite3` adapter's 844ms
build in REPORT.md.

**Headline: BM25 keyword search is ~49x faster than the regex scan
`list_functions` runs today (6.79ms vs 332.59ms p50)**, and it's *ranked* —
today's regex path returns whatever matches in table order, unordered by
relevance. Trigram substring search is a further ~32x faster than that
(0.21ms) because it's a true index seek, not a scan. All three hybrid queries
land under 1ms once properly indexed — the JOIN itself isn't the cost; missing
indices are (see the bug above).

## A) Keyword search (BM25) — examples

Multi-word queries are OR-joined per term (`"parse" OR "import" OR
"statement"`) — FTS5's bareword-list default is an implicit AND, which is too
strict for short code chunks (zero hits unless every word lands in the same
chunk). BM25 still ranks multi-term matches highest.

```
query: "vector search"
  packages/core/src/vectordb/query.ts:465-468       (doc comment) "Search the vector database"
  packages/cli/src/mcp/handlers/semantic-search.ts   (doc comment)
  packages/core/src/vectordb/lancedb.ts:74-108       method search
  packages/core/src/vectordb/query.ts:469-511        function search
```
Clean top hit — the doc comment literally says "Search the vector database."

```
query: "parse import statement"
  packages/parser/src/ast/symbols.ts:234-248         (doc comment, no "parse"/"import" — see below)
  packages/parser/src/ast/languages/ruby.ts:1-23      (import block — literal "import" x8)
  packages/parser/src/ast/languages/javascript.ts:794-912  (large chunk)
  packages/parser/src/ast/languages/python.ts:226-234  method processImportSymbols  <- the real match
```
**Rank-order weakness, verified**: the #1 result doesn't mention "parse" or
"import" at all. It's a doc comment about `expression_statement` /
`call_expression` (tree-sitter node types) — unicode61 splits `expression_statement`
into tokens `expression` + `statement` on the underscore, so it matches the
"statement" term 4 times in a 14-line chunk. That term-frequency spike outranks
`processImportSymbols` (rank #4), which actually matches "import" AND
"statement" (via `import_statement`/`import_from_statement`) but each only
once. **OR-query BM25 rewards raw repetition over combined relevance** — a
real, observed failure mode, not hypothetical.

## B) Symbol/substring search (trigram) — examples

```
pattern: "Extractor"
  getExtractor, getImportExtractor, getSymbolExtractor, hasExtractor,
  LanguageSymbolExtractor, LanguageExportExtractor, LanguageImportExtractor,
  CSharpExportExtractor  ...

pattern: "handle"
  handleGetUser, handleCreateUser, handleDeleteUser, handleNotifyUser,
  handleUpdateUser, handleListUsers, handleLogin, handleChangePassword
```
Exactly the `list_functions` use case — substring match, case-insensitive,
alphabetical by file, indexed instead of scanned. No false negatives observed
against the plain-SQL substring semantics it replaces.

## C) Hybrid lexical + structural — the new capability LanceDB lacked

Three single-SQL-statement examples, each joining an FTS5 MATCH/BM25 clause
directly onto structural columns or the import-graph child table:

**1. Content match restricted by the import graph** — "chunks mentioning
traversal, in files that actually import `@liendev/parser`":
```sql
SELECT DISTINCT c.file, c.symbolName, c.symbolType, bm25(chunks_fts, 4.0, 1.0) AS rank
FROM chunks_fts
JOIN chunks c ON c.id = chunks_fts.rowid
JOIN chunk_imports ci ON ci.chunk_id = c.id
WHERE chunks_fts MATCH '"traverse" OR "traversal"' AND ci.import_path = '@liendev/parser'
ORDER BY rank LIMIT 60
```
→ `stale-literal-signals.ts` (`RepoScanResult`), `agent-tools.ts`,
`annotate-cmd.ts` (`resolvePaths`), `stale-literal-signals.test.ts`. Small
(4 hits) but precise — every hit both mentions traversal *and* imports the
target package.

**2. Symbol substring restricted by a complexity threshold** — "risky
functions matching 'process'", i.e. a triage query no single index (semantic
or lexical) does alone:
```sql
SELECT c.file, c.symbolName, c.complexity, c.cognitiveComplexity
FROM chunks_symtri t JOIN chunks c ON c.id = t.rowid
WHERE t.symbolName MATCH 'process' AND c.complexity >= 6
ORDER BY c.complexity DESC LIMIT 60
```
→ `process_files` (complexity 16, cognitive 40), `process_pipeline` (11),
`processRequireDeclaration` (8), `processFileContent`, `processImportSymbols`,
`processUseArgument`, `processTemplateContent` (6 each) — cleanly surfaces the
one clear hotspot (`process_files`) at the top. This is genuinely a query
shape embeddings alone cannot answer (no vector index carries a numeric
complexity threshold), and grep alone cannot rank by risk.

**3. Content match restricted by structural type + language** — "cache-related
functions, TypeScript only":
```sql
SELECT c.file, c.symbolName, c.language, bm25(chunks_fts, 4.0, 1.0) AS rank
FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
WHERE chunks_fts MATCH '"cache"' AND c.symbolType = 'function' AND c.language = 'typescript'
ORDER BY rank LIMIT 60
```
→ `createPathNormalizer` (x2, cli+parser copies), `createPathCache`,
`findTestAssociationsFromChunks`, `addIntentRule` — all genuinely
cache-related, all pre-filtered to actual functions (not classes/interfaces/doc
chunks) in one language, in one query.

## Honest quality eyeball — 8 agent-style queries

| # | Query (mode) | Read |
|---|---|---|
| 1 | "parse import statement" (kw) | Mixed — real match (`processImportSymbols`) ranked #4 behind a term-frequency fluke (see above). |
| 2 | "vector search implementation" (kw) | Strong — architecture docs + `query.ts`/`intent-classifier.ts` all genuinely about vector search. |
| 3 | "complexity calculation for functions" (kw) | Weak precision — top 6 are all doc-comment chunks mentioning "complexity"; the actual computing functions (`computeComplexityStats`, `calculateComplexityRiskBoost`) rank lower, pushed out by comment-heavy chunks. |
| 4 | "user authentication login flow" (kw) | Strong — `login`, `loginAndUpdateProfile`, `handleLogin` all surface, mostly because of docstrings like *"Authenticates a user with email and password credentials"* sitting right above the code. |
| 5 | "auth" (symbol/trigram) | **Real gap, confirmed** — only finds `authMiddleware` and `authenticatedBatchNotify`. Misses `login`, `hashPassword`, `verifyToken`, `decodeToken`, `TokenPayload`, `revokeUserSessions` entirely: none contain the substring "auth". A symbol-name-only index (lexical *or* trigram) cannot bridge "auth" → "login". |
| 6 | "check if user is logged in" (kw) | **Real gap, confirmed** — the actual `login()`/`verifyToken()` functions do not appear in the top 6 at all. Result set is noise matched on the single word "check" (`rules.ts` error-handling rule, `gitignore.ts`, `handleGitStartup`). Porter's stemmer does not relate "logged" to "login" (different stems) — zero token overlap, zero recall. **This is exactly the token-less-meaning gap** a semantic/embedding index is built for. |
| 7 | "file watching" (kw) | Strong — `setupFileWatching`, `serveCommand`, `watcher/index.ts::getWatchedFiles` all correct. |
| 8 | "circular dependency detection" (kw) | Strong-to-mixed — top 2 hits are inline comments literally saying "to avoid circular dependency" / "prevent circular deps" (great precision); rest of the top 6 are docs/changelog mentions (relevant but coarse-grained, whole-doc chunks rather than a function). |

**Net read**: 5/8 strong, 1/8 mixed (rank-order issue, item repairable by
better BM25 column weighting/dedup), 2/8 genuine recall gaps where the query
shares no vocabulary with the target code (#5, #6). Both gaps are the same
underlying failure — synonym/paraphrase mismatch — which is precisely what
embeddings solve and lexical search structurally cannot. Comments/docstrings
buy back a lot of this for free (queries 2, 4, 7, 8 all succeed partly *because*
the surrounding prose uses the same words as the query) — code with weak or no
comments will show gaps like #5/#6 far more often.

## Where lexical + structural is strong

- **Exact/near-exact terminology** ("vector search", "file watching") — as
  strong as or stronger than embeddings, and explainable (you can see exactly
  why a chunk matched).
- **Symbol/identifier lookup** (`list_functions`-style) — trigram substring
  search is both faster (0.21ms vs a 332ms regex scan) *and* has identical
  recall to the regex it replaces, since it's the same substring semantics,
  just indexed.
- **Anything joining relevance to structure** — complexity thresholds, import
  graphs, symbol type/language filters. This is a real capability gap LanceDB
  had (no SQL, no arbitrary JOINs against a vector index) that better-sqlite3
  closes for free.
- **Code with good comments** — docstrings act as a bridge between an agent's
  natural-language query and camelCase/snake_case identifiers, recovering a
  meaningful chunk of what would otherwise be embedding territory.

## Where it would likely miss vs. semantic (honest gaps)

- **Paraphrase / synonym queries with no shared vocabulary** — "check if user
  is logged in" vs. `login()`/`verifyToken()` (confirmed miss, #6 above);
  "auth" vs. `login`/`hashPassword` (confirmed miss, #5 above). No amount of
  stemming or trigram fuzziness bridges a genuine synonym gap.
- **CamelCase/PascalCase tokenization** — porter/unicode61 treats
  `parseImportStatement` as one token; a keyword search for "parse" will not
  match it via the symbol column (only via content, if the surrounding prose
  repeats the word). Not exercised by a real failure here only because the
  corpus's docstrings compensate — a comment-sparse codebase would feel this
  more.
- **Sparsely-commented code** — every "strong" result above leaned on a
  docstring or inline comment containing the query's actual words. Strip the
  comments and several of these degrade toward the #5/#6 failure mode.

## Caveats

- One corpus (this repo, 10x replicated for scale), one machine
  (darwin-arm64), one BM25 weighting choice (`symbolName` 4x, `content` 1x —
  untuned). Directional, not a benchmark suite.
- OR-joining query terms is a deliberate, simple choice for this spike, not a
  final design — a real implementation would likely want phrase queries,
  stopword handling, and probably a smarter camelCase-aware tokenizer
  (splitting identifiers before indexing) to close the tokenization gap above.
- The composite-index bug (see "What was built") generalizes: any hybrid query
  needs its join-direction thought through, same as any other SQL query. This
  isn't a knock against the approach, just against assuming JOINs are free.
- This is still an eyeball, not a scored benchmark. The 2 confirmed recall
  gaps are real but come from 8 hand-picked queries against one repo; the
  actual quality verdict has to come from dogfooding the shipped tool against
  real agent usage.
