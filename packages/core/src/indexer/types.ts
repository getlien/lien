export interface CodeChunk {
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  file: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block' | 'template';
  language: string;
  // Extracted symbols for direct querying
  symbols?: {
    functions: string[];
    classes: string[];
    interfaces: string[];
  };

  // NEW: AST-derived metadata (v0.13.0)
  symbolName?: string; // Function/class name
  symbolType?:
    | 'function'
    | 'method'
    | 'class'
    | 'interface'
    | 'schema'
    | 'style'
    | 'javascript'
    | 'template';
  parentClass?: string; // For methods
  complexity?: number; // Cyclomatic complexity
  cognitiveComplexity?: number; // Cognitive complexity (penalizes nesting)
  parameters?: string[]; // Function parameters
  signature?: string; // Full signature
  returnType?: string; // Return type (e.g. 'void', 'string', 'Promise<void>')
  imports?: string[]; // File imports (for context)

  // Symbol-level dependency tracking (v0.23.0)
  /**
   * Symbols exported by this file. Extracted from export statements.
   * Example: ['validateEmail', 'validatePhone', 'ValidationError']
   */
  exports?: string[];

  /**
   * Map of import paths to the symbols imported from them.
   * Example: { './validate': ['validateEmail', 'validatePhone'] }
   */
  importedSymbols?: Record<string, string[]>;

  /**
   * Call sites within this chunk - symbols called and their locations.
   * Tracked for chunks whose symbolType supports complexity analysis (e.g. functions and methods).
   */
  callSites?: Array<{
    symbol: string; // The called symbol name
    line: number; // Line number of the call
  }>;

  // Halstead metrics (v0.19.0)
  halsteadVolume?: number; // V = N × log₂(n) - size of implementation
  halsteadDifficulty?: number; // D = (n1/2) × (N2/n2) - error-proneness
  halsteadEffort?: number; // E = D × V - mental effort required
  halsteadBugs?: number; // B = V / 3000 - estimated delivered bugs

  // Multi-tenant fields (optional for backward compatibility)
  /**
   * Unique repository identifier for multi-tenant scenarios.
   * Used for cross-repo search and tenant isolation in Qdrant backend.
   * Typically derived from project root path or GitHub repository identifier.
   */
  repoId?: string;

  /**
   * Organization identifier for multi-tenant scenarios.
   * Used for tenant isolation in Qdrant backend.
   * Set from config.storage.qdrant.orgId when using Qdrant backend.
   */
  orgId?: string;

  /**
   * Git branch name for branch/commit tracking in Qdrant backend.
   * Used to isolate indexes by branch (e.g., main vs PR branches).
   */
  branch?: string;

  /**
   * Git commit SHA for branch/commit tracking in Qdrant backend.
   * Used to isolate indexes by commit (e.g., for PR analysis).
   */
  commitSha?: string;
}

export interface ScanOptions {
  rootDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}
