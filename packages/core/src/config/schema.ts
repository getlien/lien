import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CONCURRENCY,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_PORT,
  DEFAULT_GIT_POLL_INTERVAL_MS,
  DEFAULT_DEBOUNCE_MS,
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
      testPaths: number;             // 🔀 Max test paths per function (default: 15)
      mentalLoad: number;            // 🧠 Max mental load score (default: 15)
      timeToUnderstandMinutes?: number;  // ⏱️ Max minutes to understand (default: 60)
      estimatedBugs?: number;            // 🐛 Max estimated bugs (default: 1.5)
    };
    // Severity multipliers are hardcoded: warning = 1x threshold, error = 2x threshold
  };
  storage?: {
    backend?: 'lancedb' | 'qdrant';
    qdrant?: {
      url: string;        // e.g., "http://localhost:6333"
      apiKey?: string;    // Optional, required for Qdrant Cloud
      orgId: string;      // Organization identifier for multi-tenant isolation
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
      testPaths: 15,            // 🔀 Max test paths per function
      mentalLoad: 15,           // 🧠 Max mental load score
      timeToUnderstandMinutes: 60,  // ⏱️ Functions taking >1 hour to understand
      estimatedBugs: 1.5,           // 🐛 Functions estimated to have >1.5 bugs
    },
  },
  storage: undefined, // Defaults to LanceDB (backward compatible)
  frameworks: [], // Will be populated by lien init via framework detection
};

