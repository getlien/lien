export interface CodeChunk {
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  file: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block';
  language: string;
  // Extracted symbols for direct querying
  symbols?: {
    functions: string[];
    classes: string[];
    interfaces: string[];
  };
}

export interface ScanOptions {
  rootDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

