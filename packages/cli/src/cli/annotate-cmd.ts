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

const HIGH_COMPLEXITY_THRESHOLD = 15;
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
    await run(file);
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

async function run(file: string): Promise<void> {
  const paths = resolvePaths(file);
  if (!paths) return;
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
    const vectorDB = new VectorDB(rootDir);
    await vectorDB.initialize();

    const log = () => undefined;
    const result = await findDependents(vectorDB, filepath, false, log);
    const allChunks = adaptChunkImports(result.allChunks);

    const tests =
      findTestAssociationsFromChunks([filepath], allChunks, rootDir).get(filepath) ?? [];
    const complexity = computeComplexitySummary(allChunks, filepath);
    const dependentCount = result.dependents.length;
    const uncovered = result.uncoveredProductionDependents;

    if (isTrivial(dependentCount, complexity.warningCount, tests.length)) return;

    emitAnnotation(filepath, result.dependents, tests, complexity, dependentCount, uncovered);
  } finally {
    if (needsChdir) process.chdir(originalCwd);
  }
}

function emitAnnotation(
  filepath: RelativePath,
  dependents: DependentInfo[],
  tests: string[],
  complexity: ComplexitySummary,
  dependentCount: number,
  uncovered: number,
): void {
  const risk = computeBlastRadiusRisk({
    dependentCount,
    uncoveredDependents: uncovered,
    maxDependentComplexity: complexity.max,
    hasHighComplexityUncovered: uncovered > 0 && complexity.max >= HIGH_COMPLEXITY_THRESHOLD,
  });

  const lines: string[] = [`Lien impact for ${filepath}:`];
  if (dependentCount > 0) {
    lines.push(`  • ${formatDependents(dependents, risk.level, risk.reasoning)}`);
  }
  lines.push(`  • ${formatTests(tests)}`);
  if (complexity.warningCount > 0) {
    lines.push(`  • ${formatComplexity(complexity)}`);
  }

  console.log(lines.join('\n'));
}

export function toRelative(
  file: string,
  rootDir: AbsolutePath,
  cwd: AbsolutePath = toAbsolutePath(process.cwd()),
): RelativePath {
  if (!file) return '' as RelativePath;
  // Relative inputs are conventionally process-cwd-relative (POSIX). Only
  // fall back to rootDir if cwd is somehow empty.
  const base = cwd || rootDir;
  const abs = path.isAbsolute(file) ? file : path.resolve(base, file);
  const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
  // Edge: file outside the resolved root. Return an empty sentinel — the
  // caller's `if (!filepath) return` short-circuits downstream, and the
  // RelativePath brand stays sound (we never return an absolute string).
  if (rel.startsWith('..')) return '' as RelativePath;
  return rel as RelativePath;
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
