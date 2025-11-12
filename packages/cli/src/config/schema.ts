export interface LienConfig {
  version: string;
  indexing: {
    exclude: string[];
    include: string[];
    chunkSize: number;
    chunkOverlap: number;
    concurrency: number;
    embeddingBatchSize: number;
  };
  mcp: {
    port: number;
    transport: 'stdio' | 'socket';
  };
}

export const defaultConfig: LienConfig = {
  version: '0.1.0',
  indexing: {
    exclude: [
      'node_modules/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test.js',
      '**/*.test.jsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.spec.js',
      '**/*.spec.jsx',
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
  },
  mcp: {
    port: 3000,
    transport: 'stdio',
  },
};

