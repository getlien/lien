import type Parser from 'tree-sitter';
import type { ASTChunk } from './types.js';
import { parseAST, detectLanguage, isASTSupported } from './parser.js';
import { extractSymbolInfo, extractImports } from './symbols.js';

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
  
  // Extract file-level imports once
  const fileImports = extractImports(rootNode);
  
  // Find all top-level function and class declarations
  const topLevelNodes = findTopLevelNodes(rootNode);
  
  for (const node of topLevelNodes) {
    // For variable declarations, try to find the function inside
    let actualNode = node;
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const funcNode = findActualFunctionNode(node);
      if (funcNode) {
        actualNode = funcNode;
      }
    }
    
    // For methods, find the parent class name
    let parentClassName: string | undefined;
    if (actualNode.type === 'method_definition') {
      parentClassName = findParentClassName(actualNode);
    }
    
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
 * Find the parent class name for a method node
 */
function findParentClassName(methodNode: Parser.SyntaxNode): string | undefined {
  let current = methodNode.parent;
  while (current) {
    if (current.type === 'class_declaration') {
      const nameNode = current.childForFieldName('name');
      return nameNode?.text;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Find all top-level nodes that should become chunks
 */
function findTopLevelNodes(rootNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const nodes: Parser.SyntaxNode[] = [];
  
  const targetTypes = [
    'function_declaration',
    'function',
    // Note: 'class_declaration' is NOT included here - we extract methods individually
    'interface_declaration',
    'method_definition',
    'lexical_declaration', // For const/let with arrow functions
    'variable_declaration', // For var with functions
  ];
  
  function traverse(node: Parser.SyntaxNode, depth: number) {
    // For lexical declarations (const/let), check if it contains an arrow function
    if ((node.type === 'lexical_declaration' || node.type === 'variable_declaration') && depth === 0) {
      // Check if this declaration contains a function
      const hasFunction = findFunctionInDeclaration(node);
      if (hasFunction) {
        nodes.push(node);
        return;
      }
    }
    
    // Only consider top-level or direct children of classes
    if (depth <= 1 && targetTypes.includes(node.type)) {
      nodes.push(node);
      return; // Don't traverse into this node
    }
    
    // For class bodies, traverse methods
    if (node.type === 'class_body') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) traverse(child, depth);
      }
      return;
    }
    
    // For classes, traverse the body to extract methods (don't chunk the class itself)
    if (node.type === 'class_declaration') {
      const body = node.childForFieldName('body');
      if (body) {
        traverse(body, depth + 1);
      }
      return;
    }
    
    // Traverse children for program and export statements
    if (node.type === 'program' || node.type === 'export_statement') {
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
 * Check if a declaration node contains a function (arrow, function expression, etc.)
 */
function findFunctionInDeclaration(node: Parser.SyntaxNode): boolean {
  const functionTypes = ['arrow_function', 'function_expression', 'function'];
  
  function search(n: Parser.SyntaxNode, depth: number): boolean {
    if (depth > 3) return false; // Don't search too deep
    
    if (functionTypes.includes(n.type)) {
      return true;
    }
    
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child && search(child, depth + 1)) {
        return true;
      }
    }
    
    return false;
  }
  
  return search(node, 0);
}

/**
 * Find the actual function node within a declaration
 */
function findActualFunctionNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  const functionTypes = ['arrow_function', 'function_expression', 'function'];
  
  function search(n: Parser.SyntaxNode, depth: number): Parser.SyntaxNode | null {
    if (depth > 3) return null;
    
    if (functionTypes.includes(n.type)) {
      return n;
    }
    
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) {
        const result = search(child, depth + 1);
        if (result) return result;
      }
    }
    
    return null;
  }
  
  return search(node, 0);
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
  const chunks: ASTChunk[] = [];
  let currentStart = 0;
  
  // Sort covered ranges
  coveredRanges.sort((a, b) => a.start - b.start);
  
  for (const range of coveredRanges) {
    if (currentStart < range.start) {
      // There's uncovered code before this range
      const uncoveredLines = lines.slice(currentStart, range.start);
      const content = uncoveredLines.join('\n').trim();
      
      if (content.length > 0 && uncoveredLines.length >= minChunkSize) {
        chunks.push({
          content,
          metadata: {
            file: filepath,
            startLine: currentStart + 1,
            endLine: range.start,
            type: 'block',
            language,
            // Empty symbols for uncovered code (imports, exports, etc.)
            symbols: { functions: [], classes: [], interfaces: [] },
            imports,
          },
        });
      }
    }
    currentStart = range.end + 1;
  }
  
  // Handle remaining code after last covered range
  if (currentStart < lines.length) {
    const uncoveredLines = lines.slice(currentStart);
    const content = uncoveredLines.join('\n').trim();
    
    if (content.length > 0 && uncoveredLines.length >= minChunkSize) {
      chunks.push({
        content,
        metadata: {
          file: filepath,
          startLine: currentStart + 1,
          endLine: lines.length,
          type: 'block',
          language,
          // Empty symbols for uncovered code (imports, exports, etc.)
          symbols: { functions: [], classes: [], interfaces: [] },
          imports,
        },
      });
    }
  }
  
  return chunks;
}

/**
 * Check if AST chunking should be used for a file
 */
export function shouldUseAST(filepath: string): boolean {
  return isASTSupported(filepath);
}

