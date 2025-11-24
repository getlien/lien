import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { needsMigration, migrateConfig, migrateConfigFile } from './migration.js';
import { LegacyLienConfig, LienConfig } from './schema.js';

describe('Config Migration', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-migration-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('needsMigration', () => {
    it('should return true for v0.2.0 config with indexing field', () => {
      const oldConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: ['node_modules'],
        },
      };

      expect(needsMigration(oldConfig)).toBe(true);
    });

    it('should return true for config without frameworks field', () => {
      const oldConfig = {
        indexing: {
          include: ['**/*.ts'],
        },
      };

      expect(needsMigration(oldConfig)).toBe(true);
    });

    it('should return false for v0.3.0 config with frameworks', () => {
      const newConfig = {
        version: '0.3.0',
        frameworks: [],
      };

      expect(needsMigration(newConfig)).toBe(false);
    });

    it('should return false for config with empty frameworks array', () => {
      const newConfig = {
        frameworks: [],
      };

      expect(needsMigration(newConfig)).toBe(false);
    });

    it('should return false for null or undefined config', () => {
      expect(needsMigration(null)).toBe(false);
      expect(needsMigration(undefined)).toBe(false);
    });

    it('should return true for v0.2.x versions', () => {
      const oldConfig = {
        version: '0.2.5',
        indexing: {},
      };

      expect(needsMigration(oldConfig)).toBe(true);
    });
  });

  describe('migrateConfig', () => {
    it('should migrate complete v0.2.0 config to v0.3.0', () => {
      const oldConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts', '**/*.js'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          chunkSize: 100,
          chunkOverlap: 20,
          concurrency: 8,
          embeddingBatchSize: 100,
        },
        mcp: {
          port: 8080,
          transport: 'socket',
          autoIndexOnFirstRun: false,
        },
        gitDetection: {
          enabled: false,
          pollIntervalMs: 5000,
        },
        fileWatching: {
          enabled: true,
          debounceMs: 500,
        },
      };

      const newConfig = migrateConfig(oldConfig);

      // Check version updated
      expect(newConfig.version).toBe('0.3.0');

      // Check core settings migrated
      expect(newConfig.core.chunkSize).toBe(100);
      expect(newConfig.core.chunkOverlap).toBe(20);
      expect(newConfig.core.concurrency).toBe(8);
      expect(newConfig.core.embeddingBatchSize).toBe(100);

      // Check MCP settings preserved
      expect(newConfig.mcp.port).toBe(8080);
      expect(newConfig.mcp.transport).toBe('socket');
      expect(newConfig.mcp.autoIndexOnFirstRun).toBe(false);

      // Check git detection settings preserved
      expect(newConfig.gitDetection.enabled).toBe(false);
      expect(newConfig.gitDetection.pollIntervalMs).toBe(5000);

      // Check file watching settings preserved
      expect(newConfig.fileWatching.enabled).toBe(true);
      expect(newConfig.fileWatching.debounceMs).toBe(500);

      // Check frameworks array created
      expect(newConfig.frameworks).toHaveLength(1);
      expect(newConfig.frameworks[0].name).toBe('generic');
      expect(newConfig.frameworks[0].path).toBe('.');
      expect(newConfig.frameworks[0].enabled).toBe(true);

      // Check framework config migrated
      expect(newConfig.frameworks[0].config.include).toEqual(['**/*.ts', '**/*.js']);
      expect(newConfig.frameworks[0].config.exclude).toEqual([
        '**/node_modules/**',
        '**/dist/**',
      ]);
    });

    it('should handle partial config with missing fields', () => {
      const oldConfig: Partial<LegacyLienConfig> = {
        indexing: {
          include: ['**/*.py'],
          exclude: [],
          chunkSize: 50,
          chunkOverlap: 5,
          concurrency: 2,
          embeddingBatchSize: 25,
        },
      };

      const newConfig = migrateConfig(oldConfig);

      expect(newConfig.version).toBe('0.3.0');
      expect(newConfig.core.chunkSize).toBe(50);
      expect(newConfig.frameworks).toHaveLength(1);
      expect(newConfig.frameworks[0].config.include).toEqual(['**/*.py']);
    });

    it('should handle empty config object', () => {
      const oldConfig: Partial<LegacyLienConfig> = {};

      const newConfig = migrateConfig(oldConfig);

      expect(newConfig.version).toBe('0.3.0');
      expect(newConfig.frameworks).toHaveLength(1);
      expect(newConfig.frameworks[0].name).toBe('generic');
      
      // Should use default values
      expect(newConfig.core.chunkSize).toBe(75); // default
      expect(newConfig.frameworks[0].config.include).toContain('**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs}');
    });

    it('should preserve custom include/exclude patterns', () => {
      const oldConfig: Partial<LegacyLienConfig> = {
        indexing: {
          include: ['src/**/*.ts', 'lib/**/*.js', 'app/**/*.tsx'],
          exclude: ['**/*.d.ts', '**/generated/**', '**/*.min.js'],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };

      const newConfig = migrateConfig(oldConfig);

      expect(newConfig.frameworks[0].config.include).toEqual([
        'src/**/*.ts',
        'lib/**/*.js',
        'app/**/*.tsx',
      ]);
      expect(newConfig.frameworks[0].config.exclude).toEqual([
        '**/*.d.ts',
        '**/generated/**',
        '**/*.min.js',
      ]);
    });

    it('should preserve exclude patterns during migration', () => {
      const oldConfigWithTests: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: [
            'node_modules/**',
            'dist/**',
          ],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };
      
      const migrated = migrateConfig(oldConfigWithTests);
      
      // Non-test patterns should be preserved
      expect(migrated.frameworks[0].config.exclude).toContain('node_modules/**');
      expect(migrated.frameworks[0].config.exclude).toContain('dist/**');
    });
  });

  describe('migrateConfigFile', () => {
    it('should migrate config file and create backup', async () => {
      const configPath = path.join(tempDir, '.lien.config.json');
      const oldConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: ['node_modules'],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };

      // Write old config
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));

      // Perform migration
      const result = await migrateConfigFile(tempDir);

      expect(result.migrated).toBe(true);
      expect(result.backupPath).toBe(`${configPath}.v0.2.0.backup`);

      // Verify backup exists
      const backupExists = await fs.access(result.backupPath!).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);

      // Verify backup content matches original
      const backupContent = await fs.readFile(result.backupPath!, 'utf-8');
      expect(JSON.parse(backupContent)).toEqual(oldConfig);

      // Verify new config is migrated
      const newConfigContent = await fs.readFile(configPath, 'utf-8');
      const newConfig = JSON.parse(newConfigContent);
      expect(newConfig.version).toBe('0.3.0');
      expect(newConfig.frameworks).toHaveLength(1);
    });

    it('should not migrate already migrated config', async () => {
      const configPath = path.join(tempDir, '.lien.config.json');
      const newConfig: LienConfig = {
        version: '0.14.0',
        core: {
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
        chunking: {
          useAST: true,
          astFallback: 'line-based',
        },
        mcp: {
          port: 7133,
          transport: 'stdio',
          autoIndexOnFirstRun: true,
        },
        gitDetection: {
          enabled: true,
          pollIntervalMs: 10000,
        },
        fileWatching: {
          enabled: false,
          debounceMs: 1000,
        },
        frameworks: [],
      };

      // Write new config
      await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));

      // Attempt migration
      const result = await migrateConfigFile(tempDir);

      expect(result.migrated).toBe(false);
      expect(result.backupPath).toBeUndefined();

      // Verify no backup created
      const backupPath = `${configPath}.v0.2.0.backup`;
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(backupExists).toBe(false);
    });

    it('should return default config if file does not exist', async () => {
      const result = await migrateConfigFile(tempDir);

      expect(result.migrated).toBe(false);
      expect(result.config.version).toBe('0.3.0');
      expect(result.config.frameworks).toEqual([]);
    });

    it('should preserve all user customizations during migration', async () => {
      const configPath = path.join(tempDir, '.lien.config.json');
      const oldConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['custom/**/*.ts', 'src/**/*.js'],
          exclude: ['**/custom-exclude/**', '**/temp/**'],
          chunkSize: 150,
          chunkOverlap: 30,
          concurrency: 16,
          embeddingBatchSize: 200,
        },
        mcp: {
          port: 9999,
          transport: 'socket',
          autoIndexOnFirstRun: false,
        },
        gitDetection: {
          enabled: false,
          pollIntervalMs: 20000,
        },
        fileWatching: {
          enabled: true,
          debounceMs: 2000,
        },
      };

      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));

      const result = await migrateConfigFile(tempDir);

      // Verify all customizations preserved
      expect(result.config.core.chunkSize).toBe(150);
      expect(result.config.core.chunkOverlap).toBe(30);
      expect(result.config.core.concurrency).toBe(16);
      expect(result.config.core.embeddingBatchSize).toBe(200);
      
      expect(result.config.mcp.port).toBe(9999);
      expect(result.config.mcp.transport).toBe('socket');
      expect(result.config.mcp.autoIndexOnFirstRun).toBe(false);
      
      expect(result.config.gitDetection.enabled).toBe(false);
      expect(result.config.gitDetection.pollIntervalMs).toBe(20000);
      
      expect(result.config.fileWatching.enabled).toBe(true);
      expect(result.config.fileWatching.debounceMs).toBe(2000);
      
      expect(result.config.frameworks[0].config.include).toEqual(['custom/**/*.ts', 'src/**/*.js']);
      expect(result.config.frameworks[0].config.exclude).toEqual(['**/custom-exclude/**', '**/temp/**']);
    });
  });
});

