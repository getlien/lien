import fs from 'fs/promises';
import path from 'path';
import { LienConfig, LegacyLienConfig, FrameworkInstance, defaultConfig } from './schema.js';
import { CURRENT_CONFIG_VERSION } from '../constants.js';

/**
 * Checks if a config object needs migration from v0.2.0 to v0.3.0
 */
export function needsMigration(config: any): boolean {
  // Check if config uses old structure:
  // - Has 'indexing' field instead of 'core' and 'frameworks'
  // - Or has no 'frameworks' field at all
  // - Or version is explicitly set to something < 0.3.0
  // - Or missing 'chunking' field (v0.13.0)
  if (!config) {
    return false;
  }

  // If missing chunking config, needs migration to v0.13.0
  if (config.frameworks !== undefined && !config.chunking) {
    return true;
  }

  // If it has frameworks array and chunking, it's already in new format
  if (config.frameworks !== undefined && config.chunking !== undefined) {
    return false;
  }

  // If it has 'indexing' field, it's the old format
  if (config.indexing !== undefined) {
    return true;
  }

  // If version is explicitly < 0.3.0
  if (config.version && config.version.startsWith('0.2')) {
    return true;
  }

  return false;
}

/**
 * Migrates a v0.2.0 config to v0.3.0+ format
 */
export function migrateConfig(oldConfig: Partial<LegacyLienConfig | LienConfig>): LienConfig {
  // Start with default config structure
  const newConfig: LienConfig = {
    version: CURRENT_CONFIG_VERSION,
    core: {
      chunkSize: (oldConfig as any).indexing?.chunkSize ?? (oldConfig as any).core?.chunkSize ?? defaultConfig.core.chunkSize,
      chunkOverlap: (oldConfig as any).indexing?.chunkOverlap ?? (oldConfig as any).core?.chunkOverlap ?? defaultConfig.core.chunkOverlap,
      concurrency: (oldConfig as any).indexing?.concurrency ?? (oldConfig as any).core?.concurrency ?? defaultConfig.core.concurrency,
      embeddingBatchSize: (oldConfig as any).indexing?.embeddingBatchSize ?? (oldConfig as any).core?.embeddingBatchSize ?? defaultConfig.core.embeddingBatchSize,
    },
    chunking: {
      useAST: (oldConfig as any).chunking?.useAST ?? defaultConfig.chunking.useAST,
      astFallback: (oldConfig as any).chunking?.astFallback ?? defaultConfig.chunking.astFallback,
    },
    mcp: {
      port: oldConfig.mcp?.port ?? defaultConfig.mcp.port,
      transport: oldConfig.mcp?.transport ?? defaultConfig.mcp.transport,
      autoIndexOnFirstRun: oldConfig.mcp?.autoIndexOnFirstRun ?? defaultConfig.mcp.autoIndexOnFirstRun,
    },
    gitDetection: {
      enabled: oldConfig.gitDetection?.enabled ?? defaultConfig.gitDetection.enabled,
      pollIntervalMs: oldConfig.gitDetection?.pollIntervalMs ?? defaultConfig.gitDetection.pollIntervalMs,
    },
    fileWatching: {
      enabled: oldConfig.fileWatching?.enabled ?? defaultConfig.fileWatching.enabled,
      debounceMs: oldConfig.fileWatching?.debounceMs ?? defaultConfig.fileWatching.debounceMs,
    },
    frameworks: (oldConfig as any).frameworks ?? [],
  };

  // Convert old indexing config to a single "generic" framework (only for legacy configs)
  if ((oldConfig as any).indexing && newConfig.frameworks.length === 0) {
    const genericFramework: FrameworkInstance = {
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: (oldConfig as any).indexing.include ?? ['**/*.{ts,tsx,js,jsx,py,php,go,rs,java,c,cpp,cs}'],
        exclude: (oldConfig as any).indexing.exclude ?? [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
          '**/coverage/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/vendor/**',
        ],
      },
    };

    newConfig.frameworks.push(genericFramework);
  } else if (newConfig.frameworks.length === 0) {
    // No indexing config and no frameworks present, use defaults for generic framework
    const genericFramework: FrameworkInstance = {
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: ['**/*.{ts,tsx,js,jsx,py,php,go,rs,java,c,cpp,cs}'],
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
          '**/coverage/**',
          '**/.next/**',
          '**/.nuxt/**',
          '**/vendor/**',
        ],
      },
    };

    newConfig.frameworks.push(genericFramework);
  }

  return newConfig;
}

/**
 * Migrates config file and creates backup
 */
export async function migrateConfigFile(rootDir: string = process.cwd()): Promise<{
  migrated: boolean;
  backupPath?: string;
  config: LienConfig;
}> {
  const configPath = path.join(rootDir, '.lien.config.json');

  try {
    // Read existing config
    const configContent = await fs.readFile(configPath, 'utf-8');
    const oldConfig = JSON.parse(configContent);

    // Check if migration is needed
    if (!needsMigration(oldConfig)) {
      return {
        migrated: false,
        config: oldConfig as LienConfig,
      };
    }

    // Perform migration
    const newConfig = migrateConfig(oldConfig);

    // Create backup
    const backupPath = `${configPath}.v0.2.0.backup`;
    await fs.copyFile(configPath, backupPath);

    // Write migrated config
    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2) + '\n', 'utf-8');

    return {
      migrated: true,
      backupPath,
      config: newConfig,
    };
  } catch (error) {
    // If config doesn't exist, return default
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        migrated: false,
        config: defaultConfig,
      };
    }
    throw error;
  }
}

