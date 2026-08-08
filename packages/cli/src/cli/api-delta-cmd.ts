/**
 * `lien api-delta` — flag exported-symbol signature changes/removals in the
 * working tree (FEATURE 1 / the blast-radius nudge). Advisory only: there is
 * no gate here, unlike `lien delta` — CLAUDE.md's "run get_dependents before
 * changing an exported symbol" rule has no pass/fail notion, only a nudge to
 * check impact before relying on callers.
 */

import chalk from 'chalk';
import { createVectorDB } from '@liendev/core';
import {
  computeBlastRadiusRisk,
  type FileContentChange,
  type RecoveryIndexes,
} from '@liendev/parser';
import { getRepoRoot, collectFileChanges, collectFileChange } from './delta-git.js';
import {
  findDependents,
  type DependencyAnalysisResult,
} from '../mcp/handlers/dependency-analyzer.js';
import {
  buildAttributionCaveatFromAnalysis,
  type AttributionCaveat,
} from '../mcp/handlers/get-dependents.js';
import {
  computeExportedSignatureDelta,
  type ExportedSignatureDelta,
  type ExportedSymbolChange,
} from '../utils/signature-delta.js';
import { recordBlastEvent, type BlastEvent } from '../utils/blast-events.js';
import { findDocReferences } from '../utils/doc-references.js';
import { classifyIndexState } from '../utils/index-freshness.js';

export interface ApiDeltaOptions {
  format: 'text' | 'json';
  /** Restrict analysis to a single file — the fast path the PostToolUse edit hook uses. */
  file?: string;
  /** Compare the working tree against this ref instead of HEAD (e.g. origin/main in CI). */
  base?: string;
}

const VALID_FORMATS = ['text', 'json'];

/** Matches get-dependents.ts's local threshold (also duplicated in review's blast-radius.ts) — accepted duplication until a shared helper is worth extracting. */
const HIGH_COMPLEXITY_THRESHOLD = 15;

export interface EnrichedExportedSymbolChange extends ExportedSymbolChange {
  /** null when the index was unavailable or enrichment failed (degraded — still fires, just without counts). */
  dependentCount: number | null;
  untestedDependentCount: number | null;
  riskLevel: string | null;
  enriched: boolean;
  /**
   * Distinct doc chunks that reference this symbol (see
   * docs/architecture/blast-radius-nudge.md's docRefs section). Only
   * computed for `kind === 'removed'` changes — null for `signature-changed`
   * (not applicable: the symbol still exists, so "docs reference it" isn't a
   * drift signal) and for a degraded (no index / lookup failed) change.
   */
  docRefCount: number | null;
  /** Up to `MAX_DOC_REF_PATHS` file paths backing `docRefCount`. Empty when `docRefCount` is null or 0. */
  docRefPaths: string[];
  /**
   * Present when `dependentCount`/`riskLevel` can't be trusted as a
   * verified clear -- the same five-reason vocabulary `get_dependents`
   * exposes as `attributionCaveat` (`AttributionCaveatReason`), computed by
   * the same shared `buildAttributionCaveatFromAnalysis` so the two
   * surfaces can never disagree about when to hedge (#1097). `null` when
   * enrichment found no reason to hedge, or when enrichment failed entirely
   * (`enriched: false`) and there was nothing to evaluate a caveat against.
   */
  attributionCaveat: AttributionCaveat | null;
}

export interface EnrichedSignatureDelta {
  filepath: string;
  changes: EnrichedExportedSymbolChange[];
}

function usageFlagError(options: ApiDeltaOptions): string | undefined {
  if (!VALID_FORMATS.includes(options.format)) {
    return `Invalid --format "${options.format}". Must be text or json.`;
  }
  if (options.file !== undefined && options.file.trim() === '') {
    return '--file requires a non-empty path.';
  }
  if (options.base !== undefined && options.base.trim() === '') {
    return '--base requires a non-empty ref.';
  }
  return undefined;
}

/** Degraded row: no index, or enrichment failed for this change. Still fires — just without counts. */
function degradedChange(change: ExportedSymbolChange): EnrichedExportedSymbolChange {
  return {
    ...change,
    dependentCount: null,
    untestedDependentCount: null,
    riskLevel: null,
    enriched: false,
    docRefCount: null,
    docRefPaths: [],
    attributionCaveat: null,
  };
}

/**
 * Mirrors get-dependents.ts's `computeRisk`: production-dependent breadth +
 * untested-production-dependent count + a high-complexity-and-uncovered
 * escalation, composed via the shared parser primitive.
 */
function computeRisk(analysis: DependencyAnalysisResult): string {
  const { productionDependentCount, uncoveredProductionDependents, complexityMetrics } = analysis;
  const maxComplexity = complexityMetrics.maxComplexity;
  const hasHighComplexityUncovered =
    uncoveredProductionDependents > 0 && maxComplexity >= HIGH_COMPLEXITY_THRESHOLD;
  return computeBlastRadiusRisk({
    dependentCount: productionDependentCount,
    uncoveredDependents: uncoveredProductionDependents,
    maxDependentComplexity: maxComplexity > 0 ? maxComplexity : undefined,
    hasHighComplexityUncovered,
    complexityRiskBoost: complexityMetrics.complexityRiskBoost,
  }).level;
}

/**
 * Doc-chunk references for a REMOVED symbol only — a `signature-changed`
 * symbol still exists, so "docs reference it" isn't a drift signal. Fails
 * open to `{ docRefCount: null, docRefPaths: [] }`, matching
 * `findDocReferences`'s own fail-open contract (see doc-references.ts).
 */
async function resolveDocRefs(
  vectorDB: Awaited<ReturnType<typeof createVectorDB>>,
  change: ExportedSymbolChange,
): Promise<Pick<EnrichedExportedSymbolChange, 'docRefCount' | 'docRefPaths'>> {
  if (change.kind !== 'removed') return { docRefCount: null, docRefPaths: [] };

  const docRefs = await findDocReferences(vectorDB, change.symbolName);
  return docRefs
    ? { docRefCount: docRefs.count, docRefPaths: docRefs.paths }
    : { docRefCount: null, docRefPaths: [] };
}

async function enrichOneChange(
  vectorDB: Awaited<ReturnType<typeof createVectorDB>>,
  filepath: string,
  change: ExportedSymbolChange,
  indexVersion: number,
  recoveryIndexes: RecoveryIndexes,
): Promise<EnrichedExportedSymbolChange> {
  try {
    const log = (): void => undefined;
    const analysis = await findDependents(
      vectorDB,
      filepath,
      log,
      change.symbolName,
      indexVersion,
      1,
      500,
      false,
      recoveryIndexes,
    );
    const docRefs = await resolveDocRefs(vectorDB, change);
    // Same composition/priority rules `get_dependents` uses for its own
    // `attributionCaveat` -- both surfaces call `findDependents` and get
    // back the same `DependencyAnalysisResult`, so whether this count can
    // be trusted as a verified clear must never be decided twice (#1097).
    const attributionCaveat =
      buildAttributionCaveatFromAnalysis(analysis, filepath, change.symbolName) ?? null;
    return {
      ...change,
      dependentCount: analysis.dependents.length,
      untestedDependentCount: analysis.uncoveredProductionDependents,
      riskLevel: computeRisk(analysis),
      enriched: true,
      attributionCaveat,
      ...docRefs,
    };
  } catch {
    return degradedChange(change);
  }
}

/**
 * Enrich every change with dependent counts + risk, best-effort. Only runs
 * index-touching work when there is at least one change (the rare event) —
 * the common edit pays only the cheap content-based detection. Degrades to
 * signature-only (whole batch) when no index exists (S0), the index exists
 * but has zero rows (S1 — cleared, moved aside, or mid-rebuild; without this
 * check `findDependents` would return a real-looking `dependentCount: 0`
 * marked `enriched: true`, indistinguishable from a verified empty result),
 * or the vectorDB itself fails to open; degrades per-change when
 * `findDependents` throws for that one symbol. Never throws.
 *
 * Deliberately does not surface S2 (stale index) here — this command is
 * advisory-only (see the module doc comment) and its core signal (which
 * exported symbols changed/were removed) comes from the git diff content,
 * not the index; only the enrichment counts could be mildly stale, which
 * doesn't warrant interrupting a nudge with a warning.
 */
async function enrichDeltas(
  rootDir: string,
  deltas: ExportedSignatureDelta[],
): Promise<EnrichedSignatureDelta[]> {
  if (deltas.length === 0) return [];

  try {
    const result = await classifyIndexState(rootDir, async () => {
      const vectorDB = await createVectorDB(rootDir);
      await vectorDB.initialize();
      return vectorDB;
    });

    if (result.state === 'S0' || result.state === 'S1' || !result.vectorDB) {
      return deltas.map(d => ({ filepath: d.filepath, changes: d.changes.map(degradedChange) }));
    }

    const vectorDB = result.vectorDB;
    // Captured once so every symbol in this run shares the scan cache inside
    // findDependents — only the first symbol in the batch pays the scanAll.
    const indexVersion = vectorDB.getCurrentVersion();
    // #1101: one recovery-index bag for the WHOLE batch, threaded into every
    // findDependents call below. Each of the three non-import recovery tiers
    // (C# type-reference, Go root-package, JVM same-package) would then be
    // built at most once for this entire `lien api-delta` invocation, however
    // many zero-dependent C#/Go/Java/Kotlin symbols the diff touches, instead
    // of once per symbol.
    //
    // Measured honesty note (dogfooded against a real OkHttp diff touching 3
    // zero-import-dependent Kotlin symbols, see the PR for the full numbers):
    // `enrichOneChange` below always calls `findDependents` with
    // `change.symbolName` set, and all three `enrichWith*Dependents` recovery
    // tiers (`dependency-analyzer.ts`) unconditionally skip whenever `symbol`
    // is truthy -- that gate predates this PR and isn't relaxed here. So
    // today this bag never actually gets populated from THIS call site (a
    // real before/after run showed byte-identical output and no wall-clock
    // change). It's still threaded through because it's the shape #1101
    // asks for, costs nothing, and is exactly correct if a future change ever
    // extends recovery to symbol-scoped queries -- the actually-measurable
    // win today is any FILE-LEVEL (symbol-omitted) caller looping
    // `findDependents`, which this repo doesn't have one of yet.
    const recoveryIndexes: RecoveryIndexes = {};

    const results: EnrichedSignatureDelta[] = [];
    for (const delta of deltas) {
      const changes = await Promise.all(
        delta.changes.map(c =>
          enrichOneChange(vectorDB, delta.filepath, c, indexVersion, recoveryIndexes),
        ),
      );
      results.push({ filepath: delta.filepath, changes });
    }
    return results;
  } catch {
    // The vectorDB itself failed to open (corrupt store, etc.) — degrade the
    // whole batch rather than partially enrich and partially throw.
    return deltas.map(d => ({ filepath: d.filepath, changes: d.changes.map(degradedChange) }));
  }
}

function buildBlastEvent(delta: EnrichedSignatureDelta, now: Date): BlastEvent {
  return {
    timestamp: now.toISOString(),
    filepath: delta.filepath,
    changes: delta.changes.map(c => ({
      symbol: c.symbol,
      kind: c.kind,
      dependentCount: c.dependentCount,
      untestedDependentCount: c.untestedDependentCount,
      riskLevel: c.riskLevel,
      docRefCount: c.docRefCount,
      attributionCaveat: c.attributionCaveat,
    })),
    enriched: delta.changes.some(c => c.enriched),
  };
}

/** " — N docs reference X: path1, path2 (+K more)" when the removed symbol has doc references, else "". */
function fmtDocRefs(c: EnrichedExportedSymbolChange): string {
  if (!c.docRefCount) return '';
  const shown = c.docRefPaths.join(', ');
  const more =
    c.docRefCount > c.docRefPaths.length ? ` (+${c.docRefCount - c.docRefPaths.length} more)` : '';
  return chalk.dim(` — ${c.docRefCount} docs reference ${c.symbol}: ${shown}${more}`);
}

/**
 * A trailing warning line when `dependentCount`/`riskLevel` can't be
 * trusted as a verified clear (#1097) — the same signal `get_dependents`
 * surfaces as `attributionCaveat`. Without this, a Java/Kotlin/Swift/C#
 * same-unit-access blind spot renders identically to a genuinely verified
 * "0 dependents, risk low", which is exactly the false-all-clear CLAUDE.md's
 * index-state-honesty policy exists to prevent.
 */
function fmtAttributionCaveat(c: EnrichedExportedSymbolChange): string {
  if (!c.attributionCaveat) return '';
  return chalk.yellow(`\n      ⚠ ${c.attributionCaveat.note}`);
}

function fmtChange(c: EnrichedExportedSymbolChange): string {
  const label = c.kind === 'removed' ? chalk.red('✗ removed  ') : chalk.yellow('⚠ changed  ');
  const detail = c.enriched
    ? ` — ${c.dependentCount} dependents, ${c.untestedDependentCount} untested, risk ${c.riskLevel}`
    : chalk.dim(' — index unavailable for counts');
  return `    ${label}${c.symbol}${detail}${fmtDocRefs(c)}${fmtAttributionCaveat(c)}`;
}

/** Render the human-readable report. Pure — no I/O, no process state. */
export function formatApiDeltaText(deltas: EnrichedSignatureDelta[], baseLabel = 'HEAD'): string {
  const withChanges = deltas.filter(d => d.changes.length > 0);
  if (withChanges.length === 0) {
    return chalk.dim(`lien api-delta — no exported-signature changes vs ${baseLabel}`);
  }

  const lines: string[] = [
    chalk.bold(`lien api-delta — exported-signature changes vs ${baseLabel}`),
    '',
  ];
  for (const delta of withChanges) {
    lines.push(`  ${chalk.cyan(delta.filepath)}`);
    for (const change of delta.changes) lines.push(fmtChange(change));
    lines.push('');
  }
  lines.push(
    chalk.dim('  → run get_dependents on any changed/removed symbol before relying on callers.'),
  );
  return lines.join('\n');
}

async function collectChanges(
  rootDir: string,
  options: ApiDeltaOptions,
): Promise<FileContentChange[]> {
  if (options.file !== undefined) {
    const single = await collectFileChange(rootDir, options.file, options.base);
    return single ? [single] : [];
  }
  return collectFileChanges(rootDir, options.base);
}

/**
 * Resolve the repo root and collect the changed-file content pairs, exiting 2
 * on any operational failure (not a git repo, a git error). Split out of
 * `apiDeltaCommand` purely to keep that function short and readable.
 */
async function resolveChanges(options: ApiDeltaOptions): Promise<{
  rootDir: string;
  changes: FileContentChange[];
}> {
  const rootDir = await getRepoRoot(process.cwd());
  if (!rootDir) {
    console.error(chalk.red('lien api-delta: not a git repository (or git is not installed)'));
    process.exit(2);
  }

  try {
    return { rootDir, changes: await collectChanges(rootDir, options) };
  } catch (error) {
    console.error(
      chalk.red(
        `lien api-delta: failed to read git changes: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(2);
  }
}

/** Record one ledger event per changed file — never for a clean run (see blast-events.ts). */
async function recordAllBlastEvents(
  rootDir: string,
  enriched: EnrichedSignatureDelta[],
): Promise<void> {
  const now = new Date();
  for (const delta of enriched) {
    await recordBlastEvent(rootDir, buildBlastEvent(delta, now));
  }
}

/** Print the result in the requested format. `--file` mode prints a single flat object (what the hook parses). */
function printResult(
  options: ApiDeltaOptions,
  changes: FileContentChange[],
  enriched: EnrichedSignatureDelta[],
): void {
  if (options.format !== 'json') {
    console.log(formatApiDeltaText(enriched, options.base ?? 'HEAD'));
    return;
  }
  if (options.file === undefined) {
    console.log(JSON.stringify(enriched));
    return;
  }
  const fallbackFilepath = changes[0]?.filepath ?? options.file;
  const primary = enriched.find(d => d.filepath === fallbackFilepath) ?? {
    filepath: fallbackFilepath,
    changes: [],
  };
  console.log(JSON.stringify(primary));
}

/** Analyze the working tree's exported-signature delta vs HEAD (or `--base <ref>`). */
export async function apiDeltaCommand(options: ApiDeltaOptions): Promise<void> {
  const usageError = usageFlagError(options);
  if (usageError) {
    console.error(chalk.red(`lien api-delta: ${usageError}`));
    process.exit(2);
  }

  const { rootDir, changes } = await resolveChanges(options);

  const deltas = changes.map(computeExportedSignatureDelta).filter(d => d.changes.length > 0);
  const enriched = await enrichDeltas(rootDir, deltas);
  await recordAllBlastEvents(rootDir, enriched);
  printResult(options, changes, enriched);

  // Advisory only — this is never a gate, so it always exits 0 once it ran.
  process.exit(0);
}
