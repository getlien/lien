import type { CompatSyntaxNode, CompatTree } from './native/index.js';
import type { CodeChunk } from '../types.js';

/**
 * Canonical AST node/tree shapes for @liendev/parser (ADR-013 Phase 4-B).
 * Structurally identical to node-tree-sitter's `Parser.SyntaxNode`/
 * `Parser.Tree` (which the whole ast/** surface used to alias directly,
 * pre-native), but now sourced from the native-parser compat layer -- see
 * ./native/compat-node.ts. Keeping these names is what makes every prior
 * `Parser.SyntaxNode`/`Parser.Tree` reference a mechanical repoint.
 */
export type SyntaxNode = CompatSyntaxNode;
export type Tree = CompatTree;

/**
 * AST parse result containing the tree and any errors
 */
export interface ASTParseResult {
  tree: Tree | null;
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
  returnType?: string;
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
