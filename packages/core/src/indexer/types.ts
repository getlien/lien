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
  symbolName?: string;        // Function/class name
  symbolType?: 'function' | 'method' | 'class' | 'interface' | 'schema' | 'style' | 'javascript' | 'template';
  parentClass?: string;       // For methods
  complexity?: number;        // Cyclomatic complexity
  cognitiveComplexity?: number; // Cognitive complexity (penalizes nesting)
  parameters?: string[];      // Function parameters
  signature?: string;         // Full signature
  imports?: string[];         // File imports (for context)
  
  // Halstead metrics (v0.19.0)
  halsteadVolume?: number;      // V = N × log₂(n) - size of implementation
  halsteadDifficulty?: number;  // D = (n1/2) × (N2/n2) - error-proneness
  halsteadEffort?: number;      // E = D × V - mental effort required
  halsteadBugs?: number;        // B = V / 3000 - estimated delivered bugs
}

export interface ScanOptions {
  rootDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

