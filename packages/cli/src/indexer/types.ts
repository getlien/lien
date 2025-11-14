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
  isTest?: boolean;
  relatedTests?: string[];
  relatedSources?: string[];
  testFramework?: string;
  detectionMethod?: 'convention' | 'import';
  // NEW: Extracted symbols for direct querying
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

export interface TestAssociation {
  file: string;
  isTest: boolean;
  relatedTests?: string[];
  relatedSources?: string[];
  testFramework?: string;
  detectionMethod: 'convention' | 'import';
}

