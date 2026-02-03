import type Parser from 'tree-sitter';
import type { CodeChunk } from '../types.js';

/**
 * AST parse result containing the tree and any errors
 */
export interface ASTParseResult {
  tree: Parser.Tree | null;
  error?: string;
}

/**
 * Symbol information extracted from AST nodes
 */
export interface SymbolInfo {
  name: string;
  type: 'function' | 'method' | 'class' | 'interface';
  startLine: number;
  endLine: number;
  parentClass?: string;
  signature?: string;
  parameters?: string[];
  returnType?: string;
  complexity?: number;
  cognitiveComplexity?: number;
}

/**
 * Semantic metadata for AST-aware chunks
 */
export interface SemanticMetadata {
  symbolName?: string;
  symbolType?: 'function' | 'method' | 'class' | 'interface';
  parentClass?: string;
  complexity?: number;
  cognitiveComplexity?: number;
  parameters?: string[];
  signature?: string;
  imports?: string[];
  
  // Halstead metrics (v0.19.0)
  halsteadVolume?: number;
  halsteadDifficulty?: number;
  halsteadEffort?: number;
  halsteadBugs?: number;
}

/**
 * AST-aware chunk with enhanced semantic metadata
 */
export interface ASTChunk extends CodeChunk {
  metadata: CodeChunk['metadata'] & SemanticMetadata;
}

/**
 * Supported languages for AST parsing.
 * Canonical definition lives in languages/registry.ts; re-exported here for convenience.
 */
export type { SupportedLanguage } from './languages/registry.js';

