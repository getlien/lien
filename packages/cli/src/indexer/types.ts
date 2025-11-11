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
}

export interface ScanOptions {
  rootDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

