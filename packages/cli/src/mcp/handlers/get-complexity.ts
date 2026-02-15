import collect from 'collect.js';
import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetComplexitySchema } from '../schemas/index.js';
import type { GetComplexityInput } from '../schemas/index.js';
import { ComplexityAnalyzer } from '@liendev/core';
import type {
  ComplexityViolation,
  FileComplexityData,
  ComplexityReport,
  VectorDBInterface,
} from '@liendev/core';
import type { ToolContext, MCPToolResult, LogFn } from '../types.js';

// ============================================================================
// Types
// ============================================================================

type ChunkWithRepo = { metadata: { file: string; repoId?: string } };
type TransformedViolation = ReturnType<typeof transformViolation>;

interface CrossRepoResult {
  chunks: ChunkWithRepo[];
  fallback: boolean;
}

interface ProcessedViolations {
  violations: TransformedViolation[];
  topViolations: TransformedViolation[];
  bySeverity: { error: number; warning: number };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform a violation with file-level metadata for API response.
 */
function transformViolation(v: ComplexityViolation, fileData: FileComplexityData) {
  return {
    filepath: v.filepath,
    symbolName: v.symbolName,
    symbolType: v.symbolType,
    startLine: v.startLine,
    endLine: v.endLine,
    complexity: v.complexity,
    metricType: v.metricType,
    threshold: v.threshold,
    severity: v.severity,
    language: v.language,
    message: v.message,
    dependentCount: fileData.dependentCount || 0,
    riskLevel: fileData.riskLevel,
    ...(v.halsteadDetails && { halsteadDetails: v.halsteadDetails }),
  };
}

/**
 * Group complexity violations by repository ID.
 */
function groupViolationsByRepo(
  violations: TransformedViolation[],
  allChunks: ChunkWithRepo[],
): Record<string, TransformedViolation[]> {
  const fileToRepo = new Map<string, string>();

  for (const chunk of allChunks) {
    const repoId = chunk.metadata.repoId || 'unknown';
    fileToRepo.set(chunk.metadata.file, repoId);
  }

  const grouped: Record<string, TransformedViolation[]> = {};
  for (const violation of violations) {
    const repoId = fileToRepo.get(violation.filepath) || 'unknown';
    if (!grouped[repoId]) {
      grouped[repoId] = [];
    }
    grouped[repoId].push(violation);
  }

  return grouped;
}

/**
 * Fetch chunks for cross-repo analysis.
 * Returns fallback=true if cross-repo was requested but Qdrant unavailable.
 */
async function fetchCrossRepoChunks(
  vectorDB: VectorDBInterface,
  crossRepo: boolean | undefined,
  repoIds: string[] | undefined,
  log: LogFn,
): Promise<CrossRepoResult> {
  if (!crossRepo) {
    return { chunks: [], fallback: false };
  }

  if (vectorDB.supportsCrossRepo) {
    const chunks = await vectorDB.scanCrossRepo({ limit: 100000, repoIds });
    log(`Scanned ${chunks.length} chunks across repos`);
    return { chunks, fallback: false };
  }

  return { chunks: [], fallback: true };
}

/**
 * Process violations from complexity report.
 * Transforms, filters, and sorts violations.
 */
function processViolations(
  report: ComplexityReport,
  threshold: number | undefined,
  top: number,
  metricType?: GetComplexityInput['metricType'],
): ProcessedViolations {
  const allViolations: TransformedViolation[] = collect(Object.entries(report.files))
    .flatMap(([, /* filepath unused */ fileData]) =>
      fileData.violations
        .filter(v => !metricType || v.metricType === metricType)
        .filter(v => threshold === undefined || v.complexity >= threshold)
        .map(v => transformViolation(v, fileData)),
    )
    .sortByDesc('complexity')
    .all() as unknown as TransformedViolation[];

  const violations = allViolations;

  const severityCounts = collect(violations).countBy('severity').all() as {
    error?: number;
    warning?: number;
  };

  return {
    violations,
    topViolations: violations.slice(0, top),
    bySeverity: {
      error: severityCounts['error'] || 0,
      warning: severityCounts['warning'] || 0,
    },
  };
}

/**
 * Build warning note for cross-repo fallback.
 */
function buildCrossRepoFallbackNote(fallback: boolean): string | undefined {
  return fallback
    ? 'Cross-repo analysis requires a cross-repo-capable backend. Fell back to single-repo analysis.'
    : undefined;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle get_complexity tool calls.
 * Analyzes complexity for files or the entire codebase.
 */
export async function handleGetComplexity(args: unknown, ctx: ToolContext): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(GetComplexitySchema, async validatedArgs => {
    const { crossRepo, repoIds, files, top, threshold, metricType } = validatedArgs;
    log(`Analyzing complexity${crossRepo ? ' (cross-repo)' : ''}...`);
    await checkAndReconnect();

    // Step 1: Fetch cross-repo chunks if needed
    const { chunks: allChunks, fallback } = await fetchCrossRepoChunks(
      vectorDB,
      crossRepo,
      repoIds,
      log,
    );

    // Step 2: Run complexity analysis
    const analyzer = new ComplexityAnalyzer(vectorDB);
    const report = await analyzer.analyze(files, crossRepo && !fallback, repoIds);
    log(`Analyzed ${report.summary.filesAnalyzed} files`);

    // Step 3: Process violations
    const { violations, topViolations, bySeverity } = processViolations(
      report,
      threshold,
      top ?? 10,
      metricType,
    );

    // Step 4: Build response
    const note = buildCrossRepoFallbackNote(fallback);
    if (note) {
      log(
        'Warning: crossRepo=true requires a cross-repo-capable backend. Falling back to single-repo analysis.',
        'warning',
      );
    }

    return {
      indexInfo: getIndexMetadata(),
      summary: {
        filesAnalyzed: report.summary.filesAnalyzed,
        avgComplexity: report.summary.avgComplexity,
        maxComplexity: report.summary.maxComplexity,
        violationCount: violations.length,
        bySeverity,
      },
      violations: topViolations,
      ...(crossRepo &&
        !fallback &&
        allChunks.length > 0 && {
          groupedByRepo: groupViolationsByRepo(topViolations, allChunks),
        }),
      ...(note && { note }),
    };
  })(args);
}
