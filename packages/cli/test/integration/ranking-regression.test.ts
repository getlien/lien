import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { indexCodebase, createVectorDB, type VectorDBInterface } from '@liendev/core';
import { computeDependentCountsFromChunks } from '@liendev/parser';

/**
 * Ranking regression harness (#1071).
 *
 * ## Why this exists
 *
 * `search_code`'s structural ranking boost (`applyStructuralBoost` in
 * `packages/core/src/vectordb/sqlite/fts-search.ts`) blends a file's bm25
 * relevance with `dependentCount` -- how many other files import it. Before
 * #1071, `dependentCount` was computed by a private ~40-line resolver that
 * only understood `./foo`/`../bar` specifiers, so on any language whose
 * imports are dotted namespaces or module URLs (C#, Java, Kotlin, Swift, Go,
 * Rust) EVERY file scored 0 and the boost was the exact identity function --
 * silently, for six of eight measured languages, since #773 shipped it. NO
 * TEST caught this: nothing exercised the boost on a non-relative-import
 * corpus. This harness is that test, and it must never again be possible for
 * a language's `dependentCount` to silently collapse to zero without a test
 * failing.
 *
 * ## What it checks, and why two different mechanisms
 *
 * (a) **The load-bearing assertion.** For every corpus below except the
 *     documented Swift gap, `dependentCount` must be non-zero for the corpus's
 *     hub file, read from a REAL `db.search()` call -- the exact pipeline
 *     `search_code` runs (`indexCodebase` -> `createVectorDB` ->
 *     `keywordSearch` -> `scoreRow` attaching `dependentCount`). This is a
 *     plain `expect(...).toBeGreaterThan(0)` / `.toBe(0)`, NOT part of the
 *     golden diff below -- see "why golden-diff, and why NOT for (a)" below.
 * (b) **recall@1/recall@5/MRR, ON vs OFF, golden-diffed.** For a small
 *     (query, expected file) table per corpus, computed once with structural
 *     ranking at its default (`LIEN_STRUCTURAL_RANKING` unset) and once with
 *     it forced off, then formatted as deterministic text and diffed against
 *     a checked-in golden file.
 *
 * ## Why golden-diff for (b), and why NOT for (a)
 *
 * This repo has no other golden/snapshot test, and
 * `test/e2e/real-projects.test.ts`'s own doc comment argues AGAINST pinning
 * measured numbers ("do NOT tighten to match a snapshot -- the whole point is
 * to fail loudly only on collapse, not to pin an exact count"). That argument
 * holds for a COLLAPSE detector with a known-good floor. It does NOT hold
 * here: a ranking signal has no ground truth to floor against. There is no
 * principled `expect(recallAt1).toBeGreaterThanOrEqual(X)` to write, because
 * ANY value this harness could assert is itself just a snapshot of today's
 * corpus and today's bm25/boost tuning -- a threshold would be false
 * precision dressed up as a real target. Golden-diff is the honest version of
 * that: it makes no claim about what the RIGHT number is, only reports "this
 * moved, by this much, go look" -- exactly zoekt's `internal/e2e/e2e_rank_test.go`
 * pattern (query/target pairs against pinned corpora, metrics diffed against
 * golden, not thresholded).
 *
 * That honesty is also why (a) stays a hard, non-golden assertion: recall/MRR
 * are free to drift as bm25 weights or the boost formula get retuned -- that
 * is the harness doing its job, not a regression. But "does this language's
 * `dependentCount` resolve at all" has an actual right answer per language
 * (see each corpus's comment below), and letting THAT fact hide inside a
 * regeneratable golden file is exactly the shape of bug #1071 was: a silent
 * collapse that a future `UPDATE_RANKING_GOLDEN=1` regeneration could paper
 * over without anyone noticing. Assertion (a) can never be "fixed" by
 * regenerating a snapshot -- only by an actual resolver change.
 *
 * ## Regenerating the golden file
 *
 * `UPDATE_RANKING_GOLDEN=1 npm run test -w @liendev/lien -- ranking-regression`
 * rewrites `fixtures/ranking-corpora/ranking-regression.golden.txt` from a
 * fresh measurement. Regenerate only when a deliberate, understood change to
 * bm25 weights, the boost formula, or a fixture corpus should move the
 * numbers -- never to silence a failure you haven't read the diff for.
 *
 * ## Fixture corpora
 *
 * One small (5-8 source file) real-ish corpus per language under
 * `fixtures/ranking-corpora/<language>/`, each its OWN workspace root (so
 * manifest-driven resolution -- `go.mod` module-prefix stripping,
 * `Cargo.toml` crate mapping, Maven/Gradle source-root detection for
 * Java/Kotlin FQNs, `composer.json` PSR-4 for PHP -- reads the right
 * manifest; a single mixed root would break all of these). Every corpus
 * shares one shape: a "hub" `Logger`/`logger` file that every handler
 * imports/references, plus `create`/`update`/`delete` handler files and an
 * entry point, so the SAME query table shape (hub symbol, then each handler's
 * own symbol) works across languages. Every (query, expectedFile) pair below
 * was verified by direct measurement (`db.search(query, 5)` returning the
 * expected file at rank 1) before being written down here -- see the doc
 * comment on `CORPORA` for what is and is not fabricated.
 *
 * No `.gitignore` in this repo affects these fixtures: `scanCodebase` reads
 * `.gitignore` only from the corpus's OWN root (`scanner.ts`), never an
 * ancestor, so the repo root's `.gitignore` (its `target/`, `build/`, etc.
 * rules) never applies when `rootDir` is a fixture subdirectory. Default
 * include patterns (`DEFAULT_INDEX_INCLUDE_PATTERNS`, `packages/parser/src/constants.ts`)
 * already cover every extension used here with zero config.
 */

const TIMEOUT = 60_000;

/** One (query, expected top file) pair, verified by direct measurement. */
interface QueryCase {
  query: string;
  expectedFile: string;
}

interface Corpus {
  /** Directory name under `fixtures/ranking-corpora/`, and the display key
   * used in the golden file and in test names. */
  language: string;
  /**
   * Query/target pairs. `queries[0]` is always the hub file's own defining
   * symbol -- that pair drives the load-bearing dependentCount assertion (a).
   * The rest each target one handler file.
   */
  queries: QueryCase[];
  /**
   * Swift only: `dependentCount` is a genuine, documented zero here (see the
   * corpus's own comment below), not a bug in this harness or a resolution
   * gap this PR is expected to close.
   */
  knownZeroDependents?: boolean;
}

const FIXTURES_ROOT = path.join(__dirname, '../fixtures/ranking-corpora');
const GOLDEN_PATH = path.join(FIXTURES_ROOT, 'ranking-regression.golden.txt');

/**
 * Every corpus's `queries` were measured directly (not guessed): each pair
 * returns its `expectedFile` at rank 1 of a plain `db.search(query, 5)` call
 * against that corpus, verified before this table was written. Every
 * non-Swift corpus's hub file (`queries[0]`'s target) was also confirmed to
 * carry a non-zero `dependentCount` -- see each corpus's comment for the
 * resolution mechanism responsible (import-graph package/FQN/PSR-4 matching,
 * or -- C# only -- the type-reference recovery tier).
 */
const CORPORA: Corpus[] = [
  {
    // Relative imports (`./foo`, `../bar`) -- already worked before #1071.
    // Included as the control: if this ever regresses, the bug is in the
    // shared boost/search path, not in anything #1071 touched.
    language: 'typescript',
    queries: [
      { query: 'logInfo', expectedFile: 'src/util/logger.ts' },
      { query: 'createUser', expectedFile: 'src/handlers/create.ts' },
      { query: 'updateUser', expectedFile: 'src/handlers/update.ts' },
      { query: 'deleteUser', expectedFile: 'src/handlers/delete.ts' },
    ],
  },
  {
    // Flat-layout dotted module imports (`from rankingpy.util.logger import
    // ...`) -- resolves via `matchesPythonModule` (#929), no manifest read.
    language: 'python',
    queries: [
      { query: 'log_info', expectedFile: 'rankingpy/util/logger.py' },
      { query: 'create_user', expectedFile: 'rankingpy/handlers/create.py' },
      { query: 'update_user', expectedFile: 'rankingpy/handlers/update.py' },
      { query: 'delete_user', expectedFile: 'rankingpy/handlers/delete.py' },
    ],
  },
  {
    // `go.mod`'s `module` line strips the import's module prefix down to
    // `internal/util`/`internal/handlers` (two path segments -- deliberately
    // NOT a single-segment package name, which `matchesFile`'s package-
    // directory leniency does not cover; see #1039's root-level-file recovery
    // tier for that separate, narrower case).
    language: 'go',
    queries: [
      { query: 'LogInfo', expectedFile: 'internal/util/logger.go' },
      { query: 'CreateUser', expectedFile: 'internal/handlers/create.go' },
      { query: 'UpdateUser', expectedFile: 'internal/handlers/update.go' },
      { query: 'DeleteUser', expectedFile: 'internal/handlers/delete.go' },
    ],
  },
  {
    // `Cargo.toml` names the crate; `use crate::util;` resolves via the
    // regular `matchesFile` path (not the stricter `mod`/crate-root marker
    // tier, which only applies to `mod x;` declarations and bare crate-root
    // imports -- see `matchesRustModSpecifier`'s doc comment).
    language: 'rust',
    queries: [
      { query: 'log_info', expectedFile: 'src/util.rs' },
      { query: 'create_user', expectedFile: 'src/create.rs' },
      { query: 'update_user', expectedFile: 'src/update.rs' },
      { query: 'delete_user', expectedFile: 'src/delete.rs' },
    ],
  },
  {
    // No manifest content is ever parsed for Java (#1046) -- purely the
    // `src/main/java/**` filesystem convention. The dotted FQN import
    // (`com.example.ranking.util.Logger`) resolves against that source root.
    language: 'java',
    queries: [
      {
        query: 'logInfo',
        expectedFile: 'src/main/java/com/example/ranking/util/Logger.java',
      },
      {
        query: 'createUser',
        expectedFile: 'src/main/java/com/example/ranking/handlers/CreateHandler.java',
      },
      {
        query: 'updateUser',
        expectedFile: 'src/main/java/com/example/ranking/handlers/UpdateHandler.java',
      },
      {
        query: 'deleteUser',
        expectedFile: 'src/main/java/com/example/ranking/handlers/DeleteHandler.java',
      },
    ],
  },
  {
    // Same mechanism as Java (#1046), `src/main/kotlin/**` convention.
    language: 'kotlin',
    queries: [
      {
        query: 'logInfo',
        expectedFile: 'src/main/kotlin/com/example/ranking/util/Logger.kt',
      },
      {
        query: 'createUser',
        expectedFile: 'src/main/kotlin/com/example/ranking/handlers/CreateHandler.kt',
      },
      {
        query: 'updateUser',
        expectedFile: 'src/main/kotlin/com/example/ranking/handlers/UpdateHandler.kt',
      },
      {
        query: 'deleteUser',
        expectedFile: 'src/main/kotlin/com/example/ranking/handlers/DeleteHandler.kt',
      },
    ],
  },
  {
    // No manifest at all (`.csproj` is never read). Every file here shares
    // one namespace and NO file `using`s another -- realistic same-namespace
    // C# access needs none -- so the import graph resolves zero edges for
    // every file, and `dependentCount` here comes entirely from the
    // type-reference recovery tier (#930/#943,
    // `csharp-type-reference-signals.ts`): `Logger` is a globally-unique
    // type name, so every other file's identifier-boundary reference to it
    // (`Logger.LogInfo(...)`) counts as a dependent.
    language: 'csharp',
    queries: [
      { query: 'LogInfo', expectedFile: 'Logger.cs' },
      { query: 'CreateUser', expectedFile: 'CreateHandler.cs' },
      { query: 'UpdateUser', expectedFile: 'UpdateHandler.cs' },
      { query: 'DeleteUser', expectedFile: 'DeleteHandler.cs' },
    ],
  },
  {
    // `composer.json`'s PSR-4 map (`RankingPhp\` -> `src/`) resolves
    // `use RankingPhp\Util\Logger;` to `src/Util/Logger.php`.
    language: 'php',
    queries: [
      { query: 'logInfo', expectedFile: 'src/Util/Logger.php' },
      { query: 'createUser', expectedFile: 'src/Handlers/CreateHandler.php' },
      { query: 'updateUser', expectedFile: 'src/Handlers/UpdateHandler.php' },
      { query: 'deleteUser', expectedFile: 'src/Handlers/DeleteHandler.php' },
    ],
  },
  {
    // KNOWN, DOCUMENTED GAP -- not something this PR is expected to fix, and
    // not a regression in this harness. Swift's whole-module `import
    // Foundation`-style imports carry no per-file specifier at all (#884,
    // `isUnresolvableWholeModuleImport` / `wholeModuleImports: true` in
    // `ast/languages/swift.ts`), and `dependent-count-index.ts`'s only two
    // non-import recovery tiers are C# type-reference matching and Go
    // root-package matching -- neither applies to Swift. Every file in this
    // corpus therefore references `Logger`/the handlers with NO import
    // statement at all (real same-module Swift access needs none), and
    // `dependentCount` genuinely stays 0 for every file. This is asserted as
    // an exact-zero TRIPWIRE below (`knownZeroDependents`), mirroring
    // `real-projects.test.ts`'s `KNOWN_ZERO_EDGE_LANGUAGES`: if this ever
    // starts failing, Swift gained a real per-file resolution signal (e.g. a
    // symbol-usage recovery tier wired into `dependent-count-index.ts` the
    // way `swift-symbol-usage-signals.ts` already is for `get_dependents`)
    // and this corpus should switch to a real non-zero assertion instead of
    // re-asserting zero.
    language: 'swift',
    knownZeroDependents: true,
    queries: [
      { query: 'logInfo', expectedFile: 'Sources/Logger.swift' },
      { query: 'createUser', expectedFile: 'Sources/CreateHandler.swift' },
      { query: 'updateUser', expectedFile: 'Sources/UpdateHandler.swift' },
      { query: 'deleteUser', expectedFile: 'Sources/DeleteHandler.swift' },
    ],
  },
];

interface RecallStats {
  recallAt1: number;
  recallAt5: number;
  mrr: number;
}

/** recall@1, recall@5, and MRR for `queries` against the corpus's current index. */
async function computeRecallStats(
  db: VectorDBInterface,
  queries: QueryCase[],
): Promise<RecallStats> {
  let hitsAt1 = 0;
  let hitsAt5 = 0;
  let reciprocalSum = 0;

  for (const { query, expectedFile } of queries) {
    const results = await db.search(query, 5);
    const rank = results.findIndex(r => r.metadata.file === expectedFile) + 1; // 0 => not found
    if (rank === 1) hitsAt1++;
    if (rank >= 1) {
      hitsAt5++;
      reciprocalSum += 1 / rank;
    }
  }

  const total = queries.length;
  return { recallAt1: hitsAt1 / total, recallAt5: hitsAt5 / total, mrr: reciprocalSum / total };
}

/**
 * Runs `fn` with `LIEN_STRUCTURAL_RANKING` forced to the given state, always
 * restoring whatever was there before -- the `try/finally` pattern from
 * `fts-search.test.ts` (~line 276), so the flag never leaks into another
 * test regardless of how `fn` returns.
 */
async function withStructuralRanking<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.LIEN_STRUCTURAL_RANKING;
  if (enabled) delete process.env.LIEN_STRUCTURAL_RANKING;
  else process.env.LIEN_STRUCTURAL_RANKING = 'off';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.LIEN_STRUCTURAL_RANKING;
    else process.env.LIEN_STRUCTURAL_RANKING = previous;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Mirrors `applyStructuralBoost`'s formula (`packages/core/src/vectordb/sqlite/fts-search.ts`)
 * for the golden file's human-readable `medianBoostMultiplier` stat ONLY --
 * not part of any assertion. That module isn't part of `@liendev/core`'s
 * public surface (see its own file's export list), so it can't be imported
 * from this integration test; these two constants are copied from its
 * documented formula instead. If `STRUCTURAL_BOOST_ALPHA`/the cap ever
 * change there, the actual measured recall numbers below already catch the
 * resulting behavior change -- this local copy only needs updating to keep
 * the DISPLAYED multiplier honest, never to make a test pass.
 */
const STRUCTURAL_BOOST_ALPHA = 0.15;
const MAX_STRUCTURAL_BOOST_MULTIPLIER = 2;

function boostMultiplier(dependentCount: number): number {
  const multiplier = 1 + STRUCTURAL_BOOST_ALPHA * Math.log1p(Math.max(0, dependentCount));
  return Math.min(MAX_STRUCTURAL_BOOST_MULTIPLIER, multiplier);
}

interface CorpusRuntime {
  db: VectorDBInterface;
  fileCount: number;
  filesWithDependents: number;
  maxDependentCount: number;
  medianBoostMultiplier: number;
  /** The load-bearing read: `queries[0]`'s (hub) dependentCount, from a real `db.search()` call. */
  hubDependentCount: number;
  on: RecallStats;
  off: RecallStats;
}

const runtimes = new Map<string, CorpusRuntime>();

describe('Ranking regression harness (#1071)', () => {
  beforeAll(async () => {
    for (const corpus of CORPORA) {
      const rootDir = path.join(FIXTURES_ROOT, corpus.language);
      const result = await indexCodebase({ rootDir });
      if (!result.success) {
        throw new Error(
          `Indexing the ${corpus.language} ranking-corpus fixture failed: ${result.error}`,
        );
      }

      const db = await createVectorDB(rootDir);
      await db.initialize();

      // Corpus-wide stats via scanAll + the same public `computeDependentCountsFromChunks`
      // the indexer itself calls (an explicit alternative this suite's brief
      // calls out to `db.search()` for the per-query load-bearing read below).
      const chunks = await db.scanAll();
      const files = Array.from(new Set(chunks.map(c => c.metadata.file)));
      const counts = computeDependentCountsFromChunks(chunks, rootDir);
      const allCounts = files.map(f => counts.get(f) ?? 0);

      const hubQuery = corpus.queries[0];
      const hubResults = await db.search(hubQuery.query, 5);
      const hubResult = hubResults.find(r => r.metadata.file === hubQuery.expectedFile);

      const on = await computeRecallStats(db, corpus.queries);
      const off = await withStructuralRanking(false, () => computeRecallStats(db, corpus.queries));

      runtimes.set(corpus.language, {
        db,
        fileCount: files.length,
        filesWithDependents: allCounts.filter(c => c > 0).length,
        maxDependentCount: Math.max(0, ...allCounts),
        medianBoostMultiplier: median(allCounts.map(boostMultiplier)),
        hubDependentCount: hubResult?.metadata.dependentCount ?? 0,
        on,
        off,
      });
    }
  }, TIMEOUT * CORPORA.length);

  afterAll(() => {
    for (const runtime of runtimes.values()) {
      (runtime.db as unknown as { close?: () => void }).close?.();
    }
  });

  describe.each(CORPORA)('$language', corpus => {
    it(
      corpus.knownZeroDependents
        ? 'dependentCount stays a documented zero for the hub file (Swift, see corpus comment)'
        : 'dependentCount resolves non-zero for the hub file via a real search_code call (#1071)',
      () => {
        const runtime = runtimes.get(corpus.language)!;
        if (corpus.knownZeroDependents) {
          expect(runtime.hubDependentCount).toBe(0);
        } else {
          expect(runtime.hubDependentCount).toBeGreaterThan(0);
        }
      },
    );
  });

  it(
    'matches the golden ranking-regression stats (regenerate with UPDATE_RANKING_GOLDEN=1 ' +
      'after a deliberate bm25/boost/fixture change)',
    async () => {
      const blocks = CORPORA.map(corpus => {
        const r = runtimes.get(corpus.language)!;
        return [
          `=== ${corpus.language} ===`,
          `files: ${r.fileCount}`,
          `filesWithDependents: ${r.filesWithDependents}`,
          `maxDependentCount: ${r.maxDependentCount}`,
          `medianBoostMultiplier: ${r.medianBoostMultiplier.toFixed(2)}`,
          `recall@1 (ON): ${r.on.recallAt1.toFixed(2)}`,
          `recall@5 (ON): ${r.on.recallAt5.toFixed(2)}`,
          `MRR (ON): ${r.on.mrr.toFixed(2)}`,
          `recall@1 (OFF): ${r.off.recallAt1.toFixed(2)}`,
          `recall@5 (OFF): ${r.off.recallAt5.toFixed(2)}`,
          `MRR (OFF): ${r.off.mrr.toFixed(2)}`,
        ].join('\n');
      });
      const actual = blocks.join('\n\n') + '\n';

      if (process.env.UPDATE_RANKING_GOLDEN) {
        await fs.writeFile(GOLDEN_PATH, actual);
        return;
      }

      let expected: string;
      try {
        expected = await fs.readFile(GOLDEN_PATH, 'utf-8');
      } catch {
        throw new Error(
          `Golden file missing at ${GOLDEN_PATH}. Run with UPDATE_RANKING_GOLDEN=1 to create it, ` +
            'then review the generated file before committing it.',
        );
      }

      if (actual !== expected) {
        // Full delta for a human to read, in addition to vitest's own
        // string-diff on the assertion below.
        console.error('=== ranking-regression golden mismatch ===');
        console.error('--- expected (golden file) ---');
        console.error(expected);
        console.error('--- actual (freshly measured) ---');
        console.error(actual);
      }
      expect(actual).toBe(expected);
    },
    TIMEOUT,
  );
});
