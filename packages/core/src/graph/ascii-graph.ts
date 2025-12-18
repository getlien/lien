import type { CodeGraph, GraphNode } from './types.js';

/**
 * Renders a code graph as an ASCII tree visualization.
 */
export class AsciiGraphRenderer {
  /**
   * Render the graph as an ASCII tree.
   */
  render(graph: CodeGraph): string {
    if (graph.nodes.length === 0) {
      return `(empty graph)`;
    }
    
    // Determine root nodes
    const rootNodes: GraphNode[] = [];
    if (graph.rootFile) {
      const rootNode = graph.nodes.find(n => n.filePath === graph.rootFile);
      if (rootNode) rootNodes.push(rootNode);
    } else if (graph.rootFiles && graph.rootFiles.length > 0) {
      for (const rootFile of graph.rootFiles) {
        const rootNode = graph.nodes.find(n => n.filePath === rootFile);
        if (rootNode) rootNodes.push(rootNode);
      }
    }
    
    // If no root nodes found, use all nodes with no incoming edges as roots
    if (rootNodes.length === 0) {
      const nodesWithIncoming = new Set<string>();
      for (const edge of graph.edges) {
        nodesWithIncoming.add(edge.to);
      }
      rootNodes.push(...graph.nodes.filter(n => !nodesWithIncoming.has(n.id)));
    }
    
    // If still no roots, just use first node
    if (rootNodes.length === 0 && graph.nodes.length > 0) {
      rootNodes.push(graph.nodes[0]);
    }
    
    // Build adjacency list (children of each node)
    const children = new Map<string, GraphNode[]>();
    for (const edge of graph.edges) {
      const parent = graph.nodes.find(n => n.id === edge.from);
      const child = graph.nodes.find(n => n.id === edge.to);
      if (parent && child) {
        const existing = children.get(parent.id) || [];
        existing.push(child);
        children.set(parent.id, existing);
      }
    }
    
    // Build the tree output
    const lines: string[] = [];
    
    // Add direction indicator
    if (graph.direction === 'reverse') {
      lines.push('(Reverse dependencies - what depends on the root file)');
      lines.push('');
    } else if (graph.direction === 'both') {
      lines.push('(Forward and reverse dependencies)');
      lines.push('');
    }
    
    // Render each root node
    for (let i = 0; i < rootNodes.length; i++) {
      const isLastRoot = i === rootNodes.length - 1;
      this.renderNode(rootNodes[i], children, lines, '', isLastRoot);
      if (!isLastRoot) {
        lines.push(''); // Add spacing between multiple roots
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Render a single node and its children recursively.
   */
  private renderNode(
    node: GraphNode,
    children: Map<string, GraphNode[]>,
    lines: string[],
    prefix: string,
    isLast: boolean
  ): void {
    // Format node label
    let label = node.filePath || node.label;
    
    // Add module indicator
    if (node.type === 'module') {
      label = `[module] ${label}`;
    }
    
    // Truncate if too long (max 60 chars)
    const maxLength = 60;
    if (label.length > maxLength) {
      label = '...' + label.slice(-(maxLength - 3));
    }
    
    // Add complexity if available
    if (node.complexity !== undefined) {
      label += ` (complexity: ${node.complexity})`;
    }
    
    // Add the node line
    const connector = isLast ? '└─' : '├─';
    lines.push(prefix + connector + ' ' + label);
    
    // Render children
    const nodeChildren = children.get(node.id) || [];
    if (nodeChildren.length > 0) {
      const childPrefix = prefix + (isLast ? '  ' : '│ ');
      for (let i = 0; i < nodeChildren.length; i++) {
        const isLastChild = i === nodeChildren.length - 1;
        this.renderNode(nodeChildren[i], children, lines, childPrefix, isLastChild);
      }
    }
  }
}

