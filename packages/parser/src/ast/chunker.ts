import type { ASTChunk, SupportedLanguage, SyntaxNode } from './types.js';
import { parseAST, detectLanguage, isASTSupported } from './parser.js';
import {
  extractSymbolInfo,
  extractImports,
  extractImportedSymbols,
  extractExports,
  extractCallSites,
} from './symbols.js';
import { calculateCognitiveComplexity, calculateHalstead } from './complexity/index.js';
import { getTraverser } from './traversers/index.js';
import { resolveWorkspacePackageEntries } from '../workspace-packages.js';

export interface ASTChunkOptions {
  minChunkSize?: number;
  /**
   * Absolute path to the workspace/monorepo root. When provided (and the
   * root has an npm `workspaces` field), bare package specifiers that name a
   * sibling workspace package (e.g. `@scope/pkg`) are resolved to that
   * package's source entry file, so cross-package imports participate in
   * dependency analysis. Omit for non-monorepo projects — behavior is
   * unchanged.
   */
  workspaceRoot?: string;
}

/**
 * Context extracted from the AST for chunk creation.
 */
interface ASTContext {
  lines: string[];
  fileImports: string[];
  importedSymbols: Record<string, string[]>;
  fileExports: string[];
  traverser: ReturnType<typeof getTraverser>;
}

/**
 * Validate language support and parse the file.
 * @throws Error if language not supported or parsing fails
 */
function parseAndValidate(filepath: string, content: string) {
  const language = detectLanguage(filepath);
  if (!language) {
    throw new Error(`Unsupported language for file: ${filepath}`);
  }

  const parseResult = parseAST(content, language);
  if (!parseResult.tree) {
    throw new Error(`Failed to parse ${filepath}: ${parseResult.error}`);
  }

  return { language, rootNode: parseResult.tree.rootNode };
}

/**
 * Languages that use `./` / `../` specifiers with filesystem semantics, where
 * resolving relative imports against the importer's path produces the correct
 * workspace-relative target.
 *
 * Deliberately excludes Rust: its extractor emits `../x` as an internal
 * storage convention for `super::x`, but that string does not describe the
 * actual filesystem target. `super::x` from `src/foo.rs` resolves to the
 * sibling module `src/x`, not to `src/../x` — so applying filesystem-style
 * `..` resolution here would produce wrong keys.
 *
 * Python's `from . import x` passes through as-is (different mechanics: dot
 * counting rather than path joining).
 */
const RESOLVE_RELATIVE_IMPORTS: ReadonlySet<SupportedLanguage> = new Set([
  'javascript',
  'typescript',
]);

/**
 * Prepare AST context by extracting imports, exports, and symbols.
 *
 * For JS/TS, `filepath` is threaded into the import extractors so that relative
 * specifiers (`./foo`, `../bar`) are resolved to workspace-relative paths at
 * index time. This prevents cross-package basename collisions in the downstream
 * dependency analysis (see #525).
 *
 * When `workspaceRoot` is also provided, bare package specifiers naming a
 * sibling workspace package (`@scope/pkg`) are resolved the same way, to that
 * package's source entry file — closing the monorepo cross-package blind
 * spot in `get_dependents`. Gated to the same JS/TS language set as relative
 * import resolution: npm workspaces is a JS-ecosystem mechanism, and other
 * languages' import syntax could otherwise coincidentally collide with a
 * workspace package name.
 */
function prepareASTContext(
  content: string,
  rootNode: SyntaxNode,
  language: SupportedLanguage,
  filepath: string,
  workspaceRoot?: string,
): ASTContext {
  const resolvesImports = RESOLVE_RELATIVE_IMPORTS.has(language);
  const resolutionPath = resolvesImports ? filepath : undefined;
  const workspacePackages =
    resolvesImports && workspaceRoot ? resolveWorkspacePackageEntries(workspaceRoot) : undefined;
  return {
    lines: content.split('\n'),
    fileImports: extractImports(rootNode, language, resolutionPath, workspacePackages),
    importedSymbols: extractImportedSymbols(rootNode, language, resolutionPath, workspacePackages),
    fileExports: extractExports(rootNode, language),
    traverser: getTraverser(language),
  };
}

/**
 * Process a single top-level node into a chunk.
 */
function processTopLevelNode(
  node: SyntaxNode,
  filepath: string,
  content: string,
  context: ASTContext,
  language: SupportedLanguage,
): ASTChunk {
  const { lines, fileImports, fileExports, importedSymbols, traverser } = context;

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
  const symbolInfo = extractSymbolInfo(actualNode, content, parentClassName, language);
  const nodeContent = getNodeContent(node, lines);

  return createChunk(
    filepath,
    node,
    nodeContent,
    symbolInfo,
    fileImports,
    language,
    fileExports,
    importedSymbols,
  );
}

/**
 * Process all top-level nodes into chunks.
 */
function processTopLevelNodes(
  topLevelNodes: SyntaxNode[],
  filepath: string,
  content: string,
  context: ASTContext,
  language: SupportedLanguage,
): ASTChunk[] {
  return topLevelNodes.map(node => processTopLevelNode(node, filepath, content, context, language));
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
  options: ASTChunkOptions = {},
): ASTChunk[] {
  const { minChunkSize = 5, workspaceRoot } = options;

  // Parse and validate
  const { language, rootNode } = parseAndValidate(filepath, content);

  // Prepare context
  const context = prepareASTContext(content, rootNode, language, filepath, workspaceRoot);

  // Find and process top-level nodes
  const topLevelNodes = findTopLevelNodes(rootNode, context.traverser);
  const topLevelChunks = processTopLevelNodes(topLevelNodes, filepath, content, context, language);

  // Extract uncovered code (imports, exports, top-level statements)
  const coveredRanges = topLevelNodes.map(n => ({
    start: n.startPosition.row,
    end: n.endPosition.row,
  }));
  const uncoveredChunks = extractUncoveredCode(
    context.lines,
    coveredRanges,
    filepath,
    minChunkSize,
    context.fileImports,
    language,
    context.fileExports,
    context.importedSymbols,
  );

  // Combine and sort by line number
  return [...topLevelChunks, ...uncoveredChunks].sort(
    (a, b) => a.metadata.startLine - b.metadata.startLine,
  );
}

/** Check if node is a function-containing declaration at top level */
function isFunctionDeclaration(
  node: SyntaxNode,
  depth: number,
  traverser: ReturnType<typeof getTraverser>,
): boolean {
  if (depth !== 0 || !traverser.isDeclarationWithFunction(node)) return false;
  return traverser.findFunctionInDeclaration(node).hasFunction;
}

/** Check if node is a target type at valid depth */
function isTargetNode(
  node: SyntaxNode,
  depth: number,
  traverser: ReturnType<typeof getTraverser>,
): boolean {
  return depth <= 1 && traverser.targetNodeTypes.includes(node.type);
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
  rootNode: SyntaxNode,
  traverser: ReturnType<typeof getTraverser>,
): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];

  function traverse(node: SyntaxNode, depth: number): void {
    // Capture function declarations and target nodes
    if (isFunctionDeclaration(node, depth, traverser) || isTargetNode(node, depth, traverser)) {
      nodes.push(node);
      return;
    }

    // Handle containers - emit the container itself AND traverse body for children
    if (traverser.shouldExtractChildren(node)) {
      nodes.push(node);
      const body = traverser.getContainerBody(node);
      if (body) traverse(body, depth + 1);
      return;
    }

    // Traverse children of traversable nodes
    if (!traverser.shouldTraverseChildren(node)) return;
    for (const child of node.namedChildren) {
      traverse(child, depth);
    }
  }

  traverse(rootNode, 0);
  return nodes;
}

/**
 * Extract content for a specific AST node
 */
function getNodeContent(node: SyntaxNode, lines: string[]): string {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;

  return lines.slice(startLine, endLine + 1).join('\n');
}

/** Maps symbol types to legacy symbol array keys */
const SYMBOL_TYPE_TO_ARRAY: Record<string, 'functions' | 'classes' | 'interfaces'> = {
  function: 'functions',
  method: 'functions',
  class: 'classes',
  interface: 'interfaces',
};

/** Symbol types that have meaningful complexity metrics */
const COMPLEXITY_SYMBOL_TYPES = new Set(['function', 'method']);

/**
 * Build legacy symbols object for backward compatibility
 */
function buildLegacySymbols(symbolInfo: ReturnType<typeof extractSymbolInfo>): {
  functions: string[];
  classes: string[];
  interfaces: string[];
} {
  const symbols = {
    functions: [] as string[],
    classes: [] as string[],
    interfaces: [] as string[],
  };

  if (symbolInfo?.name && symbolInfo.type) {
    const arrayKey = SYMBOL_TYPE_TO_ARRAY[symbolInfo.type];
    if (arrayKey) symbols[arrayKey].push(symbolInfo.name);
  }

  return symbols;
}

/**
 * Determine chunk type from symbol info
 */
function getChunkType(
  symbolInfo: ReturnType<typeof extractSymbolInfo>,
): 'block' | 'class' | 'function' {
  if (!symbolInfo) return 'block';
  return symbolInfo.type === 'class' ? 'class' : 'function';
}

/**
 * Create a chunk from an AST node
 */
function createChunk(
  filepath: string,
  node: SyntaxNode,
  content: string,
  symbolInfo: ReturnType<typeof extractSymbolInfo>,
  imports: string[],
  language: SupportedLanguage,
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
): ASTChunk {
  const symbols = buildLegacySymbols(symbolInfo);
  const shouldCalcComplexity = symbolInfo?.type && COMPLEXITY_SYMBOL_TYPES.has(symbolInfo.type);

  // Calculate complexity metrics only for functions and methods
  const cognitiveComplexity = shouldCalcComplexity ? calculateCognitiveComplexity(node) : undefined;

  // Calculate Halstead metrics only for functions and methods
  const halstead = shouldCalcComplexity ? calculateHalstead(node, language) : undefined;

  // Extract call sites for functions and methods
  const callSites = shouldCalcComplexity ? extractCallSites(node, language) : undefined;

  return {
    content,
    metadata: {
      file: filepath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: getChunkType(symbolInfo),
      language,
      symbols,
      symbolName: symbolInfo?.name,
      symbolType: symbolInfo?.type,
      parentClass: symbolInfo?.parentClass,
      complexity: symbolInfo?.complexity,
      cognitiveComplexity,
      parameters: symbolInfo?.parameters,
      signature: symbolInfo?.signature,
      returnType: symbolInfo?.returnType,
      imports,
      // Symbol-level dependency tracking
      // NOTE: `exports` and `importedSymbols` are file-level concepts, but we deliberately
      // attach them to every chunk from the same file (including "uncovered" chunks).
      // This duplicates some metadata, but greatly simplifies dependency analysis,
      // since consumers can inspect a single chunk in isolation without additional lookups.
      // This increases storage overhead but is acceptable given typical file sizes and chunk counts.
      ...(fileExports && fileExports.length > 0 && { exports: fileExports }),
      ...(importedSymbols && Object.keys(importedSymbols).length > 0 && { importedSymbols }),
      ...(callSites && callSites.length > 0 && { callSites }),
      // Halstead metrics
      halsteadVolume: halstead?.volume,
      halsteadDifficulty: halstead?.difficulty,
      halsteadEffort: halstead?.effort,
      halsteadBugs: halstead?.bugs,
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
function findUncoveredRanges(coveredRanges: LineRange[], totalLines: number): LineRange[] {
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
  language: SupportedLanguage,
  imports: string[],
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
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
      // Symbol-level dependency tracking
      ...(fileExports && fileExports.length > 0 && { exports: fileExports }),
      ...(importedSymbols && Object.keys(importedSymbols).length > 0 && { importedSymbols }),
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
  language: SupportedLanguage,
  fileExports?: string[],
  importedSymbols?: Record<string, string[]>,
): ASTChunk[] {
  const uncoveredRanges = findUncoveredRanges(coveredRanges, lines.length);

  const hasExports = fileExports && fileExports.length > 0;

  return uncoveredRanges
    .map(range =>
      createChunkFromRange(range, lines, filepath, language, imports, fileExports, importedSymbols),
    )
    .filter(chunk => (hasExports ? chunk.content.length > 0 : isValidChunk(chunk, minChunkSize)));
}

/**
 * Check if AST chunking should be used for a file
 */
export function shouldUseAST(filepath: string): boolean {
  return isASTSupported(filepath);
}
