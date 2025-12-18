/**
 * Impact analysis module for code graph integration
 * 
 * Generates reverse dependency graphs to show what depends on changed files,
 * calculates impact levels, and formats graphs for inclusion in review prompts.
 */

import type { SearchResult, CodeGraph } from '@liendev/core';
import { CodeGraphGenerator, AsciiGraphRenderer } from '@liendev/core';

/**
 * Impact analysis result for a single file
 */
export interface ImpactAnalysis {
  filepath: string;
  graph: CodeGraph;
  directDependents: number;
  transitiveDependents: number;
  totalDependents: number;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  moduleLevel: boolean;
  asciiTree: string;
}

/**
 * Determine if a filepath should use module-level view
 * (auto-detect: if path has no file extension, it's a directory)
 */
function shouldUseModuleLevel(filepath: string): boolean {
  // Check if path has a file extension
  // Common code file extensions
  const codeExtensions = /\.(ts|tsx|js|jsx|py|php|go|rs|java|rb|cs|swift|kt|scala|clj|hs|ml|elm|ex|exs|erl|hrl|vim|lua|r|R|m|mm|pl|pm|sh|bash|zsh|fish|ps1|bat|cmd|sql|graphql|gql|yaml|yml|json|xml|html|css|scss|sass|less|vue|svelte|astro|md|markdown|txt|rst|org|tex|bib|rtex|sty|cls|dtx|ins|ltx)$/i;
  
  return !codeExtensions.test(filepath);
}

/**
 * Calculate impact level based on dependent count
 */
export function calculateImpactLevel(
  directCount: number,
  transitiveCount: number
): 'low' | 'medium' | 'high' | 'critical' {
  const total = directCount + transitiveCount;
  
  if (total === 0) return 'low';
  if (total <= 5) return 'low';
  if (total <= 15) return 'medium';
  if (total <= 30) return 'high';
  return 'critical';
}

/**
 * Count direct vs transitive dependents from graph
 */
function countDependents(graph: CodeGraph): {
  direct: number;
  transitive: number;
} {
  if (graph.nodes.length === 0) {
    return { direct: 0, transitive: 0 };
  }
  
  // For reverse graphs, root nodes are the changed files
  // Direct dependents are nodes with edges directly from root
  // Transitive dependents are nodes further down the chain
  
  const rootIds = new Set<string>();
  if (graph.rootFile) {
    const rootNode = graph.nodes.find(n => n.filePath === graph.rootFile);
    if (rootNode) rootIds.add(rootNode.id);
  } else if (graph.rootFiles) {
    for (const rootFile of graph.rootFiles) {
      const rootNode = graph.nodes.find(n => n.filePath === rootFile);
      if (rootNode) rootIds.add(rootNode.id);
    }
  }
  
  // If no explicit roots, use nodes with no incoming edges
  if (rootIds.size === 0) {
    const nodesWithIncoming = new Set<string>();
    for (const edge of graph.edges) {
      nodesWithIncoming.add(edge.to);
    }
    graph.nodes
      .filter(n => !nodesWithIncoming.has(n.id))
      .forEach(n => rootIds.add(n.id));
  }
  
  // Build adjacency list (what depends on what)
  const dependents = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    // In reverse mode: edge.from = dependent, edge.to = root
    // We want to know: what depends on root?
    const rootId = edge.to;
    const dependentId = edge.from;
    
    if (rootIds.has(rootId)) {
      // This is a direct dependent
      if (!dependents.has(rootId)) {
        dependents.set(rootId, new Set());
      }
      dependents.get(rootId)!.add(dependentId);
    }
  }
  
  // Count direct dependents (first level)
  const directSet = new Set<string>();
  for (const dependentIds of dependents.values()) {
    dependentIds.forEach(id => directSet.add(id));
  }
  const direct = directSet.size;
  
  // Total nodes minus roots = all dependents (direct + transitive)
  const totalDependents = graph.nodes.length - rootIds.size;
  const transitive = Math.max(0, totalDependents - direct);
  
  return { direct, transitive };
}

/**
 * Generate impact graphs for changed files
 */
export async function analyzeImpact(
  files: string[],
  allChunks: SearchResult[],
  workspaceRoot: string,
  options: {
    enableImpactAnalysis?: boolean;
    impactAnalysisDepth?: number;
    moduleLevelAnalysis?: 'auto' | 'always' | 'never';
  } = {}
): Promise<ImpactAnalysis[]> {
  const {
    enableImpactAnalysis = true,
    impactAnalysisDepth,
    moduleLevelAnalysis = 'auto',
  } = options;
  
  if (!enableImpactAnalysis || files.length === 0) {
    return [];
  }
  
  const generator = new CodeGraphGenerator(allChunks, workspaceRoot);
  const renderer = new AsciiGraphRenderer();
  const analyses: ImpactAnalysis[] = [];
  
  // Generate graph for each file in parallel
  await Promise.all(
    files.map(async (filepath) => {
      try {
        // Determine if we should use module-level view
        let useModuleLevel = false;
        if (moduleLevelAnalysis === 'always') {
          useModuleLevel = true;
        } else if (moduleLevelAnalysis === 'never') {
          useModuleLevel = false;
        } else {
          // Auto-detect
          useModuleLevel = shouldUseModuleLevel(filepath);
        }
        
        // Generate reverse dependency graph
        const graph = await generator.generateGraph({
          rootFiles: [filepath],
          direction: 'reverse',
          moduleLevel: useModuleLevel,
          depth: impactAnalysisDepth,
        });
        
        // Count dependents
        const { direct, transitive } = countDependents(graph);
        const total = direct + transitive;
        
        // Calculate impact level
        const impactLevel = calculateImpactLevel(direct, transitive);
        
        // Render as ASCII tree
        const asciiTree = renderer.render(graph);
        
        analyses.push({
          filepath,
          graph,
          directDependents: direct,
          transitiveDependents: transitive,
          totalDependents: total,
          impactLevel,
          moduleLevel: useModuleLevel,
          asciiTree,
        });
      } catch (error) {
        // Log error but don't fail the entire analysis
        console.warn(`Failed to analyze impact for ${filepath}:`, error);
      }
    })
  );
  
  // Sort by impact level (critical first)
  const impactOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  analyses.sort((a, b) => {
    const levelDiff = impactOrder[a.impactLevel] - impactOrder[b.impactLevel];
    if (levelDiff !== 0) return levelDiff;
    return b.totalDependents - a.totalDependents;
  });
  
  return analyses;
}

/**
 * Format impact analysis for inclusion in prompts
 */
export function formatImpactAnalysisForPrompt(analyses: ImpactAnalysis[]): string {
  if (analyses.length === 0) {
    return '';
  }
  
  const sections = analyses.map((analysis) => {
    const impactEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    }[analysis.impactLevel];
    
    const levelLabel = analysis.impactLevel.toUpperCase();
    const moduleNote = analysis.moduleLevel ? ' (module-level view)' : '';
    
    return `### ${analysis.filepath}${moduleNote}
- **Impact Level**: ${impactEmoji} ${levelLabel}
- **Affected Files**: ${analysis.totalDependents} (${analysis.directDependents} direct + ${analysis.transitiveDependents} transitive)

**Dependency Tree:**
\`\`\`
${analysis.asciiTree}
\`\`\``;
  });
  
  return `## Impact Analysis

The following files have been changed. This section shows what other files depend on them (reverse dependencies).

${sections.join('\n\n')}

**Review Focus**: Changes to high-impact files (${analyses.filter(a => ['high', 'critical'].includes(a.impactLevel)).length} file(s)) require extra scrutiny as they affect many other parts of the codebase.`;
}

/**
 * Format impact analysis for review comments
 */
export function formatImpactAnalysisForComment(analyses: ImpactAnalysis[]): string {
  if (analyses.length === 0) {
    return '';
  }
  
  // Filter to only high/critical impact files
  const highImpact = analyses.filter(a => ['high', 'critical'].includes(a.impactLevel));
  
  if (highImpact.length === 0) {
    // Show summary for low/medium impact
    const totalAffected = analyses.reduce((sum, a) => sum + a.totalDependents, 0);
    if (totalAffected === 0) {
      return '';
    }
    return `## 🔗 Impact Analysis

**Low Impact**: Changes affect ${totalAffected} file(s) total.`;
  }
  
  const sections = highImpact.map((analysis) => {
    const impactEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    }[analysis.impactLevel];
    
    const levelLabel = analysis.impactLevel.toUpperCase();
    const moduleNote = analysis.moduleLevel ? ' (module-level)' : '';
    
    // Truncate tree if too long (keep first 30 lines)
    const treeLines = analysis.asciiTree.split('\n');
    const truncatedTree = treeLines.length > 30
      ? treeLines.slice(0, 30).join('\n') + '\n... (truncated)'
      : analysis.asciiTree;
    
    return `### ${analysis.filepath}${moduleNote}
- **Impact**: ${impactEmoji} ${levelLabel}
- **Affected**: ${analysis.totalDependents} files (${analysis.directDependents} direct + ${analysis.transitiveDependents} transitive)

\`\`\`
${truncatedTree}
\`\`\``;
  });
  
  return `## 🔗 Impact Analysis

**High Impact Changes Detected:**

${sections.join('\n\n')}

**Review Focus**: Changes to high-impact files affect many other parts of the codebase. Extra scrutiny recommended.`;
}

