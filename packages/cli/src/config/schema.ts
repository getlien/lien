/**
 * Framework-specific test pattern configuration
 */
export interface TestPatternConfig {
  directories: string[];
  extensions: string[];
  prefixes: string[];
  suffixes: string[];
  frameworks: string[];
}

/**
 * Framework-specific configuration
 */
export interface FrameworkConfig {
  include: string[];     // File patterns relative to framework path
  exclude: string[];     // Exclude patterns relative to framework path
  testPatterns: TestPatternConfig;
}

/**
 * Framework instance in a monorepo
 */
export interface FrameworkInstance {
  name: string;          // 'nodejs', 'laravel'
  path: string;          // '.', 'cognito-backend', 'packages/cli'
  enabled: boolean;
  config: FrameworkConfig;
}

/**
 * Main Lien configuration supporting monorepo setups
 */
export interface LienConfig {
  version: string;
  core: {
    chunkSize: number;
    chunkOverlap: number;
    concurrency: number;
    embeddingBatchSize: number;
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
  frameworks: FrameworkInstance[];
}

/**
 * Legacy config format for backwards compatibility
 * @deprecated Use LienConfig with frameworks array instead
 */
export interface LegacyLienConfig {
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

/**
 * Default configuration with empty frameworks array
 * Frameworks should be detected and added via lien init
 */
export const defaultConfig: LienConfig = {
  version: '0.3.0',
  core: {
    chunkSize: 75,
    chunkOverlap: 10,
    concurrency: 4,
    embeddingBatchSize: 50,
  },
  mcp: {
    port: 7133, // LIEN in leetspeak
    transport: 'stdio',
    autoIndexOnFirstRun: true,
  },
  gitDetection: {
    enabled: true,
    pollIntervalMs: 10000, // Check every 10 seconds
  },
  fileWatching: {
    enabled: false, // Opt-in feature
    debounceMs: 1000,
  },
  frameworks: [], // Will be populated by lien init via framework detection
};

