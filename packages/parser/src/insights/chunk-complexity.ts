import type {
  ComplexityViolation,
  ComplexityReport,
  FileComplexityData,
  RiskLevel,
  HalsteadDetails,
} from './types.js';
import { RISK_ORDER } from './types.js';
import type { ChunkMetadata, CodeChunk } from '../types.js';
import { analyzeDependencies } from '../dependency-analyzer.js';
import { findTestAssociationsFromChunks } from '../test-associations.js';

/**
 * Hardcoded severity multipliers:
 * - Warning: triggers at 1x threshold (e.g., testPaths >= 15)
 * - Error: triggers at 2x threshold (e.g., testPaths >= 30)
 */
const SEVERITY = { warning: 1.0, error: 2.0 } as const;

/** Default complexity thresholds */
const DEFAULT_THRESHOLDS = {
  testPaths: 15,
  mentalLoad: 15,
  timeToUnderstandMinutes: 60,
  estimatedBugs: 1.5,
} as const;

/**
 * Normalize a file path to a consistent relative format.
 * Converts absolute paths to relative paths from workspace root.
 */
export function normalizeFilePath(filepath: string): string {
  const workspaceRoot = process.cwd();
  const normalized = filepath.replace(/\\/g, '/');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

  if (normalized.startsWith(normalizedRoot + '/')) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.slice(normalizedRoot.length);
  }
  return normalized;
}

/**
 * Check if a chunk's file matches any of the target files.
 * Uses exact match or suffix matching to avoid unintended matches.
 */
export function matchesAnyFile(chunkFile: string, targetFiles: string[]): boolean {
  const normalizedChunkFile = chunkFile.replace(/\\/g, '/');
  return targetFiles.some(target => {
    const normalizedTarget = target.replace(/\\/g, '/');
    return (
      normalizedChunkFile === normalizedTarget ||
      normalizedChunkFile.endsWith('/' + normalizedTarget)
    );
  });
}

/**
 * Create a violation if complexity exceeds threshold.
 */
export function createViolation(
  metadata: ChunkMetadata,
  complexity: number,
  baseThreshold: number,
  metricType: ComplexityViolation['metricType'],
): ComplexityViolation | null {
  const warningThreshold = baseThreshold * SEVERITY.warning;
  const errorThreshold = baseThreshold * SEVERITY.error;

  if (complexity < warningThreshold) return null;

  const violationSeverity = complexity >= errorThreshold ? 'error' : 'warning';
  const effectiveThreshold = violationSeverity === 'error' ? errorThreshold : warningThreshold;

  const message =
    metricType === 'cyclomatic'
      ? `Needs ~${complexity} test cases for full coverage (threshold: ${Math.round(effectiveThreshold)})`
      : `Mental load ${complexity} exceeds threshold ${Math.round(effectiveThreshold)} (hard to follow)`;

  return {
    filepath: metadata.file,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
    symbolName: metadata.symbolName || 'unknown',
    symbolType: metadata.symbolType as 'function' | 'method',
    language: metadata.language,
    complexity,
    threshold: Math.round(effectiveThreshold),
    severity: violationSeverity,
    message,
    metricType,
  };
}

/**
 * Convert Halstead effort to time in minutes.
 * Formula: Time (seconds) = Effort / 18 (Stroud number for mental discrimination)
 *          Time (minutes) = Effort / (18 * 60) = Effort / 1080
 */
export function effortToMinutes(effort: number): number {
  return effort / 1080;
}

/**
 * Convert time in minutes to Halstead effort.
 * Inverse of effortToMinutes().
 */
export function minutesToEffort(minutes: number): number {
  return minutes * 1080;
}

/**
 * Format minutes as human-readable time (e.g., "2h 30m" or "45m")
 */
export function formatTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

/**
 * Create a Halstead violation if metrics exceed thresholds.
 */
export function createHalsteadViolation(
  metadata: ChunkMetadata,
  metricValue: number,
  threshold: number,
  metricType: 'halstead_effort' | 'halstead_bugs',
): ComplexityViolation | null {
  const warningThreshold = threshold * SEVERITY.warning;
  const errorThreshold = threshold * SEVERITY.error;

  if (metricValue < warningThreshold) return null;

  const violationSeverity = metricValue >= errorThreshold ? 'error' : 'warning';
  const effectiveThreshold = violationSeverity === 'error' ? errorThreshold : warningThreshold;

  let message: string;
  if (metricType === 'halstead_effort') {
    const timeMinutes = effortToMinutes(metricValue);
    const thresholdMinutes = effortToMinutes(effectiveThreshold);
    message = `Time to understand ~${formatTime(timeMinutes)} exceeds threshold ${formatTime(thresholdMinutes)}`;
  } else {
    message = `Estimated bugs ${metricValue.toFixed(2)} exceeds threshold ${effectiveThreshold.toFixed(1)}`;
  }

  const halsteadDetails: HalsteadDetails = {
    volume: metadata.halsteadVolume || 0,
    difficulty: metadata.halsteadDifficulty || 0,
    effort: metadata.halsteadEffort || 0,
    bugs: metadata.halsteadBugs || 0,
  };

  let complexity: number;
  let displayThreshold: number;
  if (metricType === 'halstead_effort') {
    complexity = Math.round(effortToMinutes(metricValue));
    displayThreshold = Math.round(effortToMinutes(effectiveThreshold));
  } else {
    complexity = metricValue;
    displayThreshold = effectiveThreshold;
  }

  return {
    filepath: metadata.file,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
    symbolName: metadata.symbolName || 'unknown',
    symbolType: metadata.symbolType as 'function' | 'method',
    language: metadata.language,
    complexity,
    threshold: displayThreshold,
    severity: violationSeverity,
    message,
    metricType,
    halsteadDetails,
  };
}

/**
 * Check complexity metrics and create violations for a single chunk.
 */
export function checkChunkComplexity(
  metadata: ChunkMetadata,
  thresholds: {
    testPaths: number;
    mentalLoad: number;
    halsteadEffort?: number;
    estimatedBugs?: number;
  },
): ComplexityViolation[] {
  const violations: ComplexityViolation[] = [];

  if (metadata.complexity) {
    const v = createViolation(metadata, metadata.complexity, thresholds.testPaths, 'cyclomatic');
    if (v) violations.push(v);
  }

  if (metadata.cognitiveComplexity) {
    const v = createViolation(
      metadata,
      metadata.cognitiveComplexity,
      thresholds.mentalLoad,
      'cognitive',
    );
    if (v) violations.push(v);
  }

  if (thresholds.halsteadEffort && metadata.halsteadEffort) {
    const v = createHalsteadViolation(
      metadata,
      metadata.halsteadEffort,
      thresholds.halsteadEffort,
      'halstead_effort',
    );
    if (v) violations.push(v);
  }

  if (thresholds.estimatedBugs && metadata.halsteadBugs) {
    const v = createHalsteadViolation(
      metadata,
      metadata.halsteadBugs,
      thresholds.estimatedBugs,
      'halstead_bugs',
    );
    if (v) violations.push(v);
  }

  return violations;
}

/**
 * Deduplicate and filter chunks to only function/method types.
 */
export function getUniqueFunctionChunks(
  chunks: Array<{ content: string; metadata: ChunkMetadata }>,
): ChunkMetadata[] {
  const seen = new Set<string>();
  const result: ChunkMetadata[] = [];

  for (const { metadata } of chunks) {
    if (metadata.symbolType !== 'function' && metadata.symbolType !== 'method') continue;

    const key = `${metadata.repoId ?? ''}:${normalizeFilePath(metadata.file)}:${metadata.startLine}-${metadata.endLine}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(metadata);
  }

  return result;
}

interface ComplexityThresholds {
  testPaths: number;
  mentalLoad: number;
  timeToUnderstandMinutes: number;
  estimatedBugs: number;
}

/**
 * Find all complexity violations based on thresholds.
 */
export function findViolations(
  chunks: Array<{ content: string; metadata: ChunkMetadata }>,
  thresholds: ComplexityThresholds,
): ComplexityViolation[] {
  const halsteadEffort = minutesToEffort(thresholds.timeToUnderstandMinutes);

  const resolvedThresholds = {
    testPaths: thresholds.testPaths,
    mentalLoad: thresholds.mentalLoad,
    halsteadEffort,
    estimatedBugs: thresholds.estimatedBugs,
  };
  const functionChunks = getUniqueFunctionChunks(chunks);

  return functionChunks.flatMap(metadata => checkChunkComplexity(metadata, resolvedThresholds));
}

/**
 * Calculate risk level based on violations.
 */
export function calculateRiskLevel(violations: ComplexityViolation[]): RiskLevel {
  if (violations.length === 0) return 'low';

  const hasErrors = violations.some(v => v.severity === 'error');
  const errorCount = violations.filter(v => v.severity === 'error').length;

  if (errorCount >= 3) return 'critical';
  if (hasErrors) return 'high';
  if (violations.length >= 3) return 'medium';
  return 'low';
}

/**
 * Build the final report with summary and per-file data.
 */
export function buildReport(
  violations: ComplexityViolation[],
  allChunks: Array<{ content: string; metadata: ChunkMetadata }>,
): ComplexityReport {
  const fileViolationsMap = new Map<string, ComplexityViolation[]>();
  for (const violation of violations) {
    const normalizedPath = normalizeFilePath(violation.filepath);
    violation.filepath = normalizedPath;
    const existing = fileViolationsMap.get(normalizedPath) || [];
    existing.push(violation);
    fileViolationsMap.set(normalizedPath, existing);
  }

  const analyzedFiles = new Set(allChunks.map(c => normalizeFilePath(c.metadata.file)));

  const files: Record<string, FileComplexityData> = {};
  for (const filepath of analyzedFiles) {
    const fileViolations = fileViolationsMap.get(filepath) || [];
    files[filepath] = {
      violations: fileViolations,
      dependents: [],
      testAssociations: [],
      riskLevel: calculateRiskLevel(fileViolations),
    };
  }

  const errorCount = violations.filter(v => v.severity === 'error').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;

  const complexityValues = allChunks
    .filter(c => c.metadata.complexity !== undefined && c.metadata.complexity > 0)
    .map(c => c.metadata.complexity!);

  const avgComplexity =
    complexityValues.length > 0
      ? complexityValues.reduce((sum, val) => sum + val, 0) / complexityValues.length
      : 0;

  const maxComplexity = complexityValues.length > 0 ? Math.max(...complexityValues) : 0;

  return {
    summary: {
      filesAnalyzed: analyzedFiles.size,
      totalViolations: violations.length,
      bySeverity: { error: errorCount, warning: warningCount },
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      maxComplexity,
    },
    files,
  };
}

/**
 * Enrich files with violations with dependency data.
 */
export function enrichWithDependencies(report: ComplexityReport, allChunks: CodeChunk[]): void {
  const workspaceRoot = process.cwd();

  const filesWithViolations = Object.entries(report.files)
    .filter(([_, data]) => data.violations.length > 0)
    .map(([filepath, _]) => filepath);

  for (const filepath of filesWithViolations) {
    const fileData = report.files[filepath];

    const depAnalysis = analyzeDependencies(filepath, allChunks, workspaceRoot);

    fileData.dependents = depAnalysis.dependents.map(d => d.filepath);
    fileData.dependentCount = depAnalysis.dependentCount;

    if (RISK_ORDER[depAnalysis.riskLevel] > RISK_ORDER[fileData.riskLevel]) {
      fileData.riskLevel = depAnalysis.riskLevel;
    }

    if (depAnalysis.complexityMetrics) {
      fileData.dependentComplexityMetrics = {
        averageComplexity: depAnalysis.complexityMetrics.averageComplexity,
        maxComplexity: depAnalysis.complexityMetrics.maxComplexity,
        filesWithComplexityData: depAnalysis.complexityMetrics.filesWithComplexityData,
      };
    }
  }
}

/**
 * Analyze complexity from in-memory chunks (no VectorDB needed).
 * Standalone replacement for ComplexityAnalyzer.analyzeFromChunks().
 */
export function analyzeComplexityFromChunks(
  chunks: CodeChunk[],
  files?: string[],
  thresholdOverrides?: { testPaths?: number; mentalLoad?: number },
): ComplexityReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...thresholdOverrides };

  // Filter to specified files if provided
  const filtered = files ? chunks.filter(c => matchesAnyFile(c.metadata.file, files)) : chunks;

  // Find violations, build report, enrich with dependencies
  const violations = findViolations(filtered, thresholds);
  const report = buildReport(violations, filtered);
  enrichWithDependencies(report, chunks);

  // Enrich files with violations with test association data
  const filesWithViolations = Object.keys(report.files).filter(
    f => report.files[f].violations.length > 0,
  );
  if (filesWithViolations.length > 0) {
    const testMap = findTestAssociationsFromChunks(filesWithViolations, chunks);
    for (const [filepath, testFiles] of testMap) {
      if (report.files[filepath]) {
        report.files[filepath].testAssociations = testFiles;
      }
    }
  }

  return report;
}
