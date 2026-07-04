/**
 * Complexity-delta primitive.
 *
 * Compares two versions of a file's content (before/after) and reports, per
 * function, whether a complexity metric newly crossed a threshold, worsened,
 * improved, or is unchanged. It is the single source of truth for both the
 * `lien delta` CLI (write-time) and — as a documented follow-up — the PR-review
 * engine (review-time), so the two can never structurally disagree.
 *
 * It reuses the existing complexity machinery end to end: `chunkFile` produces
 * one chunk per function/method carrying cyclomatic / cognitive / Halstead
 * metrics, and thresholds mirror `analyzeComplexityFromChunks`. No new metrics
 * are invented here.
 *
 * See docs/architecture/lien-delta.md for the design and honest limitations
 * (function-level renames are not tracked; overloads are paired positionally).
 */

import { chunkFile } from '../chunker.js';
import type { ChunkMetadata } from '../types.js';
import type { ComplexityMetricType } from './types.js';
import { effortToMinutes } from './chunk-complexity.js';

/**
 * Complexity thresholds — same shape and defaults as the config
 * `complexity.thresholds` block that `analyzeComplexityFromChunks` reads.
 */
export interface ComplexityDeltaThresholds {
  /** Cyclomatic complexity (config: testPaths). */
  testPaths: number;
  /** Cognitive complexity (config: mentalLoad). */
  mentalLoad: number;
  /** Halstead effort, expressed as minutes-to-understand (config: timeToUnderstandMinutes). */
  timeToUnderstandMinutes: number;
  /** Halstead estimated bugs (config: estimatedBugs). */
  estimatedBugs: number;
}

/** Default thresholds — mirror `DEFAULT_THRESHOLDS` in chunk-complexity.ts. */
export const DEFAULT_COMPLEXITY_DELTA_THRESHOLDS: ComplexityDeltaThresholds = {
  testPaths: 15,
  mentalLoad: 15,
  timeToUnderstandMinutes: 60,
  estimatedBugs: 1.5,
};

export type ComplexityDeltaVerdict =
  /** FAILS gate: function added and already over threshold. */
  | 'new-over-threshold'
  /** FAILS gate: function existed under threshold and is now over it. */
  | 'crossed'
  /** Advisory: increased but still under threshold. */
  | 'worsened'
  /** Advisory: was over threshold before and still is (no NEW crossing). */
  | 'pre-existing'
  /** Complexity decreased (may still be over threshold — that is fine). */
  | 'improved'
  /** No change. */
  | 'unchanged'
  /** Function added, under threshold. */
  | 'new-under-threshold'
  /** Function deleted. */
  | 'removed';

export interface MetricComplexityDelta {
  metricType: ComplexityMetricType;
  /** null => function is newly added (absent in "before"). */
  before: number | null;
  /** null => function was removed (absent in "after"). */
  after: number | null;
  threshold: number;
  verdict: ComplexityDeltaVerdict;
}

export interface FunctionComplexityDelta {
  /** Qualified match key, e.g. "MyClass::doThing". */
  key: string;
  symbolName: string;
  parentClass?: string;
  filepath: string;
  language: string;
  /** Location in the "after" image (or "before" if the function was removed). */
  startLine: number;
  /** Worst verdict across the function's metrics. */
  verdict: ComplexityDeltaVerdict;
  /** True iff the verdict is a failing verdict ('crossed' | 'new-over-threshold'). */
  isRegression: boolean;
  metrics: MetricComplexityDelta[];
}

export interface FileComplexityDelta {
  filepath: string;
  /** Set when the file was renamed. */
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  /** Functions whose verdict is not 'unchanged', sorted worst-first. */
  functions: FunctionComplexityDelta[];
}

export interface ComplexityDeltaSummary {
  filesChanged: number;
  functionsAnalyzed: number;
  regressions: number;
  crossed: number;
  newOverThreshold: number;
  worsened: number;
  improved: number;
}

export interface ComplexityDeltaResult {
  files: FileComplexityDelta[];
  /** Flattened convenience view of functions with a failing verdict. */
  regressions: FunctionComplexityDelta[];
  summary: ComplexityDeltaSummary;
  /** The resolved thresholds actually applied. */
  thresholds: ComplexityDeltaThresholds;
}

export interface FileContentChange {
  /** Path in the "after" tree (or the deleted path). */
  filepath: string;
  /** HEAD content; null = file added. */
  before: string | null;
  /** Working-tree content; null = file deleted. */
  after: string | null;
  /** Previous path, when renamed. */
  oldPath?: string;
}

/** Verdicts that fail a gate. */
const FAILING_VERDICTS: ReadonlySet<ComplexityDeltaVerdict> = new Set([
  'crossed',
  'new-over-threshold',
]);

/** Severity ordering — higher is worse; used to pick a function's overall verdict. */
const VERDICT_SEVERITY: Record<ComplexityDeltaVerdict, number> = {
  crossed: 7,
  'new-over-threshold': 6,
  'pre-existing': 5,
  worsened: 4,
  'new-under-threshold': 3,
  improved: 2,
  unchanged: 1,
  removed: 0,
};

interface MetricSpec {
  metricType: ComplexityMetricType;
  /** Raw metric value from chunk metadata, in the same unit as the threshold. */
  value: (m: ChunkMetadata) => number | undefined;
  threshold: (t: ComplexityDeltaThresholds) => number;
}

/**
 * The four metrics scored by `analyzeComplexityFromChunks`. Halstead effort is
 * converted to minutes so it is compared against `timeToUnderstandMinutes`
 * directly (equivalent to the review's effort-unit comparison, more readable).
 */
const METRIC_SPECS: readonly MetricSpec[] = [
  { metricType: 'cyclomatic', value: m => m.complexity, threshold: t => t.testPaths },
  { metricType: 'cognitive', value: m => m.cognitiveComplexity, threshold: t => t.mentalLoad },
  {
    metricType: 'halstead_effort',
    value: m => (m.halsteadEffort === undefined ? undefined : effortToMinutes(m.halsteadEffort)),
    threshold: t => t.timeToUnderstandMinutes,
  },
  { metricType: 'halstead_bugs', value: m => m.halsteadBugs, threshold: t => t.estimatedBugs },
];

export function resolveComplexityDeltaThresholds(
  overrides?: Partial<ComplexityDeltaThresholds>,
): ComplexityDeltaThresholds {
  return { ...DEFAULT_COMPLEXITY_DELTA_THRESHOLDS, ...overrides };
}

/** Whether any function in the result is a gate-failing regression. */
export function hasRegressions(result: ComplexityDeltaResult): boolean {
  return result.summary.regressions > 0;
}

/**
 * Classify one metric given before/after values and a threshold.
 *
 * Semantics note (`improved` vs `pre-existing` for a standing violation):
 * `improved` is reserved for a decrease that lands **strictly below** the
 * threshold. A function that was over threshold and drops but is *still* over
 * threshold (e.g. 20 → 18 against 15) is `pre-existing`, NOT `improved` — the
 * violation persists, and the report must never imply a still-violating
 * function is healthy. Neither verdict is a gate regression, so the exit code
 * is unaffected either way; this is purely about the honesty of the label.
 *
 * Exported for unit testing of the boundary cases.
 */
export function classifyMetric(
  before: number | null,
  after: number | null,
  threshold: number,
): ComplexityDeltaVerdict {
  if (after === null) return 'removed';
  if (before === null) return after >= threshold ? 'new-over-threshold' : 'new-under-threshold';
  if (before < threshold && after >= threshold) return 'crossed';
  if (before >= threshold) {
    // Standing violation.
    if (after < before) {
      // Dropped. Only call it 'improved' if it cleared the threshold; a decrease
      // that is still over threshold is 'pre-existing' (violation persists).
      return after < threshold ? 'improved' : 'pre-existing';
    }
    if (after > before) return 'pre-existing';
    return 'unchanged'; // unchanged and still over threshold — hidden from the report
  }
  // both under threshold
  if (after > before) return 'worsened';
  if (after < before) return 'improved';
  return 'unchanged';
}

/** Effective metric value for a side; null = function absent, present-but-unmeasured => 0. */
function metricValue(meta: ChunkMetadata | undefined, spec: MetricSpec): number | null {
  if (!meta) return null;
  const v = spec.value(meta);
  return v === undefined ? 0 : v;
}

/** Qualified match key: parentClass::symbolName (parentClass omitted when absent). */
function functionKey(meta: ChunkMetadata): string {
  return `${meta.parentClass ?? ''}::${meta.symbolName ?? ''}`;
}

/**
 * Chunk content into function/method metadata, grouped by qualified key and
 * sorted by startLine so same-keyed functions (overloads) pair positionally.
 */
function functionMetadataByKey(
  filepath: string,
  content: string | null,
): Map<string, ChunkMetadata[]> {
  const byKey = new Map<string, ChunkMetadata[]>();
  if (content === null) return byKey;

  const chunks = chunkFile(filepath, content, { useAST: true, astFallback: 'line-based' });
  for (const { metadata } of chunks) {
    if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') continue;
    if (!metadata.symbolName) continue;
    const key = functionKey(metadata);
    const list = byKey.get(key) ?? [];
    list.push(metadata);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startLine - b.startLine);
  }
  return byKey;
}

/** Build the per-function delta for a matched (before?, after?) pair. */
function buildFunctionDelta(
  before: ChunkMetadata | undefined,
  after: ChunkMetadata | undefined,
  filepath: string,
  thresholds: ComplexityDeltaThresholds,
): FunctionComplexityDelta | null {
  const anchor = after ?? before;
  if (!anchor) return null;

  const metrics: MetricComplexityDelta[] = [];
  for (const spec of METRIC_SPECS) {
    const b = metricValue(before, spec);
    const a = metricValue(after, spec);
    // Skip metrics with no signal on either present side (e.g. absent Halstead).
    if ((b ?? 0) === 0 && (a ?? 0) === 0) continue;
    const threshold = spec.threshold(thresholds);
    metrics.push({
      metricType: spec.metricType,
      before: b,
      after: a,
      threshold,
      verdict: classifyMetric(b, a, threshold),
    });
  }

  if (metrics.length === 0) return null;

  const verdict = metrics.reduce<ComplexityDeltaVerdict>(
    (worst, m) => (VERDICT_SEVERITY[m.verdict] > VERDICT_SEVERITY[worst] ? m.verdict : worst),
    'removed',
  );

  return {
    key: functionKey(anchor),
    symbolName: anchor.symbolName ?? '',
    parentClass: anchor.parentClass,
    filepath,
    language: anchor.language,
    startLine: anchor.startLine,
    verdict,
    isRegression: FAILING_VERDICTS.has(verdict),
    metrics,
  };
}

function fileStatus(change: FileContentChange): FileComplexityDelta['status'] {
  if (change.oldPath && change.oldPath !== change.filepath) return 'renamed';
  if (change.before === null) return 'added';
  if (change.after === null) return 'deleted';
  return 'modified';
}

/** Compute the complexity delta for a single file's before/after content. */
export function computeFileComplexityDelta(
  change: FileContentChange,
  thresholds?: Partial<ComplexityDeltaThresholds>,
): FileComplexityDelta {
  const resolved = resolveComplexityDeltaThresholds(thresholds);
  const beforePath = change.oldPath ?? change.filepath;

  const beforeByKey = functionMetadataByKey(beforePath, change.before);
  const afterByKey = functionMetadataByKey(change.filepath, change.after);

  const allKeys = new Set<string>([...beforeByKey.keys(), ...afterByKey.keys()]);
  const functions: FunctionComplexityDelta[] = [];

  for (const key of allKeys) {
    const beforeList = beforeByKey.get(key) ?? [];
    const afterList = afterByKey.get(key) ?? [];
    const pairs = Math.max(beforeList.length, afterList.length);
    for (let i = 0; i < pairs; i++) {
      const delta = buildFunctionDelta(beforeList[i], afterList[i], change.filepath, resolved);
      if (delta && delta.verdict !== 'unchanged') functions.push(delta);
    }
  }

  functions.sort((a, b) => VERDICT_SEVERITY[b.verdict] - VERDICT_SEVERITY[a.verdict]);

  return {
    filepath: change.filepath,
    ...(change.oldPath && change.oldPath !== change.filepath ? { oldPath: change.oldPath } : {}),
    status: fileStatus(change),
    functions,
  };
}

/** Compute the aggregated complexity delta across many files' before/after content. */
export function computeComplexityDelta(
  changes: FileContentChange[],
  thresholds?: Partial<ComplexityDeltaThresholds>,
): ComplexityDeltaResult {
  const resolved = resolveComplexityDeltaThresholds(thresholds);
  const files = changes.map(change => computeFileComplexityDelta(change, resolved));

  const regressions: FunctionComplexityDelta[] = [];
  const summary: ComplexityDeltaSummary = {
    filesChanged: files.length,
    functionsAnalyzed: 0,
    regressions: 0,
    crossed: 0,
    newOverThreshold: 0,
    worsened: 0,
    improved: 0,
  };

  for (const file of files) {
    for (const fn of file.functions) {
      summary.functionsAnalyzed++;
      if (fn.verdict === 'crossed') summary.crossed++;
      if (fn.verdict === 'new-over-threshold') summary.newOverThreshold++;
      if (fn.verdict === 'worsened') summary.worsened++;
      if (fn.verdict === 'improved') summary.improved++;
      if (fn.isRegression) {
        summary.regressions++;
        regressions.push(fn);
      }
    }
  }

  return { files, regressions, summary, thresholds: resolved };
}
