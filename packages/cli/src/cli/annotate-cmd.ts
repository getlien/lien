import fs from 'fs';
import path from 'path';
import { VectorDB, ComplexityAnalyzer } from '@liendev/core';
import {
  findTestAssociationsFromChunks,
  computeBlastRadiusRisk,
  type CodeChunk,
} from '@liendev/parser';
import { findDependents, type DependentInfo } from '../mcp/handlers/dependency-analyzer.js';
import { resolveProjectRoot } from './project-root.js';
import { type AbsolutePath, type RelativePath, toAbsolutePath } from '../types/paths.js';

// Complexity threshold lives in @liendev/core (dependency-analyzer's
// COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT = 10) and surfaces
// pre-filtered via result.complexityMetrics.highComplexityDependents.
// Don't define a local threshold — keeps this annotator from drifting
// from the rest of Lien's risk semantics.
const MAX_TESTS_LISTED = 2;
const MAX_DEPS_LISTED = 4;

/**
 * Produce a short impact summary for a single file. Output is empty when
 * impact is trivial (no dependents, no complexity warnings, test coverage
 * present) — that's the signal to the PostToolUse hook to stay silent.
 *
 * All errors result in empty stdout and exit 0, so a missing index or
 * unknown file never breaks the hook pipeline.
 */
export async function annotateCommand(file: string): Promise<void> {
  try {
    const annotation = await annotateWithOwnVectorDB(file);
    if (annotation) console.log(annotation);
  } catch {
    // Silent — never break the consuming hook.
  }
}

/**
 * One-shot path: resolve paths, initialize a VectorDB, run the annotator,
 * tear down. Used by the CLI for terminal invocations and as the hook
 * fall-through when the daemon is unavailable.
 */
async function annotateWithOwnVectorDB(file: string): Promise<string | null> {
  const paths = resolvePaths(file);
  if (!paths) return null;
  const { originalCwd, rootDir } = paths;

  const needsChdir = originalCwd !== rootDir;
  if (needsChdir) process.chdir(rootDir);
  try {
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();
    return await runAnnotateOnce(vectorDB, paths);
  } finally {
    if (needsChdir) process.chdir(originalCwd);
  }
}

/**
 * Core annotator: given an already-initialized VectorDB and resolved paths,
 * produce the annotation string (or `null` for trivial impact). Does not
 * touch process.cwd, does not write to stdout — caller decides emission.
 *
 * The daemon calls this directly with a shared VectorDB; one-shot CLI calls
 * it via `annotateWithOwnVectorDB`. Caller is responsible for aligning cwd
 * with the project root before calling — internal normalizers in
 * findDependents / ComplexityAnalyzer read process.cwd().
 */
export async function runAnnotateOnce(
  vectorDB: VectorDB,
  paths: ResolvedPaths,
): Promise<string | null> {
  try {
    return await run(vectorDB, paths);
  } catch {
    return null;
  }
}

/**
 * Resolve `file` (a CLI arg or hook payload) against the given `cwd` and
 * produce the same `ResolvedPaths` the one-shot path uses. Exported so the
 * daemon can prepare the paths without owning a VectorDB.
 */
export function resolvePathsForFile(file: string, cwd: string): ResolvedPaths | null {
  return resolvePathsWithCwd(file, toAbsolutePath(cwd));
}

export interface ResolvedPaths {
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
  return resolvePathsWithCwd(file, toAbsolutePath(process.cwd()));
}

function resolvePathsWithCwd(file: string, originalCwd: AbsolutePath): ResolvedPaths | null {
  if (!file) return null;
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
 * LanceDB returns chunks whose `imports` field is an Apache Arrow Vector
 * — iterable but lacking `.some()` and other array methods.
 * `findTestAssociationsFromChunks` uses `.some()`, so the coercion has to
 * happen at the annotate-cmd boundary before the chunks flow downstream.
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

async function run(vectorDB: VectorDB, paths: ResolvedPaths): Promise<string | null> {
  const { rootDir, filepath } = paths;
  const log = () => undefined;
  // includeAllChunks=true: annotator needs the chunks for test-association
  // and complexity lookups. The default (false) keeps the MCP path cheap.
  const result = await findDependents(
    vectorDB,
    filepath,
    false,
    log,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  const allChunks = adaptChunkImports(result.allChunks);

  const tests = findTestAssociationsFromChunks([filepath], allChunks, rootDir).get(filepath) ?? [];
  const complexity = computeComplexitySummary(allChunks, filepath);
  const dependentCount = result.dependents.length;
  const uncovered = result.uncoveredProductionDependents;
  // Dependents' max complexity feeds the blast-radius risk score. The
  // target file's own complexity (`complexity.max`) is reported
  // separately on the display line below — different signal.
  const maxDependentComplexity = result.complexityMetrics.maxComplexity;
  // Strict join: is any high-complexity dependent (per the core's
  // threshold of 10) actually untested? Avoids the previous proxy that
  // could escalate risk when uncovered/complex pairs were unrelated.
  // Uses the core-filtered highComplexityDependents so this code never
  // drifts from the rest of Lien's risk semantics.
  const hasHighComplexityUncovered = anyHighComplexityUncovered(
    result.complexityMetrics.highComplexityDependents,
    allChunks,
    rootDir,
  );

  if (isTrivial(dependentCount, complexity.warningCount, tests.length)) return null;

  return formatAnnotation(
    filepath,
    result.dependents,
    tests,
    complexity,
    dependentCount,
    uncovered,
    maxDependentComplexity,
    hasHighComplexityUncovered,
  );
}

function formatAnnotation(
  filepath: RelativePath,
  dependents: DependentInfo[],
  tests: string[],
  complexity: ComplexitySummary,
  dependentCount: number,
  uncovered: number,
  maxDependentComplexity: number,
  hasHighComplexityUncovered: boolean,
): string {
  const risk = computeBlastRadiusRisk({
    dependentCount,
    uncoveredDependents: uncovered,
    maxDependentComplexity,
    hasHighComplexityUncovered,
  });

  const lines: string[] = [`Lien impact for ${filepath}:`];
  if (dependentCount > 0) {
    lines.push(`  • ${formatDependents(dependents, risk.level, risk.reasoning)}`);
  }
  lines.push(`  • ${formatTests(tests)}`);
  if (complexity.warningCount > 0) {
    lines.push(`  • ${formatComplexity(complexity)}`);
  }

  return lines.join('\n');
}

export function isTrivial(
  dependentCount: number,
  complexityWarnings: number,
  testCount: number,
): boolean {
  return dependentCount <= 1 && complexityWarnings === 0 && testCount > 0;
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

export function formatTests(tests: string[]): string {
  if (tests.length === 0) return 'No test coverage.';
  const shown = tests.slice(0, MAX_TESTS_LISTED).join(', ');
  const extra =
    tests.length > MAX_TESTS_LISTED ? ` (+${tests.length - MAX_TESTS_LISTED} more)` : '';
  return `Test coverage: ${shown}${extra}.`;
}

export function formatComplexity(summary: ComplexitySummary): string {
  const noun = summary.warningCount === 1 ? 'function' : 'functions';
  return `Max cyclomatic complexity: ${summary.max} (${summary.warningCount} ${noun} over warn threshold).`;
}
