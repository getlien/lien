import fs from 'fs';
import path from 'path';
import { createVectorDB, ComplexityAnalyzer } from '@liendev/core';
import {
  findTestAssociationsFromChunks,
  computeBlastRadiusRisk,
  detectLanguage,
  hasWholeModuleImports,
  hasEnclosingNamespaceAccess,
  hasSameDirectoryTestConvention,
  isTestFile,
  normalizePath,
  buildGoTestDirIndex,
  findGoPackageLevelTests,
  type BlastRadiusRisk,
  type CodeChunk,
  type GoTestCandidate,
} from '@liendev/parser';
import { findDependents, type DependentInfo } from '../mcp/handlers/dependency-analyzer.js';
import {
  computeComplexityHeadroom,
  formatComplexityHeadroomWarning,
} from '../mcp/handlers/get-files-context.js';
import { resolveProjectRoot } from './project-root.js';
import { type AbsolutePath, type RelativePath, toAbsolutePath } from '../types/paths.js';

// Complexity threshold lives in @liendev/core (dependency-analyzer's
// COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT = 10) and surfaces
// pre-filtered via result.complexityMetrics.highComplexityDependents.
// Don't define a local threshold — keeps this annotator from drifting
// from the rest of Lien's risk semantics.
const MAX_TESTS_LISTED = 2;
const MAX_DEPS_LISTED = 4;

export interface AnnotateOptions {
  /**
   * Skip the full impact summary (dependents/complexity/BFS) and print only
   * the test-association reminder line, or nothing if the file has no
   * associated tests. Used by the post-edit `test-reminder.sh` hook, which
   * only needs test-association data, not the full read-time annotation —
   * see `runTestsOnly`.
   */
  testsOnly?: boolean;
  /**
   * Habituation-guard risk floor (`low` | `medium` | `high` | `critical`). When
   * set, a below-floor annotation is suppressed UNLESS it carries a complexity
   * or headroom concern (those always fire). Unset / unknown / `low` never
   * suppresses — the current always-on behavior. The read hook passes the
   * `LIEN_ANNOTATE_MIN_RISK` env value here. See `belowRiskFloor`.
   */
  minRisk?: string;
}

/** Ordinal rank of each blast-radius risk level, for the guard's floor comparison. */
const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Habituation guard: is this annotation below the configured risk floor and
 * therefore suppressible? A complexity or headroom concern always clears the
 * floor (those are the high-value plan-time nudges — never suppressed). An
 * unset or unrecognized floor never suppresses anything (fail-open: default =
 * current always-on behavior). Pure and exported for direct unit testing.
 */
export function belowRiskFloor(
  riskLevel: string,
  complexityWarnings: number,
  headroomCount: number,
  minRisk?: string,
): boolean {
  if (!minRisk) return false;
  const floor = RISK_RANK[minRisk];
  if (floor === undefined) return false; // unknown floor → no suppression
  if (complexityWarnings > 0 || headroomCount > 0) return false; // always emit high-value
  return (RISK_RANK[riskLevel] ?? 0) < floor;
}

/**
 * Produce a short impact summary for a single file. Output is empty when
 * impact is trivial (no dependents, no complexity warnings, test coverage
 * present, no near-budget functions) — that's the signal to the PostToolUse
 * hook to stay silent. When a function in the file is at/near its complexity
 * budget, the output leads with an imperative nudge line (shared with
 * `get_files_context`'s `complexityHeadroomWarning`) — the plan-time nudge:
 * surfacing it on Read, before the agent edits, not after via `lien delta`.
 *
 * With `options.testsOnly`, skips all of the above and prints only the
 * post-edit test-association reminder (or nothing, if the file has no
 * associated tests) — see `runTestsOnly`.
 *
 * All THROWN errors result in empty stdout and exit 0, so an unknown/
 * unreadable file never breaks the hook pipeline. One case is deliberately
 * NOT silent, though: a resolved project root whose index has never been
 * built (#894) prints a one-line warning instead of an empty-but-plausible
 * "no dependents"/"no test coverage" annotation — see `formatNoIndexWarning`.
 */
export async function annotateCommand(file: string, options?: AnnotateOptions): Promise<void> {
  try {
    await run(file, options);
  } catch {
    // Silent — never break the consuming hook.
  }
}

interface ResolvedPaths {
  originalCwd: AbsolutePath;
  rootDir: AbsolutePath;
  filepath: RelativePath;
  abs: AbsolutePath;
}

/**
 * Resolve the input path into the four forms `run()` needs, or return
 * null if the path is unusable (empty, escapes the project root, or
 * doesn't exist on disk).
 *
 * Path-handling contract:
 *   - originalCwd / rootDir are AbsolutePath (process.cwd / path.resolve
 *     guarantee absolute).
 *   - filepath is RelativePath — project-root-relative. This is the form
 *     Lien's indexer stores in chunk metadata, so passing the relative
 *     form keeps matching consistent regardless of caller cwd.
 *   - abs is AbsolutePath, used only for the on-disk existence check.
 *     Resolved against the *original* cwd so `lien annotate src/foo.ts`
 *     from a subdir means <subdir>/src/foo.ts to the user.
 */
function resolvePaths(file: string): ResolvedPaths | null {
  if (!file) return null;
  const originalCwd = toAbsolutePath(process.cwd());
  const rootDir = resolveProjectRoot(originalCwd);

  // Resolve to an absolute path that actually exists on disk. POSIX
  // convention is cwd-relative for relative inputs, so try that first.
  // If the file isn't there, fall back to root-relative — handles the
  // case where a user (or the model) pastes a repo-relative path like
  // `packages/cli/src/foo.ts` while invoked from a subdirectory. Without
  // the fallback `path.resolve('/repo/packages/cli', 'packages/cli/...')`
  // produces `/repo/packages/cli/packages/cli/...`, which doesn't exist,
  // and the annotator exits silently for a file that really does.
  let abs: AbsolutePath = path.isAbsolute(file)
    ? toAbsolutePath(file)
    : toAbsolutePath(path.resolve(originalCwd, file));
  if (!fs.existsSync(abs) && !path.isAbsolute(file)) {
    const rootRelative = toAbsolutePath(path.resolve(rootDir, file));
    if (fs.existsSync(rootRelative)) abs = rootRelative;
  }
  if (!fs.existsSync(abs)) return null;

  // Compute project-root-relative form from the validated abs so it
  // matches whatever Lien's indexer stored. Reject paths outside the
  // root (path.relative would produce a `..`-prefixed traversal).
  const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return null;
  const filepath = rel as RelativePath;

  return { originalCwd, rootDir, filepath, abs };
}

/**
 * Coerce per-chunk `metadata.imports` to a plain array.
 *
 * A backend may return `imports` as an array-like value that lacks `.some()`
 * and other array methods. `findTestAssociationsFromChunks` uses `.some()`, so
 * the coercion has to happen at the annotate-cmd boundary before the chunks
 * flow downstream.
 */
function adaptChunkImports(chunks: DependencyAnalysisChunk[]): CodeChunk[] {
  return chunks.map(c => ({
    ...c,
    metadata: {
      ...c.metadata,
      imports: c.metadata?.imports ? Array.from(c.metadata.imports as Iterable<string>) : [],
    },
  })) as unknown as CodeChunk[];
}

// Aliasing the chunk type findDependents returns — keeps the helper's
// signature honest without leaking the SearchResult import here.
type DependencyAnalysisChunk = Awaited<ReturnType<typeof findDependents>>['allChunks'][number];

/**
 * #902 tier 2, last resort: when `tests` (the core tier-1/import-based
 * result) is empty and `filepath`'s language sets
 * `sameDirectoryTestConvention` (Go), every test file in the same directory
 * — real, same-package signal, but coarser than tier 1, so it's kept
 * strictly separate from `tests` rather than merged into it. This is why
 * `scanTestAssociations`'s `packageLevelTests` field is additive: callers
 * that record or verify against `.tests` (`lookupTestAssociations` /
 * `verify-tests`'s ledger and scope-matching) see zero behavior change —
 * only `lien annotate`'s own printed text (`formatTests`/
 * `formatTestReminder`) consults this.
 */
function computeGoPackageLevelFallback(
  tests: string[],
  filepath: string,
  allChunks: CodeChunk[],
  rootDir: string,
): string[] {
  if (tests.length > 0) return [];
  const language = detectLanguage(filepath);
  if (!language || !hasSameDirectoryTestConvention(language)) return [];

  const cache = new Map<string, string>();
  const normalize = (p: string): string => {
    if (cache.has(p)) return cache.get(p)!;
    const normalized = normalizePath(p, rootDir);
    cache.set(p, normalized);
    return normalized;
  };

  const candidates: GoTestCandidate[] = allChunks
    .filter(chunk => isTestFile(chunk.metadata.file))
    .filter(chunk => {
      const chunkLanguage = detectLanguage(chunk.metadata.file);
      return chunkLanguage !== null && hasSameDirectoryTestConvention(chunkLanguage);
    })
    .map(chunk => ({ file: chunk.metadata.file, normalized: normalize(chunk.metadata.file) }));

  return findGoPackageLevelTests(normalize(filepath), buildGoTestDirIndex(candidates));
}

/** All per-file analysis `run()` needs to decide whether/how to print. */
interface AnnotationData {
  allChunks: CodeChunk[];
  dependents: DependentInfo[];
  tests: string[];
  packageLevelTests: string[];
  complexity: ComplexitySummary;
  headroom: ComplexityHeadroom;
  risk: BlastRadiusRisk;
}

type VectorDB = Awaited<ReturnType<typeof createVectorDB>>;

/**
 * Gather every analysis input the full (non-`--tests-only`) annotation
 * needs — dependents, test associations (incl. #902's tier 1/tier 2),
 * complexity, headroom, and blast-radius risk — in one place, so `run()`
 * itself stays a thin decide-and-print shell.
 */
async function computeAnnotationData(
  vectorDB: VectorDB,
  filepath: RelativePath,
  rootDir: AbsolutePath,
): Promise<AnnotationData> {
  const log = () => undefined;
  // includeAllChunks=true: annotator needs the chunks for test-association
  // and complexity lookups. The default (false) keeps the MCP path cheap.
  const result = await findDependents(
    vectorDB,
    filepath,
    log,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  const allChunks = adaptChunkImports(result.allChunks);

  const tests = findTestAssociationsFromChunks([filepath], allChunks, rootDir).get(filepath) ?? [];
  const packageLevelTests = computeGoPackageLevelFallback(tests, filepath, allChunks, rootDir);
  const complexity = computeComplexitySummary(allChunks, filepath);
  // Plan-time nudge (mirrors get_files_context's complexityHeadroom): reuses
  // the exact same computation the MCP tool uses, so a "near budget" verdict
  // can never disagree between the read-hook annotation and get_files_context.
  // `allChunks` spans the target file plus its dependents/dependencies, so
  // filter down to the target file's own chunks first — other files' near-
  // budget functions must not leak into this file's nudge (mirrors
  // computeComplexitySummary's own `[filepath]` scoping below).
  const headroom = computeComplexityHeadroom(allChunks.filter(c => c.metadata.file === filepath));
  // Strict join: is any high-complexity dependent (per the core's threshold
  // of 10) actually untested? Avoids the previous proxy that could escalate
  // risk when uncovered/complex pairs were unrelated. Uses the
  // core-filtered highComplexityDependents so this code never drifts from
  // the rest of Lien's risk semantics.
  const hasHighComplexityUncovered = anyHighComplexityUncovered(
    result.complexityMetrics.highComplexityDependents,
    allChunks,
    rootDir,
  );
  const risk = computeBlastRadiusRisk({
    dependentCount: result.dependents.length,
    uncoveredDependents: result.uncoveredProductionDependents,
    // Dependents' max complexity feeds the blast-radius risk score. The
    // target file's own complexity (`complexity.max`) is reported
    // separately on the display line below — different signal.
    maxDependentComplexity: result.complexityMetrics.maxComplexity,
    hasHighComplexityUncovered,
  });

  return {
    allChunks,
    dependents: result.dependents,
    tests,
    packageLevelTests,
    complexity,
    headroom,
    risk,
  };
}

async function run(file: string, options?: AnnotateOptions): Promise<void> {
  const paths = resolvePaths(file);
  if (!paths) return;

  if (options?.testsOnly) {
    await runTestsOnly(paths);
    return;
  }

  const { originalCwd, rootDir, filepath } = paths;

  // Align cwd with the project root for the analysis pass. Lien's
  // internal path normalizers (createPathNormalizer in findDependents,
  // ComplexityAnalyzer.normalizeFilePath) read process.cwd() as the
  // workspace root. Today this happens to work because they only strip
  // the prefix when present and chunks store project-root-relative
  // paths; aligning cwd makes the contract robust to future internal
  // changes without threading workspaceRoot through every signature.
  // Restored in `finally` so test runs don't pollute each other.
  const needsChdir = originalCwd !== rootDir;
  if (needsChdir) process.chdir(rootDir);
  try {
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();

    // #894: warn loudly instead of silently analyzing an empty store — see
    // `formatNoIndexWarning`.
    if (!(await vectorDB.hasData())) {
      console.log(formatNoIndexWarning(rootDir));
      return;
    }

    const data = await computeAnnotationData(vectorDB, filepath, rootDir);

    if (
      isTrivial(
        data.dependents.length,
        data.complexity.warningCount,
        data.tests.length,
        data.headroom.entries.length,
      )
    ) {
      return;
    }

    // Habituation guard's risk floor (opt-in via --min-risk; the read hook
    // passes LIEN_ANNOTATE_MIN_RISK). No floor → current always-on behavior.
    if (
      belowRiskFloor(
        data.risk.level,
        data.complexity.warningCount,
        data.headroom.entries.length,
        options?.minRisk,
      )
    ) {
      return;
    }

    emitAnnotation(
      filepath,
      data.dependents,
      data.tests,
      data.packageLevelTests,
      data.complexity,
      data.risk,
      data.headroom,
    );
  } finally {
    if (needsChdir) process.chdir(originalCwd);
  }
}

export interface FileTestAssociations {
  filepath: RelativePath;
  rootDir: AbsolutePath;
  tests: string[];
  /**
   * #902 tier 2, last resort: populated only when `tests` is empty and the
   * file's language sets `sameDirectoryTestConvention` (Go). Deliberately
   * NOT part of `tests` — `lookupTestAssociations`'s caller
   * (`verify-tests-cmd.ts`'s ledger/scope-matching) reads only `.tests` and
   * is unaffected; only the printed reminder (`formatTestReminder`) consults
   * this field. See `computeGoPackageLevelFallback`.
   */
  packageLevelTests: string[];
  /**
   * #894: true when `rootDir`'s index has never been built (`hasData()` is
   * false for both standalone and worktree-overlay backends — see
   * `formatNoIndexWarning`). An empty `tests`/`packageLevelTests` array is
   * ambiguous on its own — genuinely no test coverage and "wrong/unindexed
   * root" look identical — so callers that want to tell them apart (today:
   * only `runTestsOnly`) check this field. `verify-tests-cmd.ts`'s
   * `lookupTestAssociations` caller ignores it and keeps its existing
   * fail-open "no tests" handling — its hook contract is deliberately silent
   * on any absence of tests, indexed or not.
   */
  indexMissing: boolean;
}

/**
 * The cheap lookup shared by `lien annotate --tests-only` (via `runTestsOnly`
 * below) and `lien verify-tests note-edit` (FEATURE 2 — see
 * `verify-tests-cmd.ts`): a single `vectorDB.scanAll()` (the same
 * column-projected full-table read `get_files_context` uses for its own
 * test-association scan) followed by `findTestAssociationsFromChunks`,
 * skipping `findDependents`'s BFS over the import graph and the
 * complexity/blast-radius computation the full annotation needs. Both
 * callers print via the same `formatTestReminder`, so the reminder text an
 * agent sees can never drift between the two commands.
 */
async function scanTestAssociations(paths: ResolvedPaths): Promise<FileTestAssociations> {
  const { originalCwd, rootDir, filepath } = paths;
  const needsChdir = originalCwd !== rootDir;
  if (needsChdir) process.chdir(rootDir);
  try {
    const vectorDB = await createVectorDB(rootDir);
    await vectorDB.initialize();
    // #894: check before scanning, not after — an empty scan result is
    // indistinguishable from "no tests" otherwise. `hasData()` is the same
    // signal the MCP server's auto-index gate uses, and is worktree/overlay-
    // aware (true when either the base or the overlay has rows).
    if (!(await vectorDB.hasData())) {
      return { filepath, rootDir, tests: [], packageLevelTests: [], indexMissing: true };
    }
    const allChunks = adaptChunkImports(await vectorDB.scanAll());
    const tests =
      findTestAssociationsFromChunks([filepath], allChunks, rootDir).get(filepath) ?? [];
    const packageLevelTests = computeGoPackageLevelFallback(tests, filepath, allChunks, rootDir);
    return { filepath, rootDir, tests, packageLevelTests, indexMissing: false };
  } finally {
    if (needsChdir) process.chdir(originalCwd);
  }
}

/**
 * `lien verify-tests note-edit`'s entry point: resolve `file` and look up its
 * associated tests in one shot. Returns null when the path is unusable (see
 * `resolvePaths`) — the same "stay silent" signal `annotateCommand` itself
 * uses for any error.
 */
export async function lookupTestAssociations(file: string): Promise<FileTestAssociations | null> {
  const paths = resolvePaths(file);
  if (!paths) return null;
  return scanTestAssociations(paths);
}

/**
 * The cheap path for the post-edit `test-reminder.sh` hook: test-association
 * lookup only (see `scanTestAssociations`). Prints nothing when the file has
 * no associated tests (the signal for the hook to stay silent).
 */
async function runTestsOnly(paths: ResolvedPaths): Promise<void> {
  const { filepath, rootDir, tests, packageLevelTests, indexMissing } =
    await scanTestAssociations(paths);
  if (indexMissing) {
    console.log(formatNoIndexWarning(rootDir));
    return;
  }
  if (tests.length === 0 && packageLevelTests.length === 0) return;
  console.log(formatTestReminder(filepath, tests, packageLevelTests));
}

/**
 * #894: the resolved project root's index has never been built (see
 * `hasData()` call sites above). Printing the normal annotation/reminder
 * here would be actively misleading — an empty dependents list or "No test
 * coverage" reads as a confident answer, not as "wrong root" or "never
 * indexed". Loud on purpose, and via `console.log` (not `console.error`):
 * the PostToolUse read-hook (`annotate-read.sh`) pipes `lien annotate`'s
 * stderr to `/dev/null` and only stdout reaches the agent as
 * `additionalContext`.
 */
export function formatNoIndexWarning(rootDir: string): string {
  return (
    `Lien: no index found at the resolved project root (${rootDir}). ` +
    `Run 'lien index' there, or check that this is the right root — a ` +
    `nested git repo or a repo-less subdirectory can resolve to the wrong ancestor.`
  );
}

/**
 * Render the one-line post-edit reminder. Pure and exported so the wording
 * and truncation are unit-testable without indexing a real project.
 *
 * `packageLevelTests` (#902 tier 2) is consulted only when `tests` is empty
 * — the same honest, distinctly-worded fallback `formatTests` uses for the
 * full annotation, applied to the shorter reminder line.
 */
export function formatTestReminder(
  filepath: string,
  tests: string[],
  packageLevelTests: string[] = [],
): string {
  if (tests.length === 0 && packageLevelTests.length > 0) {
    const shown = formatTruncatedList(packageLevelTests);
    return `Lien: you changed ${filepath} — no dedicated test file, but its package has: ${shown}. Consider running them before completing.`;
  }
  const shown = formatTruncatedList(tests);
  return `Lien: you changed ${filepath} — associated tests: ${shown}. Run them before completing.`;
}

/** Join the first `MAX_TESTS_LISTED` entries with a "(+N more)" tail. Shared by `formatTests`/`formatTestReminder`. */
function formatTruncatedList(items: string[]): string {
  const shown = items.slice(0, MAX_TESTS_LISTED).join(', ');
  const extra =
    items.length > MAX_TESTS_LISTED ? ` (+${items.length - MAX_TESTS_LISTED} more)` : '';
  return `${shown}${extra}`;
}

/** Return type of `computeComplexityHeadroom` — the plan-time nudge data. */
type ComplexityHeadroom = ReturnType<typeof computeComplexityHeadroom>;

/**
 * Prepend the shared headroom nudge (if any) to the annotation's other lines,
 * so a near/over-budget function is the first thing the agent reads — not
 * buried after dependents/test-coverage bullets. Pure and exported so the
 * wiring is unit-testable without indexing a real project.
 */
export function withHeadroomWarning(lines: string[], headroom: ComplexityHeadroom): string[] {
  const warning = formatComplexityHeadroomWarning(headroom.entries, headroom.overflow);
  return warning ? [warning, ...lines] : lines;
}

function emitAnnotation(
  filepath: RelativePath,
  dependents: DependentInfo[],
  tests: string[],
  packageLevelTests: string[],
  complexity: ComplexitySummary,
  risk: BlastRadiusRisk,
  headroom: ComplexityHeadroom,
): void {
  const lines: string[] = [`Lien impact for ${filepath}:`];
  if (dependents.length > 0) {
    lines.push(`  • ${formatDependents(dependents, risk.level, risk.reasoning)}`);
  }
  lines.push(`  • ${formatTests(tests, filepath, packageLevelTests)}`);
  if (complexity.warningCount > 0) {
    lines.push(`  • ${formatComplexity(complexity)}`);
  }

  console.log(withHeadroomWarning(lines, headroom).join('\n'));
}

export function isTrivial(
  dependentCount: number,
  complexityWarnings: number,
  testCount: number,
  headroomCount = 0,
): boolean {
  return dependentCount <= 1 && complexityWarnings === 0 && testCount > 0 && headroomCount === 0;
}

interface ComplexitySummary {
  max: number;
  warningCount: number;
}

/**
 * Returns true when at least one dependent that the core classifies as
 * high-complexity (>= COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
 * has no test coverage. Performs the strict join the blast-radius risk
 * model wants: "is a complex blast-radius node actually untested?"
 */
function anyHighComplexityUncovered(
  highComplexityDependents: ReadonlyArray<{ filepath: string }>,
  allChunks: CodeChunk[],
  rootDir: string,
): boolean {
  if (highComplexityDependents.length === 0) return false;
  const filepaths = highComplexityDependents.map(d => d.filepath);
  const testsMap = findTestAssociationsFromChunks(filepaths, allChunks, rootDir);
  return filepaths.some(p => (testsMap.get(p) ?? []).length === 0);
}

function computeComplexitySummary(chunks: CodeChunk[], filepath: string): ComplexitySummary {
  try {
    const report = ComplexityAnalyzer.analyzeFromChunks(chunks, [filepath]);
    const fileData = report.files[filepath];
    if (!fileData) return { max: 0, warningCount: 0 };
    const cyclomatic = fileData.violations.filter(v => v.metricType === 'cyclomatic');
    const max = cyclomatic.reduce((m, v) => Math.max(m, v.complexity), 0);
    return { max, warningCount: cyclomatic.length };
  } catch {
    return { max: 0, warningCount: 0 };
  }
}

export function formatDependents(
  dependents: DependentInfo[],
  level: string,
  reasoning: string[],
): string {
  const count = dependents.length;
  // Production dependents first — those are the ones whose breakage matters
  // most when changing this file. Tests follow as secondary context.
  const ordered = [...dependents].sort((a, b) => Number(a.isTestFile) - Number(b.isTestFile));
  const shown = ordered.slice(0, MAX_DEPS_LISTED).map(d => d.filepath);
  const extra = count > MAX_DEPS_LISTED ? `, +${count - MAX_DEPS_LISTED} more` : '';
  const noun = count === 1 ? 'file imports' : 'files import';
  const reason = reasoning.length > 0 ? ` (${reasoning.join(', ')})` : '';
  return `${count} ${noun} this — ${shown.join(', ')}${extra}; risk: ${level}${reason}.`;
}

/**
 * `filepath` is optional only for callers that genuinely have no file
 * context (none exist today; kept optional so this stays a narrow,
 * additive signature change). When present and its language is a
 * whole-module-import language (Swift — see `LanguageDefinition.
 * wholeModuleImports`), an empty `tests` array is reported as honestly
 * undeterminable rather than as an absence of coverage: the file may be
 * heavily tested, but import-based matching structurally cannot tell (#869).
 *
 * Same honesty treatment for a language with `enclosingNamespaceAccess` set
 * (C# — see that field's doc comment): a test file that only reaches this
 * one via implicit enclosing-namespace access carries no relevant `using`,
 * so it's structurally invisible to import-based matching too (#875) — even
 * though C#'s *explicit* dotted usings still resolve normally (#866/#868),
 * which is why this is a separate flag checked only as this empty-array
 * fallback, not folded into `wholeModuleImports`.
 *
 * `packageLevelTests` (#902 tier 2) is a THIRD, distinct kind of fallback —
 * unlike Swift/C#'s "not determinable" (zero signal at all), this case IS
 * determinable, just coarser than a direct match: real test files exist in
 * the same directory, but none basename-pairs with this specific file. Only
 * consulted when `tests` is empty; never merged into `tests` itself (see
 * `computeGoPackageLevelFallback`).
 */
export function formatTests(
  tests: string[],
  filepath?: string,
  packageLevelTests: string[] = [],
): string {
  if (tests.length === 0) {
    const language = filepath ? detectLanguage(filepath) : null;
    if (language && hasWholeModuleImports(language)) {
      return 'Test coverage not determinable from imports (whole-module import).';
    }
    if (language && hasEnclosingNamespaceAccess(language)) {
      return 'Test coverage not determinable from imports (enclosing-namespace access).';
    }
    if (packageLevelTests.length > 0) {
      return `Test coverage (package-level, no dedicated test file for this specific file): ${formatTruncatedList(packageLevelTests)}.`;
    }
    return 'No test coverage.';
  }
  return `Test coverage: ${formatTruncatedList(tests)}.`;
}

export function formatComplexity(summary: ComplexitySummary): string {
  const noun = summary.warningCount === 1 ? 'function' : 'functions';
  return `Max cyclomatic complexity: ${summary.max} (${summary.warningCount} ${noun} over warn threshold).`;
}
