/**
 * Node in the dependency graph
 */
export interface GraphNode {
  id: string;
  label: string;
  type: 'function' | 'class' | 'interface' | 'file' | 'module';
  filePath: string;
  lineNumber?: number;
  complexity?: number;
  dependencies?: string[];  // IDs of nodes this depends on
  dependents?: string[];    // IDs of nodes that depend on this
}

/**
 * Edge in the dependency graph
 */
export interface GraphEdge {
  from: string;  // Source node ID
  to: string;    // Target node ID
  type: 'imports' | 'extends' | 'implements' | 'uses' | 'calls';
}

/**
 * Complete code dependency graph
 */
export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootFile: string;
  depth: number;
}

/**
 * Options for graph generation
 */
export interface GraphOptions {
  rootFile: string;
  depth: number;
  includeTests?: boolean;
  includeComplexity?: boolean;
}

