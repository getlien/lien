import fs from 'fs/promises';
import path from 'path';
import { LienConfig, LegacyLienConfig, FrameworkInstance, defaultConfig } from './schema.js';

/**
 * Checks if a config object needs migration from v0.2.0 to v0.3.0
 */
export function needsMigration(config: any): boolean {
  // Check if config uses old structure:
  // - Has 'indexing' field instead of 'core' and 'frameworks'
  // - Or has no 'frameworks' field at all
  // - Or version is explicitly set to something < 0.3.0
  if (!config) {
    return false;
  }

  // If it has frameworks array, it's already in new format
  if (config.frameworks !== undefined) {
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
 * Migrates a v0.2.0 config to v0.3.0 format
 */
export function migrateConfig(oldConfig: Partial<LegacyLienConfig>): LienConfig {
  // Start with default config structure
  const newConfig: LienConfig = {
    version: '0.3.0',
    core: {
      chunkSize: oldConfig.indexing?.chunkSize ?? defaultConfig.core.chunkSize,
      chunkOverlap: oldConfig.indexing?.chunkOverlap ?? defaultConfig.core.chunkOverlap,
      concurrency: oldConfig.indexing?.concurrency ?? defaultConfig.core.concurrency,
      embeddingBatchSize: oldConfig.indexing?.embeddingBatchSize ?? defaultConfig.core.embeddingBatchSize,
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
    frameworks: [],
  };

  // Convert old indexing config to a single "generic" framework
  if (oldConfig.indexing) {
    const genericFramework: FrameworkInstance = {
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: oldConfig.indexing.include ?? ['**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs}'],
        exclude: oldConfig.indexing.exclude ?? [
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
  } else {
    // No indexing config present, use defaults for generic framework
    const genericFramework: FrameworkInstance = {
      name: 'generic',
      path: '.',
      enabled: true,
      config: {
        include: ['**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs}'],
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

