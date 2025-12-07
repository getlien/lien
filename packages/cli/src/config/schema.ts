import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_PORT,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  DEFAULT_DEBOUNCE_MS,
  CURRENT_CONFIG_VERSION,
} from '../constants.js';

/**
 * Framework-specific configuration
 */
export interface FrameworkConfig {
  include: string[];     // File patterns relative to framework path
  exclude: string[];     // Exclude patterns relative to framework path
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
  chunking: {
    useAST: boolean;          // Enable AST-based chunking (v0.13.0)
    astFallback: 'line-based' | 'error';  // Fallback strategy on AST errors
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
  complexity?: {
    enabled: boolean;
    thresholds: {
      method: number;           // Cyclomatic complexity threshold (default: 15)
      cognitive: number;        // Cognitive complexity threshold (default: 15)
      halsteadEffort?: number;  // Halstead effort threshold (default: 1000000)
      halsteadDifficulty?: number; // Halstead difficulty threshold (default: 50)
      file: number;             // File-level complexity (default: 50)
      average: number;          // Average complexity (default: 6)
    };
    severity: {
      warning: number;     // Multiplier for warning threshold (default: 1.0)
      error: number;       // Multiplier for error threshold (default: 2.0)
    };
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
 * Type guard to check if a config is the legacy format
 * @param config - Config object to check
 * @returns True if config is LegacyLienConfig
 */
export function isLegacyConfig(
  config: LienConfig | LegacyLienConfig
): config is LegacyLienConfig {
  return 'indexing' in config && !('frameworks' in config);
}

/**
 * Type guard to check if a config is the modern format
 * @param config - Config object to check
 * @returns True if config is LienConfig
 */
export function isModernConfig(
  config: LienConfig | LegacyLienConfig
): config is LienConfig {
  return 'frameworks' in config;
}

/**
 * Default configuration with empty frameworks array
 * Frameworks should be detected and added via lien init
 */
export const defaultConfig: LienConfig = {
  version: CURRENT_CONFIG_VERSION,
  core: {
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    concurrency: DEFAULT_CONCURRENCY,
    embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
  },
  chunking: {
    useAST: true,              // AST-based chunking enabled by default (v0.13.0)
    astFallback: 'line-based', // Fallback to line-based on errors
  },
  mcp: {
    port: DEFAULT_PORT,
    transport: 'stdio',
    autoIndexOnFirstRun: true,
  },
  gitDetection: {
    enabled: true,
    pollIntervalMs: DEFAULT_GIT_POLL_INTERVAL_MS,
  },
  fileWatching: {
    enabled: true, // Enabled by default (fast with incremental indexing!)
    debounceMs: DEFAULT_DEBOUNCE_MS,
  },
  complexity: {
    enabled: true,
    thresholds: {
      method: 15,            // Cyclomatic complexity threshold
      cognitive: 15,         // Cognitive complexity threshold (SonarQube default)
      halsteadEffort: 300000,    // P99 - catches top 1% most complex functions
      halsteadDifficulty: 30,    // P90 - catches top 10% error-prone functions
      file: 50,
      average: 6,
    },
    severity: {
      warning: 1.0,
      error: 2.0,
    },
  },
  frameworks: [], // Will be populated by lien init via framework detection
};

