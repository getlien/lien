import type { ChunkMetadata } from '../indexer/types.js';

/**
 * Qdrant payload structure for storing chunk metadata.
 * 
 * Note: Metrics (complexity, halstead) are always present as numbers.
 * If missing in source metadata, they are stored as 0.
 */
export interface QdrantPayload {
  content: string;
  file: string;
  startLine: number;
  endLine: number;
  type: string;
  language: string;
  // Symbols
  functionNames: string[];
  classNames: string[];
  interfaceNames: string[];
  // AST-derived metadata
  symbolName: string;
  symbolType: string;
  parentClass: string;
  complexity: number;           // Always present (defaults to 0 if missing)
  cognitiveComplexity: number;  // Always present (defaults to 0 if missing)
  parameters: string[];
  signature: string;
  imports: string[];
  // Halstead metrics
  halsteadVolume: number;       // Always present (defaults to 0 if missing)
  halsteadDifficulty: number;   // Always present (defaults to 0 if missing)
  halsteadEffort: number;       // Always present (defaults to 0 if missing)
  halsteadBugs: number;         // Always present (defaults to 0 if missing)
  // Symbol-level dependency tracking (v0.23.0)
  exports: string[];
  importedSymbols: string;      // JSON-encoded Record<string, string[]>
  callSites: string;            // JSON-encoded Array<{symbol, line}>
  // Multi-tenant fields
  orgId: string;
  repoId: string;
  // Branch/commit tracking
  branch: string;
  commitSha: string;
}

/**
 * Maps between ChunkMetadata and Qdrant payload format.
 * Encapsulates the transformation logic for multi-tenant Qdrant storage.
 */
export class QdrantPayloadMapper {
  constructor(
    private orgId: string,
    private repoId: string,
    private branch: string,
    private commitSha: string
  ) {}

  /**
   * Map metrics from metadata to payload format.
   */
  private mapMetrics(metadata: ChunkMetadata) {
    return {
      complexity: metadata.complexity ?? 0,
      cognitiveComplexity: metadata.cognitiveComplexity ?? 0,
      halsteadVolume: metadata.halsteadVolume ?? 0,
      halsteadDifficulty: metadata.halsteadDifficulty ?? 0,
      halsteadEffort: metadata.halsteadEffort ?? 0,
      halsteadBugs: metadata.halsteadBugs ?? 0,
    };
  }

  /**
   * Map symbols from metadata to payload format.
   */
  private mapSymbols(metadata: ChunkMetadata) {
    return {
      functionNames: metadata.symbols?.functions ?? [],
      classNames: metadata.symbols?.classes ?? [],
      interfaceNames: metadata.symbols?.interfaces ?? [],
      symbolName: metadata.symbolName ?? '',
      symbolType: metadata.symbolType ?? '',
      parentClass: metadata.parentClass ?? '',
      parameters: metadata.parameters ?? [],
      signature: metadata.signature ?? '',
      imports: metadata.imports ?? [],
      // Symbol-level dependency tracking (v0.23.0)
      exports: metadata.exports ?? [],
      importedSymbols: metadata.importedSymbols ? JSON.stringify(metadata.importedSymbols) : '{}',
      callSites: metadata.callSites ? JSON.stringify(metadata.callSites) : '[]',
    };
  }

  /**
   * Transform chunk metadata to Qdrant payload format.
   */
  toPayload(metadata: ChunkMetadata, content: string = ''): QdrantPayload {
    const trackingInfo = {
      orgId: this.orgId,
      repoId: this.repoId,
      branch: this.branch,
      commitSha: this.commitSha,
    };

    return {
      content,
      file: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      type: metadata.type,
      language: metadata.language,
      ...this.mapSymbols(metadata),
      ...this.mapMetrics(metadata),
      ...trackingInfo,
    };
  }

  /**
   * Extract symbols from payload.
   */
  private extractSymbols(payload: Record<string, any>) {
    return {
      functions: payload.functionNames ?? [],
      classes: payload.classNames ?? [],
      interfaces: payload.interfaceNames ?? [],
    };
  }

  /**
   * Extract metrics from payload.
   */
  private extractMetrics(payload: Record<string, any>) {
    return {
      complexity: payload.complexity ?? undefined,
      cognitiveComplexity: payload.cognitiveComplexity ?? undefined,
      halsteadVolume: payload.halsteadVolume ?? undefined,
      halsteadDifficulty: payload.halsteadDifficulty ?? undefined,
      halsteadEffort: payload.halsteadEffort ?? undefined,
      halsteadBugs: payload.halsteadBugs ?? undefined,
    };
  }

  /**
   * Extract tracking info from payload.
   *
   * For legacy points indexed before branch/commit tracking was added, these
   * fields may be missing. In that case they are returned as undefined and
   * the points will not match branch/commitSha-based filters. Such data
   * effectively becomes \"orphaned\" until it is re-indexed with tracking
   * metadata, which is the expected migration path for old Qdrant data.
   */
  private extractTrackingInfo(payload: Record<string, any>) {
    return {
      repoId: payload.repoId ?? undefined,
      orgId: payload.orgId ?? undefined,
      branch: payload.branch ?? undefined,
      commitSha: payload.commitSha ?? undefined,
    };
  }

  /**
   * Parse JSON safely, returning default value on error or missing input.
   */
  private safeJsonParse<T>(json: string | undefined, defaultValue: T): T {
    if (json == null) {
      return defaultValue;
    }
    try {
      return JSON.parse(json);
    } catch (err) {
      console.warn(`QdrantPayloadMapper.safeJsonParse: failed to parse JSON. Returning default.`, err);
      return defaultValue;
    }
  }

  /**
   * Extract symbol-level dependency tracking fields.
   */
  private extractDependencyTracking(payload: Record<string, any>) {
    const exports = payload.exports?.length > 0 ? payload.exports : undefined;
    const importedSymbols = this.safeJsonParse<Record<string, string[]>>(
      payload.importedSymbols,
      {}
    );
    const callSites = this.safeJsonParse<Array<{ symbol: string; line: number }>>(
      payload.callSites,
      []
    );

    return {
      exports,
      importedSymbols: Object.keys(importedSymbols).length > 0 ? importedSymbols : undefined,
      callSites: callSites.length > 0 ? callSites : undefined,
    };
  }

  /**
   * Transform Qdrant payload back to ChunkMetadata.
   */
  fromPayload(payload: Record<string, any>): ChunkMetadata {
    return {
      file: payload.file,
      startLine: payload.startLine,
      endLine: payload.endLine,
      type: payload.type,
      language: payload.language,
      symbols: this.extractSymbols(payload),
      symbolName: payload.symbolName ?? undefined,
      symbolType: payload.symbolType ?? undefined,
      parentClass: payload.parentClass ?? undefined,
      parameters: payload.parameters ?? undefined,
      signature: payload.signature ?? undefined,
      imports: payload.imports ?? undefined,
      ...this.extractMetrics(payload),
      ...this.extractTrackingInfo(payload),
      ...this.extractDependencyTracking(payload),
    };
  }
}

