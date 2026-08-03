import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { createVectorDB, getLienHome } from '@liendev/core';
import type { VectorDBInterface, SearchResult } from '@liendev/core';
import { findDependents, findTestAssociationsFromChunks } from '@liendev/parser';

/**
 * E2E Tests with Real Open Source Projects
 *
 * These tests validate that Lien works correctly on real-world codebases
 * by cloning popular open source projects and indexing them.
 *
 * **Running these tests:**
 * - Locally: `npm run test:e2e`
 * - CI: Runs automatically on push to main
 * - Individual language: `npm test -- real-projects.test.ts -t "Python"`
 *
 * **Why these projects:**
 * - Flask (Python): Popular web framework, well-structured, moderate size
 * - Zod (TypeScript): Schema validation library, clean codebase, modern TS
 * - Express (JavaScript): Most popular Node.js framework
 * - Monolog (PHP): Logging library, standard PHP patterns
 *
 * **Test strategy:**
 * 1. Clone project to /tmp/lien-e2e-tests/ (shallow clone for speed)
 * 2. Initialize Lien
 * 3. Index the project
 * 4. Validate results:
 *    - Files indexed > 0
 *    - Chunks created > files (AST chunking working)
 *    - No indexing errors
 *    - AST metadata present
 *    - Search works
 *    - #1004/#1023: dependency edges actually resolve (not just "shape")
 *    - #1029 (W3): complexity violations, test associations, exports, and a
 *      known symbol via search all actually resolve too, each as a
 *      collapse-to-zero detector (floor far below measured) or an explicit
 *      `toBe(0)` tripwire for a documented, currently-real gap -- see
 *      `KNOWN_ZERO_EDGE_LANGUAGES`/`KNOWN_ZERO_TESTASSOC_LANGUAGES`'s doc
 *      comments below for which languages are which and why.
 * 5. Cleanup temp directory (always, even on failure/interrupt)
 *
 * **Cleanup guarantees:**
 * - afterAll() hook cleans up after tests complete
 * - Process signal handlers (SIGINT/SIGTERM) clean up on Ctrl+C or kill
 * - Only /tmp/lien-e2e-tests/ is used (predictable location, easy to find)
 * - Cleanup runs even if tests fail or are interrupted
 */

const E2E_TIMEOUT = 180000; // 3 minutes per test (cloning + indexing)

interface ProjectConfig {
  name: string;
  repo: string;
  branch: string;
  language: string;
  expectedMinFiles: number; // Minimum files to index
  expectedMinChunks: number; // Minimum chunks to create
  sampleSearchQuery: string; // Query that should find results
  /**
   * #1004: floor on TOTAL resolved dependency edges across the whole corpus
   * (sum of `findDependents(...).dependents.length` over every indexed
   * file) -- a COLLAPSE DETECTOR, not a precision assertion. These numbers
   * are deliberately far below what each project actually resolves today;
   * do NOT "tighten" them to match a measured snapshot -- the whole point
   * is to fail loudly only when resolution falls to zero/near-zero (as it
   * did for Monolog/#1002 and Rust `mod`/#1000), not to pin an exact count
   * that churns as corpora move or matching improves.
   *
   * Java/Kotlin/Swift are a different case: see `KNOWN_ZERO_EDGE_LANGUAGES`
   * below -- those three genuinely resolve zero edges today (#1005, a real
   * open gap), so their floor is asserted as an exact-zero tripwire instead
   * of a `>=` floor.
   */
  expectedMinDependencyEdges: number;
  /**
   * #1029 (W3): floor on `report.summary.totalViolations` from
   * `lien complexity --format json` -- a COLLAPSE DETECTOR for the same
   * reason `expectedMinDependencyEdges` is: before this, the complexity test
   * only asserted `filesAnalyzed > 0`, so a report that silently found zero
   * violations on a corpus known to have plenty (every project here does;
   * see the measured counts in each project's comment) was indistinguishable
   * from a healthy "this code is just clean" result. Deliberately far below
   * the measured count -- do not tighten to match a snapshot.
   */
  expectedMinComplexityViolations: number;
  /**
   * #1029 (W3): floor on the TOTAL test-association count across a sampled
   * sweep of this project's files (same `sampleFilesForSweep` cap as
   * dependency edges, reusing the same chunks -- see `computeDependencyStats`
   * and the test-association test below that mirrors its sampling).
   * This is #979's blind spot at the E2E layer: `get_complexity` reported
   * `testAssociations: []` for every hotspot while `lien annotate` was
   * correct for the same file, and nothing here would have caught it. Like
   * `expectedMinDependencyEdges`, a collapse detector, not a precision
   * target. Languages with a genuine, currently-real zero go through
   * `KNOWN_ZERO_TESTASSOC_LANGUAGES` as a tripwire instead.
   */
  expectedMinTestAssociations: number;
  /**
   * #1029 (W3): floor on the count of indexed chunks with a non-empty
   * `exports` array -- replaces the old blanket "at least SOME chunk in the
   * whole suite has exports" check (which stayed green even if any single
   * project's export extraction collapsed to zero, since it summed across
   * chunks from one arbitrarily-sized project at a time anyway) with a
   * per-project floor.
   */
  expectedMinChunksWithExports: number;
  /**
   * #1029 (W3): a search query for a real, verified-present identifier in
   * this corpus (not the vague natural-language `sampleSearchQuery` above,
   * which only asserts a generic relevance bucket) -- paired with
   * `knownSymbolFile`, the file that query must surface, so this test can
   * catch "search returns SOMETHING plausible" collapsing into "search
   * returns nothing real" without becoming a brittle exact-rank assertion.
   */
  knownSymbolQuery: string;
  /** File expected among the top results for `knownSymbolQuery` (see its own doc comment). */
  knownSymbolFile: string;
}

/**
 * Languages where `findDependents` resolves ZERO edges today -- not a test
 * bug, a real product gap tracked as #1005. Asserting `toBe(0)` (rather than
 * skipping or asserting `>= 0`) makes this a TRIPWIRE: the moment #1005
 * lands and one of these corpora starts resolving real edges, the assertion
 * will FAIL. That failure is a good thing -- it means the gap closed and
 * this test needs to switch from tripwire mode to a real `expectedMinDependencyEdges`
 * floor like every other language already has. Do not "fix" the failure by
 * loosening this back to `>= 0` without first confirming #1005 actually
 * landed.
 */
const KNOWN_ZERO_EDGE_LANGUAGES = new Set(['java', 'kotlin', 'swift']);

/**
 * Languages where `findTestAssociationsFromChunks` resolves ZERO test
 * associations today across a real corpus with a real test suite -- same
 * TRIPWIRE contract as `KNOWN_ZERO_EDGE_LANGUAGES` above (`toBe(0)`, not a
 * skip, so a real fix makes this fail loudly instead of staying silently
 * green).
 *
 * - **kotlin**: documented and accepted -- see `sameUnitAccessWithoutImport`
 *   in `ast/languages/kotlin.ts`: "no verified Kotlin Gradle test-source
 *   recovery exists" (#1005). Measured: Klaxon, 0/100 sampled files.
 * - **swift**: documented and accepted, #869 ("whole-module-import
 *   languages have no per-file test-association signal -- structural gap,
 *   not a matching bug"). Measured: SwiftyJSON, 0/27 files.
 *
 * **csharp is FIXED (#1040)** and no longer belongs in this set:
 * `test-associations.ts` now reuses `resolveCSharpTypeReferenceDependents`
 * (the SAME namespace-scoped signal `get_dependents`'s file-level recovery
 * already relied on, #930) filtered to test files, recovering C#'s
 * enclosing-namespace test convention -- a C# test file in a nested
 * namespace (e.g. `MediatR.Tests`) sees its parent namespace's (`MediatR`)
 * types with no `using` statement at all, the same shape as Go/Java's
 * no-import test conventions. Measured: MediatR, 0/160 -> 60/160 files (269
 * associations across all 160; see MediatR's own `expectedMinTestAssociations`
 * for the 100-file-sampled floor this test actually asserts).
 *
 * Note this is a DIFFERENT set from `KNOWN_ZERO_EDGE_LANGUAGES`: Java is
 * zero-edge (#1005) but NOT zero-test-association -- `samePackageTestConvention`
 * covers test association only, not dependents, exactly as #1005 documents.
 * Measured: JavaPoet, 13/43 files, real non-zero test associations.
 */
const KNOWN_ZERO_TESTASSOC_LANGUAGES = new Set(['kotlin', 'swift']);

/**
 * Test projects for each supported language
 */
const TEST_PROJECTS: ProjectConfig[] = [
  {
    name: 'Requests',
    repo: 'https://github.com/psf/requests.git',
    branch: 'main',
    language: 'python',
    expectedMinFiles: 10, // Requests has clean structure with requests/*.py
    expectedMinChunks: 50, // Conservative estimate
    sampleSearchQuery: 'make http request',
    expectedMinDependencyEdges: 20, // measured ~353 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 10, // measured ~34 (2026-08)
    expectedMinTestAssociations: 20, // measured ~139 across 51 files (2026-08)
    expectedMinChunksWithExports: 100, // measured ~759/841 chunks (2026-08)
    knownSymbolQuery: 'get_encoding_from_headers',
    knownSymbolFile: 'src/requests/utils.py',
  },
  {
    name: 'Zod',
    repo: 'https://github.com/colinhacks/zod.git',
    branch: 'main',
    language: 'typescript',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    sampleSearchQuery: 'validate schema',
    expectedMinDependencyEdges: 50, // measured ~1265 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 50, // measured ~255 (2026-08)
    expectedMinTestAssociations: 1, // measured ~3 across a 100-file sample of 454 (2026-08); zod's test files import a lot via barrel re-exports rather than direct file imports, so the ratio is genuinely low but non-zero
    expectedMinChunksWithExports: 500, // measured ~3139/5078 chunks (2026-08)
    knownSymbolQuery: 'ZodString',
    knownSymbolFile: 'packages/zod/src/v4/core/schemas.ts',
  },
  {
    name: 'Express',
    repo: 'https://github.com/expressjs/express.git',
    branch: 'master',
    language: 'javascript',
    expectedMinFiles: 20,
    expectedMinChunks: 80,
    sampleSearchQuery: 'handle http request',
    expectedMinDependencyEdges: 50, // measured ~2924 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 1, // measured ~3 (2026-08) -- express is a thin, low-complexity router shim
    expectedMinTestAssociations: 100, // measured ~1254 across a 100-file sample of 150 (2026-08)
    expectedMinChunksWithExports: 30, // measured ~159/771 chunks (2026-08)
    knownSymbolQuery: 'Router prototype',
    knownSymbolFile: 'lib/express.js',
  },
  {
    name: 'Monolog',
    repo: 'https://github.com/Seldaek/monolog.git',
    branch: 'main',
    language: 'php',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    sampleSearchQuery: 'log message handler',
    // measured ~405 edges (2026-07, post-#1002 PSR-4 fix); before that fix
    // this was 0 across all 232 files and the suite was still green -- this
    // floor is exactly the regression detector #1004 asks for.
    expectedMinDependencyEdges: 20,
    expectedMinComplexityViolations: 10, // measured ~39 (2026-08)
    expectedMinTestAssociations: 3, // measured ~15 across a 100-file sample of 232 (2026-08)
    expectedMinChunksWithExports: 300, // measured ~2672/2857 chunks (2026-08)
    knownSymbolQuery: 'pushHandler',
    knownSymbolFile: 'src/Monolog/Logger.php',
  },
  {
    name: 'Anyhow',
    repo: 'https://github.com/dtolnay/anyhow.git',
    branch: 'master',
    language: 'rust',
    expectedMinFiles: 5,
    expectedMinChunks: 15,
    sampleSearchQuery: 'error handling context',
    // DELIBERATELY VERY LOW, do not raise from a measured snapshot (#1004).
    // Current Rust edge counts (measured ~39 pre-fix) are INFLATED by #1021
    // (`mod x;` fabricates edges to every file under `x/`, plus self-edges).
    // Once #1021 lands, legitimate edges will DROP -- a floor pinned to
    // today's inflated number would bake the bug in and block its own fix.
    // 1 just proves resolution hasn't collapsed to zero; it is intentionally
    // not a precision target.
    expectedMinDependencyEdges: 1,
    expectedMinComplexityViolations: 2, // measured ~10 (2026-08)
    expectedMinTestAssociations: 1, // measured ~6 across 40 files (2026-08)
    expectedMinChunksWithExports: 50, // measured ~363/508 chunks (2026-08)
    knownSymbolQuery: 'struct Chain',
    knownSymbolFile: 'src/chain.rs',
  },
  {
    name: 'Chi',
    repo: 'https://github.com/go-chi/chi.git',
    branch: 'master',
    language: 'go',
    expectedMinFiles: 5,
    expectedMinChunks: 20,
    sampleSearchQuery: 'http router middleware',
    // measured ~11 edges / 94% orphan rate (2026-08) -- #1029/W3 chased this:
    // it is a REAL GAP, not (only) leaf-heaviness. Filed as #1039:
    // `resolveGoModuleImport` never resolves a bare root-module self-import
    // (e.g. `import "github.com/go-chi/chi/v5"` from middleware/*.go,
    // referencing the repo-root package with no trailing path segment) --
    // 35 such imports exist in this corpus alone and none of them resolve.
    // Floor stays a collapse detector either way: not raised pending that fix.
    expectedMinDependencyEdges: 5,
    expectedMinComplexityViolations: 15, // measured ~72 (2026-08)
    expectedMinTestAssociations: 3, // measured ~20 across 86 files (2026-08)
    expectedMinChunksWithExports: 100, // measured ~662/765 chunks (2026-08)
    knownSymbolQuery: 'RouteContext',
    knownSymbolFile: 'context.go',
  },
  {
    name: 'JavaPoet',
    repo: 'https://github.com/square/javapoet.git',
    branch: 'master',
    language: 'java',
    expectedMinFiles: 10,
    expectedMinChunks: 100,
    sampleSearchQuery: 'generate java source code',
    // KNOWN GAP: #1005 -- Java resolves 0 dependency edges today. See
    // KNOWN_ZERO_EDGE_LANGUAGES: this is asserted as an exact-zero tripwire,
    // not a floor, elsewhere in this file.
    expectedMinDependencyEdges: 0,
    expectedMinComplexityViolations: 5, // measured ~19 (2026-08)
    // NOT a KNOWN_ZERO_TESTASSOC_LANGUAGES tripwire, despite Java being
    // zero-edge above: `samePackageTestConvention` (#925) covers test
    // association only, not dependents -- measured ~13 across 43 files
    // (2026-08), a real non-zero floor.
    expectedMinTestAssociations: 2,
    expectedMinChunksWithExports: 100, // measured ~892/951 chunks (2026-08)
    knownSymbolQuery: 'TypeSpec',
    knownSymbolFile: 'src/main/java/com/squareup/javapoet/TypeSpec.java',
  },
  {
    name: 'MediatR',
    repo: 'https://github.com/jbogard/MediatR.git',
    branch: 'main',
    language: 'csharp',
    expectedMinFiles: 10,
    expectedMinChunks: 30,
    sampleSearchQuery: 'mediator request handler',
    expectedMinDependencyEdges: 20, // measured ~578 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 5, // measured ~20 (2026-08)
    // #1040 FIXED: C# resolved 0 test associations before this fix despite
    // MediatR shipping a real test project (root cause: the enclosing-
    // namespace test convention had no case in test-associations.ts). Now
    // measured ~175 across a 100-file sample of 160 (2026-08; ~269 across
    // all 160 files, unsampled). Floor set to 90 (~51% of the measured 175)
    // per #1053 -- tight enough to catch roughly a 50%+ regression, not just
    // a near-total collapse.
    expectedMinTestAssociations: 90,
    expectedMinChunksWithExports: 200, // measured ~1376/1449 chunks (2026-08)
    knownSymbolQuery: 'IRequestHandler',
    knownSymbolFile: 'src/MediatR/IRequestHandler.cs',
  },
  {
    name: 'Sinatra',
    repo: 'https://github.com/sinatra/sinatra.git',
    branch: 'main',
    language: 'ruby',
    expectedMinFiles: 50, // sinatra + rack-protection + sinatra-contrib lib/ (~155 indexed)
    expectedMinChunks: 300, // AST chunking yields ~1300 (def/class/module per chunk)
    sampleSearchQuery: 'route handler matching http request',
    // measured ~109 edges / 87% orphan rate (2026-07/08) -- #1029/W3 chased
    // this: it is GENUINE leaf-heaviness, not a hidden resolution gap.
    // Verified by source inspection: core `lib/sinatra/*.rb` (7 files)
    // resolves with ZERO orphans (every file is required somewhere, directly
    // or via `require 'sinatra/x'` load-path resolution). The orphans are
    // concentrated in (a) the ~50 test files, which are expected in-degree-0
    // targets in every language (nothing requires a test file), (b)
    // rack-protection's ~19 `protection/*.rb` submodules, which are meant to
    // be required directly by CONSUMING apps outside this corpus (only
    // `rack/protection.rb` itself is required internally, by each
    // submodule, not the reverse), and (c) sinatra-contrib's extensions,
    // which are wired up via Ruby's dynamic `autoload` (a runtime
    // name->path table, not a static `require`) and are therefore
    // structurally invisible to any static import analysis -- not a Lien
    // bug. Floor stays a collapse detector either way: not raised pending
    // that write-up (see PR description for the full trace).
    expectedMinDependencyEdges: 10,
    expectedMinComplexityViolations: 2, // measured ~11 (2026-08)
    expectedMinTestAssociations: 1, // measured ~3 across a 100-file sample of 170 (2026-08)
    expectedMinChunksWithExports: 150, // measured ~1286/1605 chunks (2026-08)
    knownSymbolQuery: 'dispatch! route request',
    knownSymbolFile: 'lib/sinatra/base.rb',
  },
  {
    name: 'Klaxon',
    repo: 'https://github.com/cbeust/klaxon.git',
    branch: 'master',
    language: 'kotlin',
    expectedMinFiles: 40, // ~101 indexed (src/main + tests)
    expectedMinChunks: 250, // AST chunking yields ~960 (fun/class/object per chunk)
    sampleSearchQuery: 'parse json string into an object',
    // KNOWN GAP: #1005 -- Kotlin resolves 0 dependency edges today. See
    // KNOWN_ZERO_EDGE_LANGUAGES: this is asserted as an exact-zero tripwire,
    // not a floor, elsewhere in this file.
    expectedMinDependencyEdges: 0,
    expectedMinComplexityViolations: 3, // measured ~16 (2026-08)
    // KNOWN GAP: #1005's `sameUnitAccessWithoutImport` -- "no verified
    // Kotlin Gradle test-source recovery exists". See
    // KNOWN_ZERO_TESTASSOC_LANGUAGES: exact-zero tripwire, not a floor, used
    // instead of this value.
    expectedMinTestAssociations: 0,
    expectedMinChunksWithExports: 100, // measured ~938/987 chunks (2026-08)
    knownSymbolQuery: 'JsonObject',
    knownSymbolFile: 'klaxon/src/main/kotlin/com/beust/klaxon/JsonObject.kt',
  },
  {
    name: 'SwiftyJSON',
    repo: 'https://github.com/SwiftyJSON/SwiftyJSON.git',
    branch: 'master',
    language: 'swift',
    expectedMinFiles: 15, // ~26 indexed (Source + Tests)
    expectedMinChunks: 150, // AST chunking yields ~356 (func/struct/extension per chunk)
    sampleSearchQuery: 'parse json data into typed values',
    // KNOWN GAP: #1005 -- Swift resolves 0 dependency edges today. See
    // KNOWN_ZERO_EDGE_LANGUAGES: this is asserted as an exact-zero tripwire,
    // not a floor, elsewhere in this file.
    expectedMinDependencyEdges: 0,
    expectedMinComplexityViolations: 1, // measured ~6 (2026-08)
    // KNOWN GAP: #869 -- whole-module-import languages have no per-file
    // test-association signal (structural, not a matching bug). See
    // KNOWN_ZERO_TESTASSOC_LANGUAGES: exact-zero tripwire, not a floor, used
    // instead of this value.
    expectedMinTestAssociations: 0,
    expectedMinChunksWithExports: 50, // measured ~338/381 chunks (2026-08)
    knownSymbolQuery: 'rawString',
    knownSymbolFile: 'Source/SwiftyJSON/SwiftyJSON.swift',
  },
];

/**
 * Helper to execute CLI commands
 */
function runLienCommand(cwd: string, command: string): string {
  const lienCli = path.join(__dirname, '../../dist/index.js');
  try {
    return execSync(`node ${lienCli} ${command} 2>&1`, {
      cwd,
      encoding: 'utf-8',
    });
  } catch (error) {
    // Command failed, but we still want to see the output
    if (error instanceof Error && 'stdout' in error) {
      console.error(`Command failed: ${command}`);
      console.error(`Output: ${(error as any).stdout}`);
      return (error as any).stdout || '';
    }
    throw error;
  }
}

/**
 * Helper to get the actual index location (same logic as VectorDB)
 */
function getIndexPath(projectDir: string): string {
  // Resolve to real path (e.g. /tmp -> /private/tmp on macOS)
  // This matches what process.cwd() returns when Lien runs
  const realPath = fsSync.realpathSync(projectDir);
  const projectName = path.basename(realPath);
  const pathHash = crypto.createHash('md5').update(realPath).digest('hex').substring(0, 8);

  // Matches getLienHome() from @liendev/core: honors LIEN_HOME (set by
  // vitest globalSetup during tests) so this never touches the real
  // ~/.lien/indices/ store. The CLI subprocess spawned below inherits
  // LIEN_HOME from process.env, so it writes to the same isolated location.
  return path.join(getLienHome(), '.lien', 'indices', `${projectName}-${pathHash}`);
}

/**
 * Open the store `lien index` wrote for a project, via the same factory the
 * CLI uses (SQLite by default) — reading through a different backend than the
 * one that indexed would silently return nothing.
 */
async function loadDb(projectDir: string): Promise<VectorDBInterface> {
  const db = await createVectorDB(projectDir);
  await db.initialize();
  return db;
}

/** No-op log sink for `findDependents` calls below — this test doesn't care
 * about its warning messages, only the resolved counts. */
function noopLog(_message: string, _level?: 'warning'): void {
  // Intentionally empty.
}

/**
 * Count of resolved dependents for one target file, via the exported,
 * production `findDependents` -- the exact engine `get_dependents` runs,
 * including re-export-chain resolution and the C# type-reference-matching
 * recovery fallback (#930). A leaner reimplementation using only
 * `findDependentChunks`/raw `imports` was tried and rejected here: it
 * silently under-counts languages whose real resolution leans on that
 * fallback (C#/MediatR measured 0 instead of the ~578 the full pipeline
 * finds), which would have made the floor below meaningless for exactly the
 * languages `hasEnclosingNamespaceAccess` calls out as structurally reliant
 * on it. Fidelity to what `get_dependents` actually returns matters more
 * here than shaving the sweep's cost.
 */
function countDependents(file: string, chunks: SearchResult[], workspaceRoot: string): number {
  return findDependents(chunks, file, noopLog, workspaceRoot).dependents.length;
}

/**
 * Every real `findDependents` call above re-scans the whole corpus (its own
 * import-index rebuild, plus a re-export-graph scan that itself walks every
 * OTHER file) -- correct and appropriate for a single interactive
 * `get_dependents` query, but that per-call cost times every file in a
 * ~450-file corpus (Zod) measured out to 70+ seconds for this one test. This
 * caps the sweep to `maxFiles` targets, evenly spaced across the full file
 * list (not just a prefix), so a corpus with edges concentrated in one
 * directory doesn't get an unlucky all-orphan sample. A collapse to zero
 * shows up identically whether every file is swept or every Nth one -- the
 * failure mode this test exists to catch (#1002, #1000) makes EVERY file an
 * orphan, not a directory-scoped subset of them.
 */
function sampleFilesForSweep(files: string[], maxFiles: number): string[] {
  if (files.length <= maxFiles) return files;
  const step = files.length / maxFiles;
  return Array.from({ length: maxFiles }, (_, i) => files[Math.floor(i * step)]);
}

/** Cap on how many files `computeDependencyStats` sweeps per project -- see
 * `sampleFilesForSweep`'s doc comment for why this stays a cheap, honest
 * approximation rather than an exhaustive corpus-wide count. */
const MAX_DEPENDENCY_SWEEP_FILES = 100;

/**
 * #1004: aggregate dependency-resolution stats across a project (see
 * `sampleFilesForSweep` for corpora larger than `MAX_DEPENDENCY_SWEEP_FILES`).
 * This is a COLLAPSE DETECTOR: the point is to notice when resolution falls
 * to zero/near-zero (as it silently did for Monolog/#1002 and Rust `mod`/
 * #1000 while this suite stayed green), not to pin an exact edge count --
 * `totalEdges`/`orphanCount` are a sample-scaled approximation for large
 * corpora, never a precise whole-project total.
 *
 * Reuses the already-built SQLite index via a single `db.scanAll()` rather
 * than re-indexing or re-scanning per file.
 */
async function computeDependencyStats(projectDir: string): Promise<{
  totalEdges: number;
  orphanCount: number;
  fileCount: number;
  sweptFileCount: number;
}> {
  const workspaceRoot = fsSync.realpathSync(projectDir);
  const db = await loadDb(workspaceRoot);
  const chunks = await db.scanAll();
  const files = Array.from(new Set(chunks.map(c => c.metadata.file)));
  const sweptFiles = sampleFilesForSweep(files, MAX_DEPENDENCY_SWEEP_FILES);

  let totalEdges = 0;
  let orphanCount = 0;
  for (const file of sweptFiles) {
    const dependentCount = countDependents(file, chunks, workspaceRoot);
    totalEdges += dependentCount;
    if (dependentCount === 0) orphanCount++;
  }

  return { totalEdges, orphanCount, fileCount: files.length, sweptFileCount: sweptFiles.length };
}

/**
 * Helper to get index statistics from the manifest
 */
function getIndexStats(projectDir: string): { files: number; chunks: number } {
  try {
    // Get the actual index location (Lien stores in ~/.lien/indices/)
    const indexPath = getIndexPath(projectDir);
    const manifestPath = path.join(indexPath, 'manifest.json');
    const manifestContent = fsSync.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Manifest.files is an object/dictionary, not an array
    const filesObject = manifest.files || {};
    const fileEntries = Object.values(filesObject);

    const files = fileEntries.length;
    const chunks = fileEntries.reduce(
      (total: number, file: any) => total + (file.chunkCount || 0),
      0,
    );

    return { files, chunks };
  } catch (error) {
    // Fallback: try to parse from index output if manifest isn't available yet
    console.warn('Could not read manifest, returning 0:', error);
    return { files: 0, chunks: 0 };
  }
}

/**
 * Helper to validate AST metadata in index
 */
async function validateASTMetadata(projectDir: string): Promise<boolean> {
  // Check that manifest exists and has AST metadata
  const indexPath = getIndexPath(projectDir);
  const manifestPath = path.join(indexPath, 'manifest.json');

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Manifest.files is an object/dictionary, check if any file has chunks with AST metadata
    // We don't have chunk details in the manifest, so we just verify files exist
    // The real validation is that chunks > files (which proves AST chunking worked)
    const filesObject = manifest.files || {};
    const fileEntries = Object.values(filesObject);

    // If we have files and multiple chunks, AST metadata is working
    const totalChunks = fileEntries.reduce(
      (total: number, file: any) => total + (file.chunkCount || 0),
      0,
    );

    // AST chunking should create more chunks than files (functions/methods extracted)
    return totalChunks > fileEntries.length;
  } catch {
    return false;
  }
}

/**
 * Module-level state for test cleanup
 * Placed at module scope to ensure proper cleanup even with parallel test execution
 */
const testDirs: string[] = [];

/**
 * Cleanup function that removes all test directories
 */
async function cleanup() {
  for (const dir of testDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up: ${dir}`);
    } catch (error) {
      console.warn(`Failed to cleanup ${dir}:`, error);
    }
  }
}

/**
 * Register signal handlers at module scope for proper cleanup
 * This ensures cleanup even if tests are interrupted (Ctrl+C, kill, etc.)
 * Only enabled in local dev (not CI where process management differs)
 *
 * Uses process.on() instead of process.once() to handle multiple signals
 * (e.g., impatient users pressing Ctrl+C multiple times)
 */
let cleanupInProgress = false;

if (!process.env.CI) {
  const exitHandler = async (signal: string) => {
    if (cleanupInProgress) {
      // Already cleaning up, force exit on second signal
      console.log(`\nReceived ${signal} again, forcing exit...`);
      process.exit(1);
    }

    cleanupInProgress = true;
    console.log(`\n\nReceived ${signal}, cleaning up test directories...`);
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => exitHandler('SIGINT'));
  process.on('SIGTERM', () => exitHandler('SIGTERM'));
}

describe('E2E: Real Open Source Projects', () => {
  // Cleanup after all tests complete
  afterAll(async () => {
    await cleanup();
  });

  // Create a test for each project
  TEST_PROJECTS.forEach(project => {
    describe(`${project.name} (${project.language})`, () => {
      let projectDir: string;

      beforeAll(async () => {
        // Create temp directory using OS temp dir for cross-platform compatibility
        // Linux/macOS: /tmp/lien-e2e-tests or /var/folders/.../lien-e2e-tests
        // Windows: C:\Users\<user>\AppData\Local\Temp\lien-e2e-tests
        const tempBase = path.join(os.tmpdir(), 'lien-e2e-tests');
        await fs.mkdir(tempBase, { recursive: true });
        projectDir = path.join(tempBase, `${project.name.toLowerCase()}-${Date.now()}`);
        testDirs.push(projectDir);

        console.log(`\n📦 Cloning ${project.name} to ${projectDir}...`);

        // Shallow clone for speed (depth=1)
        execSync(`git clone --depth 1 --branch ${project.branch} ${project.repo} ${projectDir}`, {
          stdio: 'pipe',
        });

        console.log(`✓ Cloned ${project.name}`);
      }, E2E_TIMEOUT);

      it('should have cloned project files', () => {
        // Verify project was cloned successfully
        const files = fsSync.readdirSync(projectDir);
        expect(files.length).toBeGreaterThan(0);

        console.log(`📁 ${project.name} structure:`, files.slice(0, 10).join(', '));
      });

      it(
        'should initialize Lien successfully',
        async () => {
          const output = runLienCommand(projectDir, 'init --editor cursor');

          // init creates .cursor/mcp.json with lien MCP server entry
          expect(output).toContain('.cursor/mcp.json');

          // Verify .cursor/mcp.json was created with lien entry
          const mcpConfigPath = path.join(projectDir, '.cursor', 'mcp.json');
          const mcpConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf-8'));
          expect(mcpConfig.mcpServers?.lien).toBeDefined();
        },
        E2E_TIMEOUT,
      );

      it(
        'should index the project without errors',
        () => {
          console.log(`\n🔍 Indexing ${project.name}...`);

          const output = runLienCommand(projectDir, 'index');
          console.log(`Index output:\n${output.substring(0, 500)}`);

          // Should complete successfully (check for success indicators)
          const hasSuccess =
            output.includes('Indexed') || output.includes('✔') || output.includes('Manifest saved');
          expect(hasSuccess).toBe(true);

          // Should not have errors
          expect(output.toLowerCase()).not.toContain('error');
          expect(output.toLowerCase()).not.toContain('failed');

          // Verify manifest was created (in ~/.lien/indices/)
          const indexPath = getIndexPath(projectDir);
          const manifestPath = path.join(indexPath, 'manifest.json');
          const manifestExists = fsSync.existsSync(manifestPath);

          if (!manifestExists) {
            console.error(`❌ Manifest not created at: ${manifestPath}`);
            console.error(`Index output was:\n${output}`);
            console.error(`Index path: ${indexPath}`);

            // Check if index directory exists
            if (fsSync.existsSync(indexPath)) {
              const indexFiles = fsSync.readdirSync(indexPath);
              console.error(`Index directory contents:`, indexFiles);
            } else {
              console.error(`Index directory does not exist`);
            }
          }

          expect(manifestExists).toBe(true);

          console.log(`✓ Indexed ${project.name}`);
        },
        E2E_TIMEOUT,
      );

      it('should index minimum expected number of files', async () => {
        const stats = getIndexStats(projectDir);

        console.log(`📊 ${project.name} stats: ${stats.files} files, ${stats.chunks} chunks`);

        // If this fails, the project structure may have changed.
        // Check: ls {projectDir} to see actual structure
        if (stats.files === 0) {
          console.error(`❌ No files indexed for ${project.name}!`);
          console.error(`   Project directory: ${projectDir}`);
          console.error(`   Check project structure and include patterns in config`);

          // Show what files exist
          try {
            const findPyFiles = execSync(`find . -name "*.py" -type f | head -20`, {
              cwd: projectDir,
              encoding: 'utf-8',
            });
            console.error(`   Python files found:\n${findPyFiles}`);
          } catch (_e) {
            console.error(`   Could not find Python files`);
          }
        }

        expect(stats.files).toBeGreaterThanOrEqual(project.expectedMinFiles);
      });

      it('should create chunks with AST metadata', () => {
        const stats = getIndexStats(projectDir);

        // AST chunking should create more chunks than files (functions/methods extracted)
        // Unless no files were indexed (in which case we should fail earlier)
        if (stats.files > 0) {
          expect(stats.chunks).toBeGreaterThan(stats.files);
        }
        expect(stats.chunks).toBeGreaterThanOrEqual(project.expectedMinChunks);
      });

      it('should have AST metadata for code chunks', async () => {
        const hasMetadata = await validateASTMetadata(projectDir);

        expect(hasMetadata).toBe(true);
      });

      it('should show status after indexing', () => {
        // Strip ANSI escapes — chalk styles the label and count separately

        const output = runLienCommand(projectDir, 'status').replace(/\[[0-9;]*m/g, '');

        // Should report index exists
        expect(output).toContain('Exists');

        // Should show index files count
        expect(output).toMatch(/Index files:\s+\d+/);
      });

      it(
        'should analyze complexity without errors',
        () => {
          const output = runLienCommand(projectDir, 'complexity --format json');

          // Extract JSON from output (complexity command may include banner text before JSON)
          const jsonStart = output.indexOf('{');
          expect(jsonStart).toBeGreaterThanOrEqual(0);

          const report = JSON.parse(output.substring(jsonStart));

          expect(report.summary).toBeDefined();
          expect(report.summary.filesAnalyzed).toBeGreaterThan(0);
          expect(typeof report.summary.avgComplexity).toBe('number');

          console.log(
            `🧮 ${project.name} complexity: ${report.summary.filesAnalyzed} files, ` +
              `avg ${report.summary.avgComplexity.toFixed(1)}, ` +
              `${report.summary.totalViolations} violations`,
          );

          // #1029 (W3): until now this test only ever asserted "a report
          // exists with filesAnalyzed > 0" -- a report that found ZERO
          // violations on a real, non-trivial corpus (every project here has
          // some, per `expectedMinComplexityViolations`'s measured comment)
          // was indistinguishable from a healthy "this code is clean"
          // result. Collapse detector, not a precision target -- see that
          // field's doc comment.
          expect(report.summary.totalViolations).toBeGreaterThanOrEqual(
            project.expectedMinComplexityViolations,
          );
        },
        E2E_TIMEOUT,
      );

      it(
        'should find symbols via querySymbols',
        async () => {
          const db = await loadDb(fsSync.realpathSync(projectDir));

          // Query for functions — every project should have at least some
          const functions = await db.querySymbols({ symbolType: 'function', limit: 10 });

          console.log(`🔣 ${project.name} symbols: ${functions.length} functions found`);

          expect(functions.length).toBeGreaterThan(0);

          // Every result should have a symbolName and valid symbol type
          for (const r of functions) {
            expect(r.metadata.symbolName).toBeTruthy();
            expect(['function', 'method']).toContain(r.metadata.symbolType);
            expect(r.metadata.file).toBeTruthy();
          }
        },
        E2E_TIMEOUT,
      );

      it(
        'should retrieve chunks for a specific file',
        async () => {
          // Pick a file from the manifest
          const indexPath = getIndexPath(projectDir);
          const manifest = JSON.parse(
            fsSync.readFileSync(path.join(indexPath, 'manifest.json'), 'utf-8'),
          );
          const indexedFiles = Object.keys(manifest.files);
          expect(indexedFiles.length).toBeGreaterThan(0);

          const targetFile = indexedFiles[0];
          const db = await loadDb(fsSync.realpathSync(projectDir));
          const results = await db.scanWithFilter({ file: [targetFile], limit: 50 });

          console.log(
            `📄 ${project.name} file context: ${results.length} chunks for ${targetFile}`,
          );

          expect(results.length).toBeGreaterThan(0);

          // All results should reference the target file
          for (const r of results) {
            expect(r.metadata.file).toBe(targetFile);
            expect(r.content).toBeTruthy();
            expect(r.metadata.startLine).toBeGreaterThanOrEqual(0);
          }
        },
        E2E_TIMEOUT,
      );

      it(
        'should have import/export metadata in chunks',
        async () => {
          const db = await loadDb(fsSync.realpathSync(projectDir));
          // Scan everything — a small fixed sample is order-dependent and the
          // first N chunks of a project can legitimately lack imports/exports
          const results = await db.scanAll();

          // At least some chunks should have imports populated
          const chunksWithImports = results.filter(
            r => r.metadata.imports && r.metadata.imports.length > 0,
          );

          // At least some chunks should have exports populated
          const chunksWithExports = results.filter(
            r => r.metadata.exports && r.metadata.exports.length > 0,
          );

          console.log(
            `📦 ${project.name} metadata: ${chunksWithImports.length}/${results.length} chunks with imports, ` +
              `${chunksWithExports.length}/${results.length} with exports`,
          );

          // Every real-world project has imports
          expect(chunksWithImports.length).toBeGreaterThan(0);
          // #1029 (W3): upgraded from a blanket `toBeGreaterThan(0)` to a
          // per-project floor -- see `expectedMinChunksWithExports`'s doc
          // comment for why "at least SOME chunk has exports" is too weak a
          // collapse detector.
          expect(chunksWithExports.length).toBeGreaterThanOrEqual(
            project.expectedMinChunksWithExports,
          );

          // #999 (referenced by #1029/W3): Rust has no symbol extractor for
          // `struct_item`/`enum_item` at all, so a Rust struct/enum
          // declaration never produces its own chunk with a `struct `/`enum
          // `-prefixed signature -- unlike every other supported language.
          // Export extraction is UNAFFECTED (`RustExportExtractor.exportableTypes`
          // already lists both node kinds, which is why the floor above
          // passes for Rust too), so this gap is invisible to the exports
          // check; it only shows up when asking specifically for
          // declaration-level signature metadata. TRIPWIRE, not a skip: the
          // moment Rust gets a real struct/enum extractor this starts
          // finding matches and needs to flip to a `>= 1` floor.
          if (project.language === 'rust') {
            const structOrEnumSignatures = results.filter(r => {
              const signature = (r.metadata.signature ?? '').trim();
              return /^(pub(\([^)]*\))?\s+)?(struct|enum)\s/.test(signature);
            });
            console.log(
              `🦀 ${project.name} #999 tripwire: ${structOrEnumSignatures.length} chunks with a struct/enum signature`,
            );
            expect(structOrEnumSignatures.length).toBe(0);
          }
        },
        E2E_TIMEOUT,
      );

      // #1004: the assertions above only ever checked shape (files/chunks
      // counts, metadata presence) -- never that `findDependents` actually
      // resolves a single edge. A project with a 100% orphan rate passed
      // every test above; #1002 (Monolog, PSR-4) and #1000 (Rust `mod`) both
      // shipped invisibly through exactly that gap. These two tests close it.
      it(
        'should resolve real dependency edges across the corpus (#1004 collapse-to-zero detector)',
        async () => {
          const stats = await computeDependencyStats(projectDir);
          const sweptNote =
            stats.sweptFileCount < stats.fileCount
              ? ` (swept ${stats.sweptFileCount}/${stats.fileCount} files, evenly sampled)`
              : '';

          console.log(
            `🔗 ${project.name} dependency stats: ${stats.totalEdges} edges, ` +
              `${stats.orphanCount} orphans out of ${stats.sweptFileCount} files checked ` +
              `(${((stats.orphanCount / stats.sweptFileCount) * 100).toFixed(1)}%)${sweptNote}`,
          );

          if (KNOWN_ZERO_EDGE_LANGUAGES.has(project.language)) {
            // KNOWN GAP: #1005. This is a deliberate tripwire, not an
            // oversight -- see KNOWN_ZERO_EDGE_LANGUAGES's doc comment. If
            // this fails, #1005 likely just got fixed; update this project's
            // config to a real `expectedMinDependencyEdges` floor instead of
            // re-asserting zero.
            expect(stats.totalEdges).toBe(0);
          } else {
            // Floor only -- see `expectedMinDependencyEdges`'s doc comment.
            // This must NOT be tightened to match `stats.totalEdges` above.
            expect(stats.totalEdges).toBeGreaterThanOrEqual(project.expectedMinDependencyEdges);
          }
        },
        E2E_TIMEOUT,
      );

      // #1029 (W3): extends #1004's pattern past dependency edges. #979 was
      // exactly this gap at the MCP layer -- `get_complexity` reported
      // `testAssociations: []` for every hotspot while `lien annotate` (a
      // different code path calling the same underlying resolver) was
      // correct for the same file -- and nothing in the E2E suite would
      // have caught it, since no test here ever called
      // `findTestAssociationsFromChunks` at all.
      it(
        'should resolve real test associations for source files with real test suites (#1029 collapse-to-zero detector)',
        async () => {
          const workspaceRoot = fsSync.realpathSync(projectDir);
          const db = await loadDb(workspaceRoot);
          // Reuse the already-built index's chunks (no re-indexing) and the
          // same evenly-spaced sample cap `computeDependencyStats` uses --
          // see `sampleFilesForSweep`'s doc comment for why sampling here is
          // just as valid a collapse detector as sweeping every file.
          const chunks = await db.scanAll();
          const files = Array.from(new Set(chunks.map(c => c.metadata.file)));
          const sweptFiles = sampleFilesForSweep(files, MAX_DEPENDENCY_SWEEP_FILES);

          const associations = findTestAssociationsFromChunks(sweptFiles, chunks, workspaceRoot);
          let filesWithTests = 0;
          let totalAssociations = 0;
          for (const file of sweptFiles) {
            const tests = associations.get(file) ?? [];
            if (tests.length > 0) filesWithTests++;
            totalAssociations += tests.length;
          }

          console.log(
            `🧪 ${project.name} test-association stats: ${totalAssociations} associations, ` +
              `${filesWithTests}/${sweptFiles.length} files with at least one`,
          );

          if (KNOWN_ZERO_TESTASSOC_LANGUAGES.has(project.language)) {
            // KNOWN GAP -- see KNOWN_ZERO_TESTASSOC_LANGUAGES's doc comment
            // for which issue and why. Deliberate tripwire, not an
            // oversight: if this fails, the gap likely just closed --
            // update this project's config to a real
            // `expectedMinTestAssociations` floor instead of re-asserting
            // zero.
            expect(totalAssociations).toBe(0);
          } else {
            // Floor only -- see `expectedMinTestAssociations`'s doc comment.
            // This must NOT be tightened to match the measured count above.
            expect(totalAssociations).toBeGreaterThanOrEqual(project.expectedMinTestAssociations);
          }
        },
        E2E_TIMEOUT,
      );

      it(
        "should return zero dependents for a nonexistent path, and not inherit a real file's " +
          'graph by basename collision (#928)',
        async () => {
          const workspaceRoot = fsSync.realpathSync(projectDir);
          const db = await loadDb(workspaceRoot);
          const chunks = await db.scanAll();
          expect(chunks.length).toBeGreaterThan(0);

          // Construct a path that shares a real indexed file's basename but
          // lives under a directory that does not exist anywhere in this
          // project -- the exact #928 shape (Command/Command.php silently
          // inheriting an unrelated Command.php's dependent graph through
          // textual/basename coincidence rather than a real import edge).
          const realFile = chunks[0].metadata.file;
          const basename = path.basename(realFile);
          const bogusPath = `__lien_e2e_nonexistent_dir__/${basename}`;

          const result = findDependents(chunks, bogusPath, noopLog, workspaceRoot);

          console.log(
            `🚫 ${project.name} nonexistent-path check: targetIndexed=${result.targetIndexed}, ` +
              `dependents=${result.dependents.length} (bogus path derived from ${realFile})`,
          );

          expect(result.targetIndexed).toBe(false);
          expect(result.dependents.length).toBe(0);
        },
        E2E_TIMEOUT,
      );

      it(
        'should find similar code from an indexed chunk',
        async () => {
          const db = await loadDb(fsSync.realpathSync(projectDir));

          // Get a function chunk to use as the similarity query
          const [sample] = await db.querySymbols({ symbolType: 'function', limit: 1 });
          expect(sample).toBeDefined();

          const results = await db.search(sample.content, 5);

          console.log(
            `🔍 ${project.name} find_similar: ${results.length} results, ` +
              `top score: ${results[0]?.score.toFixed(3)}`,
          );

          expect(results.length).toBeGreaterThan(0);

          // Top result should be the same or very similar chunk
          expect(results[0].metadata.file).toBeTruthy();
          expect(['highly_relevant', 'relevant']).toContain(results[0].relevance);
        },
        E2E_TIMEOUT,
      );

      it(
        'should return relevant results for code search',
        async () => {
          const db = await loadDb(fsSync.realpathSync(projectDir));
          const results = await db.search(project.sampleSearchQuery, 5);

          console.log(
            `🔎 Search "${project.sampleSearchQuery}" returned ${results.length} results`,
          );
          if (results.length > 0) {
            console.log(
              `   Top result: ${results[0].metadata.file} (${results[0].relevance}, score: ${results[0].score.toFixed(3)})`,
            );
          }

          expect(results.length).toBeGreaterThan(0);

          // Top result should be at least loosely related
          expect(['highly_relevant', 'relevant', 'loosely_related']).toContain(
            results[0].relevance,
          );

          // All results should have valid metadata
          for (const result of results) {
            expect(result.metadata.file).toBeTruthy();
            expect(result.content).toBeTruthy();
          }
        },
        E2E_TIMEOUT,
      );

      // #1029 (W3): the test above only ever asserts a generic relevance
      // bucket for a vague natural-language query -- it would pass even if
      // search surfaced an unrelated-but-plausible-looking file. This test
      // asks for a specific, verified-present identifier (`knownSymbolQuery`)
      // and checks that a specific, verified-present file (`knownSymbolFile`)
      // comes back, so a collapse of the FTS5/BM25 index (empty results, or
      // results from the wrong corpus entirely) fails loudly instead of
      // reading as "search returned something, ship it".
      it(
        'should find a known, verified-present symbol via search (#1029 collapse-to-zero detector)',
        async () => {
          const db = await loadDb(fsSync.realpathSync(projectDir));
          const results = await db.search(project.knownSymbolQuery, 5);

          console.log(
            `🔎 Known-symbol search "${project.knownSymbolQuery}" returned ${results.length} results: ` +
              results.map(r => r.metadata.file).join(', '),
          );

          expect(results.length).toBeGreaterThan(0);
          expect(results.some(r => r.metadata.file === project.knownSymbolFile)).toBe(true);
        },
        E2E_TIMEOUT,
      );

      it(
        'should handle reindexing without errors',
        () => {
          console.log(`\n🔄 Reindexing ${project.name}...`);

          const output = runLienCommand(projectDir, 'index');

          // Check for success (either "Indexed" or "Incremental reindex")
          const hasSuccess =
            output.includes('Indexed') ||
            output.includes('Incremental reindex complete') ||
            output.includes('✔');
          expect(hasSuccess).toBe(true);
          expect(output.toLowerCase()).not.toContain('error');

          // Stats should be similar to first index
          const stats = getIndexStats(projectDir);
          expect(stats.files).toBeGreaterThanOrEqual(project.expectedMinFiles);
        },
        E2E_TIMEOUT,
      );
    });
  });
});
