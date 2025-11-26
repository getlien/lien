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
  symbolType?: 'function' | 'method' | 'class' | 'interface' | 'schema' | 'style' | 'javascript' | 'template' | 'block';
  parentClass?: string;       // For methods
  complexity?: number;        // Cyclomatic complexity
  parameters?: string[];      // Function parameters
  signature?: string;         // Full signature
  imports?: string[];         // File imports (for context)
}

export interface ScanOptions {
  rootDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

