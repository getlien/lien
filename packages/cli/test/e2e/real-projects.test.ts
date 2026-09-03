import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  performChunkOnlyIndex,
  findDependents,
  findTestAssociationsFromChunks,
  isTestFile,
} from '@liendev/parser';
import type { CodeChunk, ChunkOnlyResult } from '@liendev/parser';

/**
 * E2E Tests with Real Open Source Projects
 *
 * These tests validate that Lien's PARSER works correctly on real-world,
 * multi-language codebases by cloning popular open source projects and
 * running them through `performChunkOnlyIndex` — no persisted store, no MCP
 * server. This is the repo's only cross-language validation, so what it
 * checks is deliberately narrow but load-bearing:
 * - AST chunking produces chunks with real metadata (symbols, signatures,
 *   imports/exports, complexity)
 * - `findDependents` resolves real dependency edges from those chunks
 * - `findTestAssociationsFromChunks` resolves real test associations
 * - `lien complexity --format json` (the one surviving index-free CLI
 *   command this suite exercises) runs clean and reports real violations
 *
 * **Why these projects:** one real, moderately-sized OSS repo per supported
 * language (Zod/TS, Express/JS, Requests/Python, Anyhow/Rust, Chi/Go,
 * JavaPoet/Java, Klaxon/Kotlin, MediatR/C#, Monolog/PHP, Sinatra/Ruby,
 * SwiftyJSON/Swift) — enough real-world structure (barrels, re-exports,
 * package/namespace conventions) to catch resolution collapses that a
 * synthetic fixture wouldn't.
 *
 * **Test strategy:**
 * 1. Clone project to the OS temp dir (shallow clone for speed)
 * 2. Run `performChunkOnlyIndex` once per project (in `beforeAll`) and reuse
 *    the resulting chunks across every test in that project's block
 * 3. Validate results:
 *    - Parse succeeded (`scan.success`) and produced files/chunks above a
 *      per-project floor
 *    - AST metadata present (symbols, imports/exports)
 *    - #1004/#1023: dependency edges actually resolve (not just "shape")
 *    - #1029 (W3): complexity violations and test associations also resolve,
 *      each as a collapse-to-zero detector (floor far below measured) or an
 *      explicit `toBe(0)` tripwire for a documented, currently-real gap --
 *      see `KNOWN_ZERO_EDGE_LANGUAGES`/`KNOWN_ZERO_TESTASSOC_LANGUAGES`'s doc
 *      comments below for which languages are which and why.
 * 4. Cleanup temp directory (always, even on failure/interrupt)
 *
 * **Cleanup guarantees:**
 * - afterAll() hook cleans up after tests complete
 * - Process signal handlers (SIGINT/SIGTERM) clean up on Ctrl+C or kill
 * - Only the OS temp dir's `lien-e2e-tests/` subdir is used (predictable
 *   location, easy to find)
 * - Cleanup runs even if tests fail or are interrupted
 */

const E2E_TIMEOUT = 180000; // 3 minutes per test (cloning + parsing)

interface ProjectConfig {
  name: string;
  repo: string;
  branch: string;
  language: string;
  expectedMinFiles: number; // Minimum files to index
  expectedMinChunks: number; // Minimum chunks to create
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
   * Swift is a different case: see `KNOWN_ZERO_EDGE_LANGUAGES` below -- it
   * genuinely resolves zero edges today (#1005, a real open gap structurally
   * unaffected by #1046's fix), so its floor is asserted as an exact-zero
   * tripwire instead of a `>=` floor. Java and Kotlin graduated out of that
   * set (#1046) and now have real floors below, deliberately tighter than
   * this general guidance (~50% of measured, not "far below") since both
   * numbers are small enough that a loose floor would defeat the point.
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
   * This is #979's blind spot at the E2E layer: the old `get_complexity` MCP
   * tool reported `testAssociations: []` for every hotspot while a different
   * code path calling the same underlying resolver was correct for the same
   * file, and nothing here would have caught it. Like
   * `expectedMinDependencyEdges`, a collapse detector, not a precision
   * target. Languages with a genuine, currently-real zero go through
   * `KNOWN_ZERO_TESTASSOC_LANGUAGES` as a tripwire instead.
   */
  expectedMinTestAssociations: number;
  /**
   * #1029 (W3): floor on the count of parsed chunks with a non-empty
   * `exports` array -- replaces the old blanket "at least SOME chunk in the
   * whole suite has exports" check (which stayed green even if any single
   * project's export extraction collapsed to zero, since it summed across
   * chunks from one arbitrarily-sized project at a time anyway) with a
   * per-project floor.
   */
  expectedMinChunksWithExports: number;
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
 *
 * Java and Kotlin graduated out of this set (#1046 -- #1005 Mechanism 1):
 * dotted FQN imports now resolve to real files via a conventional
 * Maven/Gradle source-root strip (`../../parser/src/jvm-source-root.ts`), so
 * both now have real `expectedMinDependencyEdges` floors below instead.
 *
 * Swift stays in this set -- Mechanism 1's fix doesn't touch it. Swift sets
 * `wholeModuleImports: true` (whole-file `import ModuleName` carries no
 * per-file specifier at all, #869/#884), so there is no dotted FQN for a
 * source-root strip to resolve in the first place; SwiftyJSON measures
 * genuinely, stably zero edges before and after this fix (confirmed by
 * direct measurement, not assumed).
 */
const KNOWN_ZERO_EDGE_LANGUAGES = new Set(['swift']);

/**
 * Languages where `findTestAssociationsFromChunks` resolves ZERO test
 * associations today across a real corpus with a real test suite -- same
 * TRIPWIRE contract as `KNOWN_ZERO_EDGE_LANGUAGES` above (`toBe(0)`, not a
 * skip, so a real fix makes this fail loudly instead of staying silently
 * green).
 *
 * - **swift**: documented and accepted, #869 ("whole-module-import
 *   languages have no per-file test-association signal -- structural gap,
 *   not a matching bug"). Measured: SwiftyJSON, 0/27 files.
 *
 * **csharp is FIXED (#1040)** and no longer belongs in this set:
 * `test-associations.ts` now reuses `resolveCSharpTypeReferenceDependents`
 * (the SAME namespace-scoped signal `findDependents`'s file-level recovery
 * already relied on, #930) filtered to test files, recovering C#'s
 * enclosing-namespace test convention -- a C# test file in a nested
 * namespace (e.g. `MediatR.Tests`) sees its parent namespace's (`MediatR`)
 * types with no `using` statement at all, the same shape as Go/Java's
 * no-import test conventions. Measured: MediatR, 0/160 -> 60/160 files (269
 * associations across all 160; see MediatR's own `expectedMinTestAssociations`
 * for the 100-file-sampled floor this test actually asserts).
 *
 * **kotlin is FIXED (#1005 Phase 2, Item 2)** and no longer belongs in this
 * set: `test-associations.ts` now reuses `resolveJvmSamePackageDependents`
 * (the SAME same-package signal Phase 1's `findDependents` file-level
 * recovery already relies on, #1100) filtered to test files, recovering
 * Kotlin's same-package test convention -- a Kotlin test class references
 * its subject with no import at all, the same structural gap Go/Java/C#
 * each had their own version of. Measured: Klaxon, 0/100 -> 22/100 sampled
 * files (142 associations; see Klaxon's own `expectedMinTestAssociations`
 * for the floor this test actually asserts).
 *
 * Note this is a DIFFERENT set from `KNOWN_ZERO_EDGE_LANGUAGES`: Java is
 * zero-edge (#1005) but NOT zero-test-association -- `samePackageTestConvention`
 * covers test association only, not dependents, exactly as #1005 documents.
 * Measured: JavaPoet, 13/43 files, real non-zero test associations.
 */
const KNOWN_ZERO_TESTASSOC_LANGUAGES = new Set(['swift']);

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
    expectedMinDependencyEdges: 20, // measured ~353 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 10, // measured ~34 (2026-08)
    expectedMinTestAssociations: 20, // measured ~139 across 51 files (2026-08)
    expectedMinChunksWithExports: 100, // measured ~759/841 chunks (2026-08)
  },
  {
    name: 'Zod',
    repo: 'https://github.com/colinhacks/zod.git',
    branch: 'main',
    language: 'typescript',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    expectedMinDependencyEdges: 50, // measured ~1265 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 50, // measured ~255 (2026-08)
    expectedMinTestAssociations: 1, // measured ~3 across a 100-file sample of 454 (2026-08); zod's test files import a lot via barrel re-exports rather than direct file imports, so the ratio is genuinely low but non-zero
    expectedMinChunksWithExports: 500, // measured ~3139/5078 chunks (2026-08)
  },
  {
    name: 'Express',
    repo: 'https://github.com/expressjs/express.git',
    branch: 'master',
    language: 'javascript',
    expectedMinFiles: 20,
    expectedMinChunks: 80,
    expectedMinDependencyEdges: 50, // measured ~2924 (2026-07); floor is a collapse detector, not a target
    expectedMinComplexityViolations: 1, // measured ~3 (2026-08) -- express is a thin, low-complexity router shim
    expectedMinTestAssociations: 100, // measured ~1254 across a 100-file sample of 150 (2026-08)
    expectedMinChunksWithExports: 30, // measured ~159/771 chunks (2026-08)
  },
  {
    name: 'Monolog',
    repo: 'https://github.com/Seldaek/monolog.git',
    branch: 'main',
    language: 'php',
    expectedMinFiles: 30,
    expectedMinChunks: 100,
    // measured ~405 edges (2026-07, post-#1002 PSR-4 fix); before that fix
    // this was 0 across all 232 files and the suite was still green -- this
    // floor is exactly the regression detector #1004 asks for.
    expectedMinDependencyEdges: 20,
    expectedMinComplexityViolations: 10, // measured ~39 (2026-08)
    expectedMinTestAssociations: 3, // measured ~15 across a 100-file sample of 232 (2026-08)
    expectedMinChunksWithExports: 300, // measured ~2672/2857 chunks (2026-08)
  },
  {
    name: 'Anyhow',
    repo: 'https://github.com/dtolnay/anyhow.git',
    branch: 'master',
    language: 'rust',
    expectedMinFiles: 5,
    expectedMinChunks: 15,
    // DELIBERATELY VERY LOW, do not raise from a measured snapshot (#1004).
    // History: ~39 pre-#1021 (`mod x;` fabricated edges to every file under
    // `x/`, plus self-edges) -> 27 post-#1021/pre-#1056 -> ~32 post-#1056.
    // The #1056 fix (bare crate-root imports, `use anyhow::Symbol;` from
    // Anyhow's OWN `tests/*.rs` integration tests -- a single-crate project,
    // so `resolveRustCrateMap`'s crateDir is the ONE-segment `src`, never the
    // multi-segment `<member>/src` shape that made serde_derive's fabrication
    // possible) went from resolving to NOTHING (a bare single-segment `src`
    // specifier only ever exact-matches a file literally named `src`, so it
    // silently matched zero real files here) to correctly resolving via a
    // crate-root export lookup -- a genuine, non-fabricated INCREASE, not a
    // regression. Confirmed: `src/lib.rs` now shows 5 real test-file
    // dependents (`Error`/`Context`/etc. consumers) that resolved to nothing
    // before; every other `src/*.rs` file's dependent set is unchanged.
    // A floor pinned to any of these snapshots would bake today's number in
    // and block the next legitimate fix from moving it either direction --
    // 1 just proves resolution hasn't collapsed to zero; it is intentionally
    // not a precision target.
    expectedMinDependencyEdges: 1,
    expectedMinComplexityViolations: 2, // measured ~10 (2026-08)
    expectedMinTestAssociations: 1, // measured ~6 across 40 files (2026-08)
    expectedMinChunksWithExports: 50, // measured ~363/508 chunks (2026-08)
  },
  {
    name: 'Chi',
    repo: 'https://github.com/go-chi/chi.git',
    branch: 'master',
    language: 'go',
    expectedMinFiles: 5,
    expectedMinChunks: 20,
    // #1039 FIXED: was ~11 edges / 94.2% orphan rate (2026-08) -- #1029/W3
    // chased this to a verdict: a REAL GAP, not (only) leaf-heaviness.
    // `resolveGoModuleImport` never resolved a bare root-module self-import
    // (e.g. `import "github.com/go-chi/chi/v5"` from middleware/*.go,
    // referencing the repo-root package with no trailing path segment).
    // Fixed via `go-root-package-signals.ts`'s export-lookup recovery
    // (deliberately NOT a change to `resolveGoModuleImport`/`matchesFile`
    // themselves -- crediting the whole root-package directory would have
    // fabricated a false hub, the #1008/#1056 shape). Now measured ~64 edges
    // / 88.4% orphan rate (2026-08) -- `context.go` alone gained 11 real
    // dependents (5 real `middleware/*.go` callers of `RouteContext`, 3 of
    // their own `_test.go` files, 3 `_examples/*/main.go` files). Floor set
    // to 35 (~55% of measured 64) per #1053 -- tight enough to catch roughly
    // a 45%+ regression, not just a near-total collapse.
    expectedMinDependencyEdges: 35,
    expectedMinComplexityViolations: 15, // measured ~72 (2026-08)
    expectedMinTestAssociations: 3, // measured ~20 across 86 files (2026-08)
    expectedMinChunksWithExports: 100, // measured ~662/765 chunks (2026-08)
  },
  {
    name: 'JavaPoet',
    repo: 'https://github.com/square/javapoet.git',
    branch: 'master',
    language: 'java',
    expectedMinFiles: 10,
    expectedMinChunks: 100,
    // #1046 (#1005 Mechanism 1 fix): measured 18 edges / 40 orphans out of 43
    // files (93.0% orphan rate), stable across 5 repeated index+measure runs
    // (2026-08).
    //
    // #1005 Mechanism 3, Phase 1 (jvm-same-package-signals.ts) fix: JavaPoet's
    // own package (`com/squareup/javapoet`) IS a single flat directory -- ALL
    // 43 files share one package, so Mechanism 2's gap (same-package
    // references carrying no import at all) is exactly what this corpus was
    // orphaned BY, not a separate unaddressed cause. Measured 152 edges / 23
    // orphans out of 43 files (53.5% orphan rate, 2026-08) with this fix.
    // Hand-verified: the 23 remaining orphans are every non-source file
    // (`.github/*`, `*.md`), one no-package test file, and every real
    // `*Test.java` file (a JUnit test class has no real dependents in ANY
    // language -- nothing imports a test class) -- EVERY production
    // `com/squareup/javapoet/*.java` file with a top-level type declaration
    // now has at least one resolved dependent. Floor is ~50% of measured
    // (76), tight enough to catch a roughly-half collapse, not just a
    // total-collapse-to-zero (#1053).
    expectedMinDependencyEdges: 76,
    expectedMinComplexityViolations: 5, // measured ~19 (2026-08)
    // NOT a KNOWN_ZERO_TESTASSOC_LANGUAGES tripwire: `samePackageTestConvention`
    // (#925) covers test association only, not dependents -- measured ~13
    // across 43 files (2026-08), a real non-zero floor.
    expectedMinTestAssociations: 2,
    expectedMinChunksWithExports: 100, // measured ~892/951 chunks (2026-08)
  },
  {
    name: 'MediatR',
    repo: 'https://github.com/jbogard/MediatR.git',
    branch: 'main',
    language: 'csharp',
    expectedMinFiles: 10,
    expectedMinChunks: 30,
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
  },
  {
    name: 'Sinatra',
    repo: 'https://github.com/sinatra/sinatra.git',
    branch: 'main',
    language: 'ruby',
    expectedMinFiles: 50, // sinatra + rack-protection + sinatra-contrib lib/ (~155 indexed)
    expectedMinChunks: 300, // AST chunking yields ~1300 (def/class/module per chunk)
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
  },
  {
    name: 'Klaxon',
    repo: 'https://github.com/cbeust/klaxon.git',
    branch: 'master',
    language: 'kotlin',
    expectedMinFiles: 40, // ~101 indexed (src/main + tests)
    expectedMinChunks: 250, // AST chunking yields ~960 (fun/class/object per chunk)
    // #1046 (#1005 Mechanism 1 fix): measured 4 edges / 97 orphans out of a
    // 100-file sample (97.0% orphan rate), stable across 5 repeated
    // index+measure runs (2026-08).
    //
    // #1005 Mechanism 3, Phase 1 (jvm-same-package-signals.ts) fix: Klaxon's
    // ~104 files sit almost entirely in one package (`com.beust.klaxon`) --
    // exactly Mechanism 2's gap, now resolved for the class/interface case
    // (bare top-level `fun`/`val` stay out of scope, deferred to Phase 3).
    // Measured 224 edges / 67 orphans out of a 100-file sample (67.0% orphan
    // rate, 2026-08) with this fix. Hand-verified: the remaining orphans are
    // build scripts (`buildSrc/`, `kobalt/`), files with no top-level
    // class/interface (top-level-function-only files -- deliberately out of
    // Phase-1 scope), one genuinely-unreferenced production annotation type
    // (`KlaxonDoc`), one genuine cross-package edge unreachable by EITHER
    // mechanism (`JacksonParser.kt`'s `KlaxonJson` receiver, reached only via
    // `import com.beust.klaxon.*` -- an on-demand import, deliberately never
    // resolved by Mechanism 1 or this fix), and every real `*Test.kt`
    // regression-test file (a JUnit test class has no real dependents in ANY
    // language). Floor is ~50% of measured (112), tight enough to catch a
    // roughly-half collapse, not just a total-collapse-to-zero (#1053).
    expectedMinDependencyEdges: 112,
    expectedMinComplexityViolations: 3, // measured ~16 (2026-08)
    // #1005 Phase 2, Item 2 fix: Kotlin's same-package test convention
    // (no import at all connecting a test class to its subject) is now
    // recovered via `resolveJvmSamePackageDependents`, the same mechanism
    // Phase 1 already uses for `findDependents`. Measured 142 associations
    // across the 100-file sample (22/100 files with at least one, 2026-08).
    // Floor is ~50% of measured, the same "catch a roughly-half collapse"
    // guideline `expectedMinDependencyEdges` above already uses for this
    // project -- not a floor tight enough to double as an exact-count
    // regression test.
    expectedMinTestAssociations: 70,
    expectedMinChunksWithExports: 100, // measured ~938/987 chunks (2026-08)
  },
  {
    name: 'SwiftyJSON',
    repo: 'https://github.com/SwiftyJSON/SwiftyJSON.git',
    branch: 'master',
    language: 'swift',
    expectedMinFiles: 15, // ~26 indexed (Source + Tests)
    expectedMinChunks: 150, // AST chunking yields ~356 (func/struct/extension per chunk)
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
  },
];

/**
 * Helper to execute CLI commands, discarding the exit code.
 *
 * Use `runLienCommandWithStatus` when the exit code is part of what you are
 * asserting — `lien delta` is the gate, so "it ran" and "it passed" are
 * different claims there.
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
 * Run a CLI command and keep its exit code.
 *
 * `execSync` throws on a non-zero exit, so the code has to be recovered from
 * the thrown error rather than read from a return value.
 */
function runLienCommandWithStatus(
  cwd: string,
  command: string,
): { output: string; status: number } {
  const lienCli = path.join(__dirname, '../../dist/index.js');
  try {
    const output = execSync(`node ${lienCli} ${command} 2>&1`, { cwd, encoding: 'utf-8' });
    return { output, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    return { output: e.stdout ?? '', status: e.status ?? 1 };
  }
}

/**
 * Line comment prefix, so a synthetic edit stays syntactically valid in the
 * file it is appended to.
 *
 * Only Python and Ruby differ among the corpus languages; `//` covers Swift,
 * Java, Kotlin, C#, PHP, TypeScript, JavaScript, Rust and Go.
 */
function commentPrefixFor(language: string): string {
  return language === 'python' || language === 'ruby' ? '#' : '//';
}

/** No-op log sink for `findDependents` calls below — this test doesn't care
 * about its warning messages, only the resolved counts. */
function noopLog(_message: string, _level?: 'warning'): void {
  // Intentionally empty.
}

/**
 * Count of resolved dependents for one target file, via the exported,
 * production `findDependents` -- the same resolution engine that used to
 * back the now-deleted `get_dependents` MCP tool, including re-export-chain
 * resolution and the C# type-reference-matching recovery fallback (#930). A
 * leaner reimplementation using only `findDependentChunks`/raw `imports` was
 * tried and rejected here: it silently under-counts languages whose real
 * resolution leans on that fallback (C#/MediatR measured 0 instead of the
 * ~578 the full pipeline finds), which would have made the floor below
 * meaningless for exactly the languages `hasEnclosingNamespaceAccess` calls
 * out as structurally reliant on it. Fidelity to what `findDependents`
 * actually resolves matters more here than shaving the sweep's cost.
 */
function countDependents(file: string, chunks: CodeChunk[], workspaceRoot: string): number {
  return findDependents(chunks, file, noopLog, workspaceRoot).dependents.length;
}

/**
 * Every real `findDependents` call above re-scans the whole corpus (its own
 * import-index rebuild, plus a re-export-graph scan that itself walks every
 * OTHER file) -- correct and appropriate for a single interactive
 * dependents query, but that per-call cost times every file in a ~450-file
 * corpus (Zod) measured out to 70+ seconds for this one test. This caps the
 * sweep to `maxFiles` targets, evenly spaced across the full file list (not
 * just a prefix), so a corpus with edges concentrated in one directory
 * doesn't get an unlucky all-orphan sample. A collapse to zero shows up
 * identically whether every file is swept or every Nth one -- the failure
 * mode this test exists to catch (#1002, #1000) makes EVERY file an orphan,
 * not a directory-scoped subset of them.
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
 * Reuses the chunks `performChunkOnlyIndex` already produced in `beforeAll`
 * rather than re-parsing the project.
 */
function computeDependencyStats(
  chunks: CodeChunk[],
  workspaceRoot: string,
): {
  totalEdges: number;
  orphanCount: number;
  fileCount: number;
  sweptFileCount: number;
} {
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
      let workspaceRoot: string;
      let scan: ChunkOnlyResult;
      let chunks: CodeChunk[];

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

        // Parse once and reuse across every test below — performChunkOnlyIndex
        // re-scans the whole project on every call, so calling it per-test
        // would multiply this suite's runtime for no benefit.
        workspaceRoot = fsSync.realpathSync(projectDir);
        console.log(`\n🔍 Parsing ${project.name}...`);
        scan = await performChunkOnlyIndex(workspaceRoot, {});
        chunks = scan.chunks;
        console.log(
          `✓ Parsed ${project.name}: success=${scan.success}, ${scan.filesIndexed} files, ` +
            `${scan.chunksCreated} chunks, ${scan.filesErrored} errored`,
        );
      }, E2E_TIMEOUT);

      it('should have cloned project files', () => {
        // Verify project was cloned successfully
        const files = fsSync.readdirSync(projectDir);
        expect(files.length).toBeGreaterThan(0);

        console.log(`📁 ${project.name} structure:`, files.slice(0, 10).join(', '));
      });

      // Replaces the old 'should index the project without errors' (which
      // asserted CLI output text and a manifest file — both gone with
      // `lien index`/the persisted store). `performChunkOnlyIndex` reports
      // failure by RETURNING `{ success: false }` rather than throwing, so a
      // silently-empty `chunks` array would read as a pass unless `success`
      // is checked explicitly.
      it('should parse the project without errors', () => {
        if (!scan.success) {
          console.error(`❌ Parse failed for ${project.name}: ${scan.error}`);
        }
        expect(scan.success).toBe(true);
        expect(chunks.length).toBeGreaterThan(0);
      });

      it('should parse minimum expected number of files', () => {
        console.log(
          `📊 ${project.name} stats: ${scan.filesIndexed} files, ${scan.chunksCreated} chunks`,
        );

        // If this fails, the project structure may have changed.
        // Check: ls {projectDir} to see actual structure
        if (scan.filesIndexed === 0) {
          console.error(`❌ No files parsed for ${project.name}!`);
          console.error(`   Project directory: ${projectDir}`);
          console.error(`   Check project structure and include patterns in config`);
        }

        expect(scan.filesIndexed).toBeGreaterThanOrEqual(project.expectedMinFiles);
      });

      it('should create chunks with AST metadata', () => {
        // AST chunking should create more chunks than files (functions/methods extracted)
        // Unless no files were parsed (in which case we should fail earlier)
        if (scan.filesIndexed > 0) {
          expect(scan.chunksCreated).toBeGreaterThan(scan.filesIndexed);
        }
        expect(scan.chunksCreated).toBeGreaterThanOrEqual(project.expectedMinChunks);
      });

      it('should have AST metadata for code chunks', () => {
        // The real validation is that chunks > files (proven above); this
        // additionally checks each chunk carries real per-chunk metadata
        // rather than being an empty placeholder.
        const chunksWithSymbolInfo = chunks.filter(
          c => c.metadata.symbolName || c.metadata.type === 'doc' || c.metadata.type === 'config',
        );
        expect(chunksWithSymbolInfo.length).toBeGreaterThan(0);
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

      it('should find symbols with function/method AST metadata', () => {
        const functions = chunks.filter(
          c => c.metadata.symbolType === 'function' || c.metadata.symbolType === 'method',
        );

        console.log(`🔣 ${project.name} symbols: ${functions.length} function/method chunks found`);

        expect(functions.length).toBeGreaterThan(0);

        // Every result should have a symbolName and a valid file
        for (const c of functions.slice(0, 10)) {
          expect(c.metadata.symbolName).toBeTruthy();
          expect(c.metadata.file).toBeTruthy();
        }
      });

      it('should retrieve chunks for a specific file', () => {
        const indexedFiles = Array.from(new Set(chunks.map(c => c.metadata.file)));
        expect(indexedFiles.length).toBeGreaterThan(0);

        const targetFile = indexedFiles[0];
        const results = chunks.filter(c => c.metadata.file === targetFile);

        console.log(`📄 ${project.name} file context: ${results.length} chunks for ${targetFile}`);

        expect(results.length).toBeGreaterThan(0);

        // All results should reference the target file
        for (const r of results) {
          expect(r.metadata.file).toBe(targetFile);
          expect(r.content).toBeTruthy();
          expect(r.metadata.startLine).toBeGreaterThanOrEqual(0);
        }
      });

      it('should have import/export metadata in chunks', () => {
        // At least some chunks should have imports populated
        const chunksWithImports = chunks.filter(
          c => c.metadata.imports && c.metadata.imports.length > 0,
        );

        // At least some chunks should have exports populated
        const chunksWithExports = chunks.filter(
          c => c.metadata.exports && c.metadata.exports.length > 0,
        );

        console.log(
          `📦 ${project.name} metadata: ${chunksWithImports.length}/${chunks.length} chunks with imports, ` +
            `${chunksWithExports.length}/${chunks.length} with exports`,
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
          const structOrEnumSignatures = chunks.filter(r => {
            const signature = (r.metadata.signature ?? '').trim();
            return /^(pub(\([^)]*\))?\s+)?(struct|enum)\s/.test(signature);
          });
          console.log(
            `🦀 ${project.name} #999 tripwire: ${structOrEnumSignatures.length} chunks with a struct/enum signature`,
          );
          expect(structOrEnumSignatures.length).toBe(0);
        }
      });

      // #1004: the assertions above only ever checked shape (files/chunks
      // counts, metadata presence) -- never that `findDependents` actually
      // resolves a single edge. A project with a 100% orphan rate passed
      // every test above; #1002 (Monolog, PSR-4) and #1000 (Rust `mod`) both
      // shipped invisibly through exactly that gap. These two tests close it.
      it('should resolve real dependency edges across the corpus (#1004 collapse-to-zero detector)', () => {
        const stats = computeDependencyStats(chunks, workspaceRoot);
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
      });

      // #1029 (W3): extends #1004's pattern past dependency edges. #979 was
      // exactly this gap at the MCP layer -- the old `get_complexity` MCP
      // tool reported `testAssociations: []` for every hotspot while a
      // different code path calling the same underlying resolver was
      // correct for the same file -- and nothing in the E2E suite would
      // have caught it, since no test here ever called
      // `findTestAssociationsFromChunks` at all.
      it('should resolve real test associations for source files with real test suites (#1029 collapse-to-zero detector)', () => {
        // Reuse the already-parsed chunks from beforeAll (no re-parsing) and
        // the same evenly-spaced sample cap `computeDependencyStats` uses --
        // see `sampleFilesForSweep`'s doc comment for why sampling here is
        // just as valid a collapse detector as sweeping every file.
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
      });

      it(
        "should return zero dependents for a nonexistent path, and not inherit a real file's " +
          'graph by basename collision (#928)',
        () => {
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
      );

      // ===================================================================
      // Command-level coverage (#1139)
      //
      // Everything above calls the PARSER directly. That left three of the
      // four shipped commands with no real-repo coverage at all, which is how
      // #1137 shipped: `lien health` told Swift users a type used by every
      // file in its module was "contained — little depends on it", and the
      // SwiftyJSON job below stayed green through every release, because
      // nothing here ran `health`.
      //
      // These assert INVARIANTS, not values. Eleven upstream repos move on
      // their own schedule, so a value assertion is a maintenance burden and
      // a floor is already covered above; what matters is that a command's
      // output cannot contradict itself.
      // ===================================================================

      it(
        'lien health never contradicts its own coverage report (#1137, #1139)',
        () => {
          const output = runLienCommand(projectDir, 'health --format json');
          const json = JSON.parse(output.substring(output.indexOf('{')));

          expect(json.scanError).toBeUndefined();

          const resolvedByLanguage = new Map<string, boolean>(
            json.coverage.map((row: { language: string; resolved: boolean }) => [
              row.language,
              row.resolved,
            ]),
          );

          json.entries.forEach(
            (entry: { language: string; dependents: number | null; shape: string }) => {
              // An entry's language must be accounted for in `coverage`, or
              // the footer is describing a different corpus than the ranking.
              expect(resolvedByLanguage.has(entry.language)).toBe(true);

              if (resolvedByLanguage.get(entry.language) === false) {
                // THE #1137 INVARIANT. No fan-in was resolved for this
                // language, so the entry must not state a count or claim a
                // shape that implies a small blast radius.
                expect(entry.dependents).toBeNull();
                expect(entry.shape).toBe('unknown-fan-in');
              } else {
                expect(typeof entry.dependents).toBe('number');
                expect(entry.shape).not.toBe('unknown-fan-in');
              }
            },
          );

          expect(json.entries.length).toBe(json.shown);
          expect(json.shown).toBeLessThanOrEqual(json.rankedTotal);

          console.log(
            `🩺 ${project.name} health: ${json.rankedTotal} ranked, ${json.shown} shown, ` +
              `coverage=[${json.coverage
                .map((r: { language: string; resolved: boolean }) => `${r.language}:${r.resolved}`)
                .join(' ')}]`,
          );
        },
        E2E_TIMEOUT,
      );

      it(
        'lien review calls an empty diff empty, not clean (#1139)',
        () => {
          // The corpus is cloned unmodified, so there is nothing to review.
          // The failure this guards is the command rendering that as a pass:
          // "no candidates" on an empty diff and "no candidates" after a real
          // review are the same sentence unless the command distinguishes
          // them. Verified against a real clone: it says "this is not a clean
          // review, it is an empty one".
          const { output, status } = runLienCommandWithStatus(projectDir, 'review --base HEAD');

          expect(status).toBe(0); // advisory by construction — never fails on findings
          expect(output).toMatch(/not a clean review/i);
          expect(output).not.toMatch(/No candidates from any signal/i);
        },
        E2E_TIMEOUT,
      );

      it(
        'lien delta and lien review both see a real working-tree change (#1139)',
        () => {
          // A shallow clone has exactly one commit, so `HEAD~1` does not
          // exist and `--base <parent>` is unavailable. An uncommitted edit
          // against `--base HEAD` gives both commands a real diff without
          // needing a deeper clone.
          // Must not be a test file. `lien review` excludes tests unless
          // `--include-tests`, so editing one produces "changes, but nothing
          // reviewable in them" — review behaving correctly, and the
          // assertion below failing for the wrong reason. Picking the first
          // chunk of the language did exactly that on Chi (`tree_test.go`),
          // JavaPoet, Sinatra and MediatR, whose test files sort first.
          const target = chunks.find(
            c => c.metadata.language === project.language && !isTestFile(c.metadata.file),
          )?.metadata.file;
          if (target === undefined) {
            throw new Error(
              `no non-test ${project.language} chunk to edit — the language floors above should have caught this first`,
            );
          }

          const absolute = path.join(projectDir, target);
          const original = fsSync.readFileSync(absolute, 'utf-8');
          const prefix = commentPrefixFor(project.language);

          try {
            fsSync.writeFileSync(
              absolute,
              `${original}\n${prefix} lien e2e synthetic change (#1139)\n`,
            );

            const delta = runLienCommandWithStatus(projectDir, 'delta');
            // A comment-only edit crosses no threshold, so the gate must pass.
            expect(delta.status).toBe(0);
            // `status === 0` alone would also pass if delta had looked at
            // nothing, so assert it saw the file. `delta` distinguishes the
            // two deliberately, and only the second is a measurement:
            //   clean tree   -> "no complexity-affecting changes vs HEAD"
            //   file changed -> "no complexity changes across 1 file(s) vs HEAD"
            // A language where the appended comment somehow does shift a
            // metric prints the per-function table plus an "N file" summary
            // instead, which the same assertions accept.
            expect(delta.output).not.toMatch(/no complexity-affecting changes/i);
            expect(delta.output).toMatch(/\b[1-9]\d* file/i);

            const review = runLienCommandWithStatus(projectDir, 'review --base HEAD');
            expect(review.status).toBe(0);
            // The tree is dirty, so a zero changed-file count would mean the
            // diff was never read.
            expect(review.output).toMatch(/[1-9]\d* changed file/i);
            expect(review.output).not.toMatch(/No changes against HEAD/i);

            console.log(
              `✏️  ${project.name} command sweep: edited ${target}, ` +
                `delta exit ${delta.status}, review exit ${review.status}`,
            );
          } finally {
            // Restore before any later test or the shared afterAll cleanup
            // observes a mutated corpus.
            fsSync.writeFileSync(absolute, original);
          }
        },
        E2E_TIMEOUT,
      );
    });
  });
});
