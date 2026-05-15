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

async function run(file: string): Promise<void> {
  const cwd = process.cwd();
  const rootDir = resolveProjectRoot(cwd);
  const filepath = toRelative(file, rootDir, cwd);
  if (!filepath) return;

  // Guard against non-existent paths — findDependents's suffix matching
  // can otherwise return spurious hits for unrelated imports that happen
  // to share a basename. Resolve relative inputs against cwd, not rootDir,
  // so `lien annotate src/foo.ts` from a subdir finds <subdir>/src/foo.ts.
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (!fs.existsSync(abs)) return;

  const vectorDB = new VectorDB(rootDir);
  await vectorDB.initialize();

  const log = () => undefined;
  const result = await findDependents(vectorDB, filepath, false, log);

  const allChunks = result.allChunks as unknown as CodeChunk[];
  const testsMap = findTestAssociationsFromChunks([filepath], allChunks, rootDir);
  const tests = testsMap.get(filepath) ?? [];

  const complexity = computeComplexitySummary(allChunks, filepath);
  const dependentCount = result.dependents.length;
  const uncovered = result.uncoveredProductionDependents;

  if (isTrivial(dependentCount, complexity.warningCount, tests.length)) return;

  const risk = computeBlastRadiusRisk({
    dependentCount,
    uncoveredDependents: uncovered,
    maxDependentComplexity: complexity.max,
    hasHighComplexityUncovered: uncovered > 0 && complexity.max >= HIGH_COMPLEXITY_THRESHOLD,
  });

  const lines: string[] = [`Lien impact for ${filepath}:`];
  if (dependentCount > 0) {
    lines.push(`  • ${formatDependents(result.dependents, risk.level, risk.reasoning)}`);
  }
  lines.push(`  • ${formatTests(tests)}`);
  if (complexity.warningCount > 0) {
    lines.push(`  • ${formatComplexity(complexity)}`);
  }

  console.log(lines.join('\n'));
}

export function toRelative(file: string, rootDir: string, cwd: string = process.cwd()): string {
  if (!file) return '';
  // Relative inputs are conventionally process-cwd-relative (POSIX). Only
  // fall back to rootDir if cwd is somehow empty.
  const base = cwd || rootDir;
  const abs = path.isAbsolute(file) ? file : path.resolve(base, file);
  const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
  // Edge: file outside the resolved root. Hand back the input unchanged
  // and let findDependents come up empty — silent exit downstream.
  return rel.startsWith('..') ? file : rel;
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
