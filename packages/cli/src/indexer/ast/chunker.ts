import type Parser from 'tree-sitter';
import type { ASTChunk } from './types.js';
import { parseAST, detectLanguage, isASTSupported } from './parser.js';
import { extractSymbolInfo, extractImports } from './symbols.js';
import { getTraverser } from './traversers/index.js';

export interface ASTChunkOptions {
  maxChunkSize?: number; // Reserved for future use (smart splitting of large functions)
  minChunkSize?: number;
}

/**
 * Chunk a file using AST-based semantic boundaries
 * 
 * Uses Tree-sitter to parse code into an AST and extract semantic chunks
 * (functions, classes, methods) that respect code structure.
 * 
 * **Known Limitations:**
 * - Tree-sitter may fail with "Invalid argument" error on very large files (1000+ lines)
 * - When this occurs, Lien automatically falls back to line-based chunking
 * - Configure fallback behavior via `chunking.astFallback` ('line-based' or 'error')
 * 
 * @param filepath - Path to the file
 * @param content - File content
 * @param options - Chunking options
 * @returns Array of AST-aware chunks
 * @throws Error if AST parsing fails and astFallback is 'error'
 */
export function chunkByAST(
  filepath: string,
  content: string,
  options: ASTChunkOptions = {}
): ASTChunk[] {
  const { minChunkSize = 5 } = options;
  
  // Check if AST is supported for this file
  const language = detectLanguage(filepath);
  if (!language) {
    throw new Error(`Unsupported language for file: ${filepath}`);
  }
  
  // Parse the file
  const parseResult = parseAST(content, language);
  
  // If parsing failed, throw error (caller should fallback to line-based)
  if (!parseResult.tree) {
    throw new Error(`Failed to parse ${filepath}: ${parseResult.error}`);
  }
  
  const chunks: ASTChunk[] = [];
  const lines = content.split('\n');
  const rootNode = parseResult.tree.rootNode;
  
  // Get language-specific traverser
  const traverser = getTraverser(language);
  
  // Extract file-level imports once
  const fileImports = extractImports(rootNode);
  
  // Find all top-level function and class declarations
  const topLevelNodes = findTopLevelNodes(rootNode, traverser);
  
  for (const node of topLevelNodes) {
    // For variable declarations, try to find the function inside
    let actualNode = node;
    if (traverser.isDeclarationWithFunction(node)) {
      const declInfo = traverser.findFunctionInDeclaration(node);
      if (declInfo.functionNode) {
        actualNode = declInfo.functionNode;
      }
    }
    
    // For methods, find the parent container name (e.g., class name)
    const parentClassName = traverser.findParentContainerName(actualNode);
    
    const symbolInfo = extractSymbolInfo(actualNode, content, parentClassName);
    
    // Extract the code for this node (use original node for full declaration)
    const nodeContent = getNodeContent(node, lines);
    
    // Create a chunk for this semantic unit
    // Note: Large functions are kept as single chunks (may exceed maxChunkSize)
    // This preserves semantic boundaries - better than splitting mid-function
    chunks.push(createChunk(filepath, node, nodeContent, symbolInfo, fileImports, language));
  }
  
  // Handle remaining code (imports, exports, top-level statements)
  const coveredRanges = topLevelNodes.map(n => ({
    start: n.startPosition.row,
    end: n.endPosition.row,
  }));
  
  const uncoveredChunks = extractUncoveredCode(
    lines,
    coveredRanges,
    filepath,
    minChunkSize,
    fileImports,
    language
  );
  
  chunks.push(...uncoveredChunks);
  
  // Sort chunks by line number
  chunks.sort((a, b) => a.metadata.startLine - b.metadata.startLine);
  
  return chunks;
}

/**
 * Find all top-level nodes that should become chunks
 * 
 * Uses a language-specific traverser to handle different AST structures.
 * This function is now language-agnostic - all language-specific logic
 * is delegated to the traverser.
 * 
 * @param rootNode - Root AST node
 * @param traverser - Language-specific traverser
 * @returns Array of nodes to extract as chunks
 */
function findTopLevelNodes(
  rootNode: Parser.SyntaxNode,
  traverser: ReturnType<typeof getTraverser>
): Parser.SyntaxNode[] {
  const nodes: Parser.SyntaxNode[] = [];
  
  function traverse(node: Parser.SyntaxNode, depth: number) {
    // Check if this is a declaration that might contain a function
    if (traverser.isDeclarationWithFunction(node) && depth === 0) {
      const declInfo = traverser.findFunctionInDeclaration(node);
      if (declInfo.hasFunction) {
        nodes.push(node);
        return;
      }
    }
    
    // Check if this is a target node type (function, method, etc.)
    if (depth <= 1 && traverser.targetNodeTypes.includes(node.type)) {
      nodes.push(node);
      return; // Don't traverse into this node
    }
    
    // Check if this is a container whose children should be extracted
    if (traverser.shouldExtractChildren(node)) {
      const body = traverser.getContainerBody(node);
      if (body) {
        traverse(body, depth + 1);
      }
      return;
    }
    
    // Check if we should traverse this node's children
    if (traverser.shouldTraverseChildren(node)) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child, depth);
      }
    }
  }
  
  traverse(rootNode, 0);
  return nodes;
}

/**
 * Extract content for a specific AST node
 */
function getNodeContent(node: Parser.SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  
  return lines.slice(startLine, endLine + 1).join('\n');
}

/**
 * Create a chunk from an AST node
 */
function createChunk(
  filepath: string,
  node: Parser.SyntaxNode,
  content: string,
  symbolInfo: ReturnType<typeof extractSymbolInfo>,
  imports: string[],
  language: string
): ASTChunk {
  // Populate legacy symbols field for backward compatibility
  const symbols = {
    functions: [] as string[],
    classes: [] as string[],
    interfaces: [] as string[],
  };
  
  if (symbolInfo?.name) {
    // Populate legacy symbols arrays based on symbol type
    if (symbolInfo.type === 'function' || symbolInfo.type === 'method') {
      symbols.functions.push(symbolInfo.name);
    } else if (symbolInfo.type === 'class') {
      symbols.classes.push(symbolInfo.name);
    } else if (symbolInfo.type === 'interface') {
      symbols.interfaces.push(symbolInfo.name);
    }
  }
  
  return {
    content,
    metadata: {
      file: filepath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: symbolInfo == null ? 'block' : (symbolInfo.type === 'class' ? 'class' : 'function'),
      language,
      // Legacy symbols field for backward compatibility
      symbols,
      // New AST-derived metadata
      symbolName: symbolInfo?.name,
      symbolType: symbolInfo?.type,
      parentClass: symbolInfo?.parentClass,
      complexity: symbolInfo?.complexity,
      parameters: symbolInfo?.parameters,
      signature: symbolInfo?.signature,
      imports,
    },
  };
}

/**
 * Represents a range of lines in a file
 */
interface LineRange {
  start: number;
  end: number;
}

/**
 * Find gaps between covered ranges (uncovered code)
 */
function findUncoveredRanges(
  coveredRanges: LineRange[],
  totalLines: number
): LineRange[] {
  const uncoveredRanges: LineRange[] = [];
  let currentStart = 0;
  
  // Sort covered ranges
  const sortedRanges = [...coveredRanges].sort((a, b) => a.start - b.start);
  
  for (const range of sortedRanges) {
    if (currentStart < range.start) {
      // There's a gap before this range
      uncoveredRanges.push({
        start: currentStart,
        end: range.start - 1,
      });
    }
    currentStart = range.end + 1;
  }
  
  // Handle remaining code after last covered range
  if (currentStart < totalLines) {
    uncoveredRanges.push({
      start: currentStart,
      end: totalLines - 1,
    });
  }
  
  return uncoveredRanges;
}

/**
 * Create a chunk from a line range
 */
function createChunkFromRange(
  range: LineRange,
  lines: string[],
  filepath: string,
  language: string,
  imports: string[]
): ASTChunk {
  const uncoveredLines = lines.slice(range.start, range.end + 1);
  const content = uncoveredLines.join('\n').trim();
  
  return {
    content,
    metadata: {
      file: filepath,
      startLine: range.start + 1,
      endLine: range.end + 1,
      type: 'block',
      language,
      // Empty symbols for uncovered code (imports, exports, etc.)
      symbols: { functions: [], classes: [], interfaces: [] },
      imports,
    },
  };
}

/**
 * Validate that a chunk meets the minimum size requirements
 */
function isValidChunk(chunk: ASTChunk, minChunkSize: number): boolean {
  const lineCount = chunk.metadata.endLine - chunk.metadata.startLine + 1;
  return chunk.content.length > 0 && lineCount >= minChunkSize;
}

/**
 * Extract code that wasn't covered by function/class chunks
 * (imports, exports, top-level statements)
 */
function extractUncoveredCode(
  lines: string[],
  coveredRanges: Array<{ start: number; end: number }>,
  filepath: string,
  minChunkSize: number,
  imports: string[],
  language: string
): ASTChunk[] {
  const uncoveredRanges = findUncoveredRanges(coveredRanges, lines.length);
  
  return uncoveredRanges
    .map(range => createChunkFromRange(range, lines, filepath, language, imports))
    .filter(chunk => isValidChunk(chunk, minChunkSize));
}

/**
 * Check if AST chunking should be used for a file
 */
export function shouldUseAST(filepath: string): boolean {
  return isASTSupported(filepath);
}

