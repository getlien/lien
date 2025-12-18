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
 * Finds all chunks that import the target file (reverse dependencies).
 * Reuses pattern from dependency-analyzer.ts
 */
function findDependentChunks(
  normalizedTarget: string,
  importIndex: Map<string, SearchResult[]>
): SearchResult[] {
  const dependentChunks: SearchResult[] = [];
  const seenChunkIds = new Set<string>();
  
  const addChunk = (chunk: SearchResult): void => {
    const chunkId = `${chunk.metadata.file}:${chunk.metadata.startLine}-${chunk.metadata.endLine}`;
    if (!seenChunkIds.has(chunkId)) {
      dependentChunks.push(chunk);
      seenChunkIds.add(chunkId);
    }
  };
  
  // Direct index lookup (fastest path)
  const directMatches = importIndex.get(normalizedTarget);
  if (directMatches) {
    for (const chunk of directMatches) {
      addChunk(chunk);
    }
  }
  
  // Fuzzy match for relative imports and path variations
  for (const [normalizedImport, chunks] of importIndex.entries()) {
    if (normalizedImport !== normalizedTarget && matchesFile(normalizedImport, normalizedTarget)) {
      for (const chunk of chunks) {
        addChunk(chunk);
      }
    }
  }
  
  return dependentChunks;
}

/**
 * Traverses reverse dependencies (what depends on this file), up to a specified depth.
 */
function traverseReverseDependencies(
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
  
  // Find dependents (files that import this file)
  const dependentChunks = findDependentChunks(normalizedRoot, importIndex);
  
  // Group dependents by file
  const dependentsByFile = new Map<string, SearchResult[]>();
  for (const chunk of dependentChunks) {
    const canonical = getCanonicalPath(chunk.metadata.file, workspaceRoot);
    const existing = dependentsByFile.get(canonical) || [];
    existing.push(chunk);
    dependentsByFile.set(canonical, existing);
  }
  
  // Traverse each dependent
  for (const [dependentFilePath] of dependentsByFile.entries()) {
    // Skip if is a test file (unless includeTests is true)
    if (!includeTests && isTestFile(dependentFilePath)) {
      continue;
    }
    
    // Recursively traverse reverse dependencies
    const { nodes: depNodes, edges: depEdges } = traverseReverseDependencies(
      dependentFilePath,
      depth - 1,
      visited,
      importIndex,
      allChunks,
      workspaceRoot,
      includeTests,
      includeComplexity,
      normalizePathCached
    );
    
    // Add dependent nodes and edges
    nodes.push(...depNodes);
    edges.push(...depEdges);
    
    // Create edge from dependent to root (reverse direction)
    const depNode = depNodes.find(n => normalizePathCached(n.filePath) === normalizePathCached(dependentFilePath));
    if (depNode) {
      edges.push({
        from: depNode.id,
        to: rootNode.id,
        type: 'imports',
      });
    }
  }
  
  return { nodes, edges };
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
 * Groups nodes by module (directory) for module-level visualization.
 */
function groupByModule(nodes: GraphNode[], edges: GraphEdge[]): { moduleNodes: GraphNode[]; moduleEdges: GraphEdge[] } {
  const moduleMap = new Map<string, GraphNode>();
  const fileToModule = new Map<string, string>();
  
  // Group files by their directory (module)
  for (const node of nodes) {
    const dir = node.filePath.split('/').slice(0, -1).join('/') || '.';
    fileToModule.set(node.id, dir);
    
    if (!moduleMap.has(dir)) {
      moduleMap.set(dir, {
        id: nodeIdFromPath(dir),
        label: dir || 'root',
        type: 'module',
        filePath: dir,
      });
    }
  }
  
  // Create module-level edges from file-level edges
  const moduleEdges: GraphEdge[] = [];
  const moduleEdgeSet = new Set<string>();
  
  for (const edge of edges) {
    const fromModule = fileToModule.get(edge.from);
    const toModule = fileToModule.get(edge.to);
    
    if (fromModule && toModule && fromModule !== toModule) {
      const fromModuleNode = moduleMap.get(fromModule);
      const toModuleNode = moduleMap.get(toModule);
      
      if (fromModuleNode && toModuleNode) {
        const edgeKey = `${fromModuleNode.id}->${toModuleNode.id}`;
        if (!moduleEdgeSet.has(edgeKey)) {
          moduleEdgeSet.add(edgeKey);
          moduleEdges.push({
            from: fromModuleNode.id,
            to: toModuleNode.id,
            type: edge.type,
          });
        }
      }
    }
  }
  
  return {
    moduleNodes: Array.from(moduleMap.values()),
    moduleEdges,
  };
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
   * Generate a dependency graph starting from root file(s).
   */
  async generateGraph(options: GraphOptions): Promise<CodeGraph> {
    const {
      rootFile,
      rootFiles,
      depth,
      direction = 'forward',
      includeTests = false,
      includeComplexity = false,
      moduleLevel = false,
    } = options;
    
    // Determine root files
    const roots = rootFiles || (rootFile ? [rootFile] : []);
    if (roots.length === 0) {
      throw new Error('Either rootFile or rootFiles must be provided');
    }
    
    // Create cached path normalizer
    const normalizePathCached = createPathNormalizer(this.workspaceRoot);
    
    // Build import index for efficient lookup
    const importIndex = buildImportIndex(this.allChunks, normalizePathCached);
    
    // Collect all nodes and edges from all roots
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const visited = new Set<string>();
    
    for (const root of roots) {
      if (direction === 'forward' || direction === 'both') {
        const { nodes, edges } = traverseDependencies(
          root,
          depth,
          new Set(visited), // Share visited set across roots
          importIndex,
          this.allChunks,
          this.workspaceRoot,
          includeTests,
          includeComplexity,
          normalizePathCached
        );
        allNodes.push(...nodes);
        allEdges.push(...edges);
        visited.add(normalizePathCached(root));
      }
      
      if (direction === 'reverse' || direction === 'both') {
        const { nodes, edges } = traverseReverseDependencies(
          root,
          depth,
          new Set(visited), // Share visited set across roots
          importIndex,
          this.allChunks,
          this.workspaceRoot,
          includeTests,
          includeComplexity,
          normalizePathCached
        );
        allNodes.push(...nodes);
        allEdges.push(...edges);
        visited.add(normalizePathCached(root));
      }
    }
    
    // Deduplicate nodes (same file might appear multiple times in traversal)
    const nodeMap = new Map<string, GraphNode>();
    for (const node of allNodes) {
      const existing = nodeMap.get(node.id);
      if (!existing || (node.complexity && !existing.complexity)) {
        nodeMap.set(node.id, node);
      }
    }
    
    // Deduplicate edges
    const edgeSet = new Set<string>();
    const uniqueEdges: GraphEdge[] = [];
    for (const edge of allEdges) {
      const edgeKey = `${edge.from}->${edge.to}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        uniqueEdges.push(edge);
      }
    }
    
    let finalNodes = Array.from(nodeMap.values());
    let finalEdges = uniqueEdges;
    
    // Apply module-level grouping if requested
    if (moduleLevel) {
      const { moduleNodes, moduleEdges: modEdges } = groupByModule(finalNodes, finalEdges);
      finalNodes = moduleNodes;
      finalEdges = modEdges;
    }
    
    return {
      nodes: finalNodes,
      edges: finalEdges,
      rootFile: roots.length === 1 ? roots[0] : undefined,
      rootFiles: roots.length > 1 ? roots : undefined,
      depth,
      direction,
      moduleLevel,
    };
  }
}

