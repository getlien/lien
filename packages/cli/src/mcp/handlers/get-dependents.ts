import { wrapToolHandler } from '../utils/tool-wrapper.js';
import { GetDependentsSchema } from '../schemas/index.js';
import { normalizePath, matchesFile, getCanonicalPath, isTestFile } from '../utils/path-matching.js';
import type { ToolContext, MCPToolResult } from '../types.js';

/**
 * Complexity metrics for a single dependent file.
 */
interface FileComplexity {
  filepath: string;
  avgComplexity: number;
  maxComplexity: number;
  complexityScore: number; // Sum of all complexities
  chunksWithComplexity: number;
}

/**
 * Aggregate complexity metrics for all dependents.
 */
interface ComplexityMetrics {
  averageComplexity: number;
  maxComplexity: number;
  filesWithComplexityData: number;
  highComplexityDependents: Array<{
    filepath: string;
    maxComplexity: number;
    avgComplexity: number;
  }>;
  complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Risk level thresholds for dependent count.
 * Based on impact analysis: more dependents = higher risk of breaking changes.
 */
const DEPENDENT_COUNT_THRESHOLDS = {
  LOW: 5,       // Few dependents, safe to change
  MEDIUM: 15,   // Moderate impact, review dependents
  HIGH: 30,     // High impact, careful planning needed
} as const;

/**
 * Complexity thresholds for risk assessment.
 * Based on cyclomatic complexity: higher complexity = harder to change safely.
 */
const COMPLEXITY_THRESHOLDS = {
  HIGH_COMPLEXITY_DEPENDENT: 10,  // Individual file is complex
  CRITICAL_AVG: 15,              // Average complexity indicates systemic complexity
  CRITICAL_MAX: 25,              // Peak complexity indicates hotspot
  HIGH_AVG: 10,                  // Moderately complex on average
  HIGH_MAX: 20,                  // Some complex functions exist
  MEDIUM_AVG: 6,                 // Slightly above simple code
  MEDIUM_MAX: 15,                // Occasional branching
} as const;

/**
 * Maximum number of chunks to scan for dependency analysis.
 * Larger codebases may have incomplete results if they exceed this limit.
 */
const SCAN_LIMIT = 10000;

/**
 * Handle get_dependents tool calls.
 * Finds all code that depends on a file (reverse dependency lookup).
 */
export async function handleGetDependents(
  args: unknown,
  ctx: ToolContext
): Promise<MCPToolResult> {
  const { vectorDB, log, checkAndReconnect, getIndexMetadata } = ctx;

  return await wrapToolHandler(
    GetDependentsSchema,
    async (validatedArgs) => {
      log(`Finding dependents of: ${validatedArgs.filepath}`);

      // Check if index has been updated and reconnect if needed
      await checkAndReconnect();

      // Get all chunks - they include imports metadata
      const allChunks = await vectorDB.scanWithFilter({ limit: SCAN_LIMIT });

      // Warn if we hit the limit (results may be truncated)
      if (allChunks.length === SCAN_LIMIT) {
        log(`WARNING: Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete for large codebases.`);
      }

      log(`Scanning ${allChunks.length} chunks for imports...`);

      // Compute workspace root once (used by normalizePath and getCanonicalPath)
      const workspaceRoot = process.cwd().replace(/\\/g, '/');

      // Path normalization cache to avoid repeated string operations
      const pathCache = new Map<string, string>();
      const normalizePathCached = (path: string): string => {
        if (pathCache.has(path)) return pathCache.get(path)!;
        const normalized = normalizePath(path, workspaceRoot);
        pathCache.set(path, normalized);
        return normalized;
      };

      // Build import-to-chunk index for O(n) instead of O(n*m) lookup
      // Key: normalized import path, Value: array of chunks that import it
      const importIndex = new Map<string, typeof allChunks>();
      for (const chunk of allChunks) {
        const imports = chunk.metadata.imports || [];
        for (const imp of imports) {
          const normalizedImport = normalizePathCached(imp);
          if (!importIndex.has(normalizedImport)) {
            importIndex.set(normalizedImport, []);
          }
          importIndex.get(normalizedImport)!.push(chunk);
        }
      }

      // Find all chunks that import the target file using index + fuzzy matching
      const normalizedTarget = normalizePathCached(validatedArgs.filepath);
      const dependentChunks: typeof allChunks = [];
      // Track chunks we've already added to avoid duplicates when the same chunk
      // matches via multiple strategies (e.g., both direct lookup and fuzzy match)
      const seenChunkIds = new Set<string>();

      // First: Try direct index lookup (fastest path)
      if (importIndex.has(normalizedTarget)) {
        for (const chunk of importIndex.get(normalizedTarget)!) {
          // Use file + line range as unique chunk identifier
          const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
          if (!seenChunkIds.has(chunkId)) {
            dependentChunks.push(chunk);
            seenChunkIds.add(chunkId);
          }
        }
      }

      // Second: Fuzzy match against all unique import paths in the index
      // This handles relative imports and path variations
      for (const [normalizedImport, chunks] of importIndex.entries()) {
        // Skip exact match (already processed in direct lookup above)
        if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
          for (const chunk of chunks) {
            // Use file + line range as unique chunk identifier
            const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
            if (!seenChunkIds.has(chunkId)) {
              dependentChunks.push(chunk);
              seenChunkIds.add(chunkId);
            }
          }
        }
      }

      // Group chunks by file for complexity analysis
      // Use canonical paths (with extensions) for the final output to show users actual file names.
      // Multiple chunks from the same file are grouped together for accurate complexity metrics.
      const chunksByFile = new Map<string, typeof dependentChunks>();
      for (const chunk of dependentChunks) {
        const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
        const existing = chunksByFile.get(canonical) || [];
        existing.push(chunk);
        chunksByFile.set(canonical, existing);
      }

      // Calculate complexity metrics per file (using module-level interfaces)
      const fileComplexities: FileComplexity[] = [];

      for (const [filepath, chunks] of chunksByFile.entries()) {
        const complexities = chunks
          .map(c => c.metadata.complexity)
          .filter((c): c is number => typeof c === 'number' && c > 0);

        if (complexities.length > 0) {
          const sum = complexities.reduce((a, b) => a + b, 0);
          const avg = sum / complexities.length;
          // Math.max is safe here because complexities.length > 0 is guaranteed by the if condition
          const max = Math.max(...complexities);

          fileComplexities.push({
            filepath,
            avgComplexity: Math.round(avg * 10) / 10, // Round to 1 decimal
            maxComplexity: max,
            complexityScore: sum,
            chunksWithComplexity: complexities.length,
          });
        }
      }

      // Calculate overall complexity metrics (always return for consistent response shape)
      let complexityMetrics: ComplexityMetrics;

      if (fileComplexities.length > 0) {
        const allAvgs = fileComplexities.map(f => f.avgComplexity);
        const allMaxes = fileComplexities.map(f => f.maxComplexity);
        const totalAvg = allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length;
        // Math.max is safe here: allMaxes is non-empty because fileComplexities has entries
        const globalMax = Math.max(...allMaxes);

        // Identify high-complexity dependents
        const highComplexityDependents = fileComplexities
          .filter(f => f.maxComplexity > COMPLEXITY_THRESHOLDS.HIGH_COMPLEXITY_DEPENDENT)
          .sort((a, b) => b.maxComplexity - a.maxComplexity)
          .slice(0, 5) // Top 5
          .map(f => ({
            filepath: f.filepath,
            maxComplexity: f.maxComplexity,
            avgComplexity: f.avgComplexity,
          }));

        // Calculate complexity-based risk boost
        let complexityRiskBoost: 'low' | 'medium' | 'high' | 'critical' = 'low';
        if (totalAvg > COMPLEXITY_THRESHOLDS.CRITICAL_AVG || globalMax > COMPLEXITY_THRESHOLDS.CRITICAL_MAX) {
          complexityRiskBoost = 'critical';
        } else if (totalAvg > COMPLEXITY_THRESHOLDS.HIGH_AVG || globalMax > COMPLEXITY_THRESHOLDS.HIGH_MAX) {
          complexityRiskBoost = 'high';
        } else if (totalAvg > COMPLEXITY_THRESHOLDS.MEDIUM_AVG || globalMax > COMPLEXITY_THRESHOLDS.MEDIUM_MAX) {
          complexityRiskBoost = 'medium';
        }

        complexityMetrics = {
          averageComplexity: Math.round(totalAvg * 10) / 10,
          maxComplexity: globalMax,
          filesWithComplexityData: fileComplexities.length,
          highComplexityDependents,
          complexityRiskBoost,
        };
      } else {
        // No complexity data available - return empty structure for consistent response shape
        complexityMetrics = {
          averageComplexity: 0,
          maxComplexity: 0,
          filesWithComplexityData: 0,
          highComplexityDependents: [],
          complexityRiskBoost: 'low',
        };
      }

      // Use chunksByFile keys for the dependents list (already canonical and deduplicated)
      const uniqueFiles = Array.from(chunksByFile.keys()).map(filepath => ({
        filepath,
        isTestFile: isTestFile(filepath),
      }));

      // Calculate risk level based on dependent count (using module-level thresholds)
      const count = uniqueFiles.length;
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' =
        count === 0 ? 'low' :
        count <= DEPENDENT_COUNT_THRESHOLDS.LOW ? 'low' :
        count <= DEPENDENT_COUNT_THRESHOLDS.MEDIUM ? 'medium' :
        count <= DEPENDENT_COUNT_THRESHOLDS.HIGH ? 'high' : 'critical';

      // Boost risk level if complexity is high
      // Use explicit risk ordering for maintainability
      const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
      if (RISK_ORDER[complexityMetrics.complexityRiskBoost] > RISK_ORDER[riskLevel]) {
        riskLevel = complexityMetrics.complexityRiskBoost;
      }

      log(`Found ${count} dependent files (risk: ${riskLevel}${complexityMetrics.filesWithComplexityData > 0 ? ', complexity-boosted' : ''})`);

      // Build warning if scan limit was reached (results may be incomplete)
      let note: string | undefined;
      if (allChunks.length === SCAN_LIMIT) {
        note = `Warning: Scanned ${SCAN_LIMIT} chunks (limit reached). Results may be incomplete for large codebases. Some dependents might not be listed.`;
      }

      return {
        indexInfo: getIndexMetadata(),
        filepath: validatedArgs.filepath,
        dependentCount: count,
        riskLevel,
        dependents: uniqueFiles,
        complexityMetrics,
        note,
      };
    }
  )(args);
}


