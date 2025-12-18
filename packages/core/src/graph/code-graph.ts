import type { SearchResult } from '../vectordb/types.js';
import { normalizePath, getCanonicalPath, matchesFile, isTestFile } from '../utils/path-matching.js';
import type { GraphNode, GraphEdge, CodeGraph, GraphOptions } from './types.js';

/**
 * Creates a cached path normalizer to avoid repeated string operations.
 */
function createPathNormalizer(workspaceRoot: string): (path: string) => string {
  const cache = new Map<string, string>();
  return (path: string): string => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const normalized = normalizePath(path, workspaceRoot);
    cache.set(path, normalized);
    return normalized;
  };
}

/**
 * Builds an index mapping normalized import paths to chunks that import them.
 * Reuses the pattern from dependency-analyzer.ts
 */
function buildImportIndex(
  chunks: SearchResult[],
  normalizePathCached: (path: string) => string
): Map<string, SearchResult[]> {
  const importIndex = new Map<string, SearchResult[]>();
  
  for (const chunk of chunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const normalizedImport = normalizePathCached(imp);
      let chunkList = importIndex.get(normalizedImport);
      if (!chunkList) {
        chunkList = [];
        importIndex.set(normalizedImport, chunkList);
      }
      chunkList.push(chunk);
    }
  }
  
  return importIndex;
}


/**
 * Generates a unique node ID from a file path
 */
function nodeIdFromPath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Creates a graph node from a file path and its chunks
 */
function createNode(
  filePath: string,
  chunks: SearchResult[],
  includeComplexity: boolean
): GraphNode {
  const id = nodeIdFromPath(filePath);
  
  // Calculate average complexity if available
  let complexity: number | undefined;
  if (includeComplexity) {
    const complexities = chunks
      .map(c => c.metadata.complexity)
      .filter((c): c is number => typeof c === 'number' && c > 0);
    
    if (complexities.length > 0) {
      const sum = complexities.reduce((a, b) => a + b, 0);
      complexity = Math.round((sum / complexities.length) * 10) / 10;
    }
  }
  
  // Determine node type from chunks (prefer class/interface over function)
  let nodeType: GraphNode['type'] = 'file';
  for (const chunk of chunks) {
    if (chunk.metadata.symbolType === 'class') {
      nodeType = 'class';
      break;
    }
    if (chunk.metadata.symbolType === 'interface') {
      nodeType = 'interface';
      break;
    }
    if (chunk.metadata.symbolType === 'function' || chunk.metadata.symbolType === 'method') {
      nodeType = 'function';
    }
  }
  
  return {
    id,
    label: filePath,
    type: nodeType,
    filePath,
    complexity,
  };
}

/**
 * Traverses dependencies starting from a root file, up to a specified depth.
 */
function traverseDependencies(
  rootFile: string,
  depth: number,
  visited: Set<string>,
  importIndex: Map<string, SearchResult[]>,
  allChunks: SearchResult[],
  workspaceRoot: string,
  includeTests: boolean,
  includeComplexity: boolean,
  normalizePathCached: (path: string) => string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  
  if (depth <= 0) {
    return { nodes, edges };
  }
  
  const normalizedRoot = normalizePathCached(rootFile);
  
  // Prevent infinite loops from circular dependencies
  if (visited.has(normalizedRoot)) {
    return { nodes, edges };
  }
  visited.add(normalizedRoot);
  
  // Find chunks for the root file
  const rootChunks = allChunks.filter(chunk => {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    return normalizePathCached(canonical) === normalizedRoot;
  });
  
  if (rootChunks.length === 0) {
    // File not found in index - create a placeholder node
    const rootId = nodeIdFromPath(rootFile);
    nodes.push({
      id: rootId,
      label: rootFile,
      type: 'file',
      filePath: rootFile,
    });
    return { nodes, edges };
  }
  
  // Create root node
  const rootNode = createNode(rootFile, rootChunks, includeComplexity);
  nodes.push(rootNode);
  
  // Find dependencies (files that this file imports)
  const rootImports = new Set<string>();
  for (const chunk of rootChunks) {
    const imports = chunk.metadata.imports || [];
    for (const imp of imports) {
      const normalizedImport = normalizePathCached(imp);
      rootImports.add(normalizedImport);
    }
  }
  
  // Traverse each dependency
  for (const normalizedImport of rootImports) {
    // Find the actual file path for this import
    // Try to find a matching file in allChunks
    let dependencyFilePath: string | null = null;
    
    // First, try exact match
    for (const chunk of allChunks) {
      const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
      const normalizedCanonical = normalizePathCached(canonical);
      if (normalizedCanonical === normalizedImport) {
        dependencyFilePath = canonical;
        break;
      }
    }
    
    // If not found, try fuzzy match
    if (!dependencyFilePath) {
      for (const chunk of allChunks) {
        const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
        const normalizedCanonical = normalizePathCached(canonical);
        if (matchesFile(normalizedCanonical, normalizedImport)) {
          dependencyFilePath = canonical;
          break;
        }
      }
    }
    
    // Skip if file not found or is a test file (unless includeTests is true)
    if (!dependencyFilePath) {
      continue;
    }
    
    if (!includeTests && isTestFile(dependencyFilePath)) {
      continue;
    }
    
    // Recursively traverse dependencies
    const { nodes: depNodes, edges: depEdges } = traverseDependencies(
      dependencyFilePath,
      depth - 1,
      visited,
      importIndex,
      allChunks,
      workspaceRoot,
      includeTests,
      includeComplexity,
      normalizePathCached
    );
    
    // Add dependency nodes and edges
    nodes.push(...depNodes);
    edges.push(...depEdges);
    
    // Create edge from root to dependency
    const depNode = depNodes.find(n => normalizePathCached(n.filePath) === normalizePathCached(dependencyFilePath!));
    if (depNode) {
      edges.push({
        from: rootNode.id,
        to: depNode.id,
        type: 'imports',
      });
    }
  }
  
  return { nodes, edges };
}

/**
 * Generates code dependency graphs from indexed codebase.
 */
export class CodeGraphGenerator {
  constructor(
    private allChunks: SearchResult[],
    private workspaceRoot: string
  ) {}

  /**
   * Generate a dependency graph starting from a root file.
   */
  async generateGraph(options: GraphOptions): Promise<CodeGraph> {
    const {
      rootFile,
      depth,
      includeTests = false,
      includeComplexity = false,
    } = options;
    
    // Create cached path normalizer
    const normalizePathCached = createPathNormalizer(this.workspaceRoot);
    
    // Build import index for efficient lookup
    const importIndex = buildImportIndex(this.allChunks, normalizePathCached);
    
    // Traverse dependencies
    const visited = new Set<string>();
    const { nodes, edges } = traverseDependencies(
      rootFile,
      depth,
      visited,
      importIndex,
      this.allChunks,
      this.workspaceRoot,
      includeTests,
      includeComplexity,
      normalizePathCached
    );
    
    // Deduplicate nodes (same file might appear multiple times in traversal)
    const nodeMap = new Map<string, GraphNode>();
    for (const node of nodes) {
      const existing = nodeMap.get(node.id);
      if (!existing || (node.complexity && !existing.complexity)) {
        nodeMap.set(node.id, node);
      }
    }
    
    // Deduplicate edges
    const edgeSet = new Set<string>();
    const uniqueEdges: GraphEdge[] = [];
    for (const edge of edges) {
      const edgeKey = `${edge.from}->${edge.to}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        uniqueEdges.push(edge);
      }
    }
    
    return {
      nodes: Array.from(nodeMap.values()),
      edges: uniqueEdges,
      rootFile,
      depth,
    };
  }
}

