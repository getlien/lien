import { ChunkMetadata } from '../indexer/types.js';

/**
 * Qdrant payload structure for storing chunk metadata.
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
  complexity: number;
  cognitiveComplexity: number;
  parameters: string[];
  signature: string;
  imports: string[];
  // Halstead metrics
  halsteadVolume: number;
  halsteadDifficulty: number;
  halsteadEffort: number;
  halsteadBugs: number;
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
   * Transform chunk metadata to Qdrant payload format.
   */
  toPayload(metadata: ChunkMetadata, content: string = ''): QdrantPayload {
    return {
      content,
      file: metadata.file,
      startLine: metadata.startLine,
      endLine: metadata.endLine,
      type: metadata.type,
      language: metadata.language,
      // Symbols
      functionNames: metadata.symbols?.functions || [],
      classNames: metadata.symbols?.classes || [],
      interfaceNames: metadata.symbols?.interfaces || [],
      // AST-derived metadata
      symbolName: metadata.symbolName || '',
      symbolType: metadata.symbolType || '',
      parentClass: metadata.parentClass || '',
      complexity: metadata.complexity || 0,
      cognitiveComplexity: metadata.cognitiveComplexity || 0,
      parameters: metadata.parameters || [],
      signature: metadata.signature || '',
      imports: metadata.imports || [],
      // Halstead metrics
      halsteadVolume: metadata.halsteadVolume || 0,
      halsteadDifficulty: metadata.halsteadDifficulty || 0,
      halsteadEffort: metadata.halsteadEffort || 0,
      halsteadBugs: metadata.halsteadBugs || 0,
      // Multi-tenant fields
      orgId: this.orgId,
      repoId: this.repoId,
      // Branch/commit tracking
      branch: this.branch,
      commitSha: this.commitSha,
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
      symbols: {
        functions: payload.functionNames || [],
        classes: payload.classNames || [],
        interfaces: payload.interfaceNames || [],
      },
      symbolName: payload.symbolName || undefined,
      symbolType: payload.symbolType || undefined,
      parentClass: payload.parentClass || undefined,
      complexity: payload.complexity || undefined,
      cognitiveComplexity: payload.cognitiveComplexity || undefined,
      parameters: payload.parameters || undefined,
      signature: payload.signature || undefined,
      imports: payload.imports || undefined,
      halsteadVolume: payload.halsteadVolume || undefined,
      halsteadDifficulty: payload.halsteadDifficulty || undefined,
      halsteadEffort: payload.halsteadEffort || undefined,
      halsteadBugs: payload.halsteadBugs || undefined,
      repoId: payload.repoId || undefined,
      orgId: payload.orgId || undefined,
      branch: payload.branch || undefined,
      commitSha: payload.commitSha || undefined,
    };
  }
}

