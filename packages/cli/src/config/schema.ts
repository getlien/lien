export interface LienConfig {
  version: string;
  indexing: {
    exclude: string[];
    include: string[];
    chunkSize: number;
    chunkOverlap: number;
    concurrency: number;
    embeddingBatchSize: number;
    indexTests: boolean;
    useImportAnalysis: boolean;
  };
  mcp: {
    port: number;
    transport: 'stdio' | 'socket';
    autoIndexOnFirstRun: boolean;
  };
  gitDetection: {
    enabled: boolean;
    pollIntervalMs: number;
  };
  fileWatching: {
    enabled: boolean;
    debounceMs: number;
  };
}

export const defaultConfig: LienConfig = {
  version: '0.1.0',
  indexing: {
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.next/**',
      '.nuxt/**',
      '*.min.js',
      '*.min.css',
    ],
    include: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.py',
      '**/*.php',
      '**/*.go',
      '**/*.rs',
      '**/*.java',
      '**/*.cpp',
      '**/*.c',
      '**/*.h',
      '**/*.rb',
      '**/*.swift',
      '**/*.kt',
      '**/*.cs',
      '**/*.scala',
    ],
    chunkSize: 75,
    chunkOverlap: 10,
    concurrency: 4,
    embeddingBatchSize: 50,
    indexTests: true,
    useImportAnalysis: true,
  },
  mcp: {
    port: 7133, // LIEN in leetspeak
    transport: 'stdio',
    autoIndexOnFirstRun: true, // Enabled by default
  },
  gitDetection: {
    enabled: true, // Enabled by default
    pollIntervalMs: 10000, // Check every 10 seconds
  },
  fileWatching: {
    enabled: false, // Opt-in feature
    debounceMs: 1000, // Wait 1 second after last change
  },
};

