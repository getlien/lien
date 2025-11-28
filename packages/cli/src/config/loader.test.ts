import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { loadConfig, configExists } from './loader.js';
import { defaultConfig } from './schema.js';

describe('Config Loader', () => {
  let testDir: string;
  
  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(process.cwd(), '.test-config-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  describe('loadConfig', () => {
    it('should return default config when no config file exists', async () => {
      const config = await loadConfig(testDir);
      expect(config).toEqual(defaultConfig);
    });
    
    it('should load and merge user config with defaults', async () => {
      const userConfig = {
        version: '0.14.0',
        core: {
          chunkSize: 2000,
        },
        frameworks: [], // Explicitly include frameworks to avoid migration
        chunking: {
          useAST: true,
          astFallback: 'line-based',
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      expect(config.core.chunkSize).toBe(2000);
      expect(config.core.chunkOverlap).toBe(defaultConfig.core.chunkOverlap);
      expect(config.frameworks).toEqual(defaultConfig.frameworks);
    });
    
    it('should merge nested config properties correctly', async () => {
      const userConfig = {
        version: '0.3.0',
        core: {
          chunkSize: 3000,
        },
        frameworks: [
          {
            name: 'nodejs',
            path: '.',
            enabled: true,
            config: {
              include: ['**/*.ts'],
              exclude: ['custom-exclude/**'],
            },
          },
        ],
        fileWatching: {
          enabled: false,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      expect(config.frameworks[0].config.exclude).toEqual(['custom-exclude/**']);
      expect(config.core.chunkSize).toBe(3000);
      expect(config.core.chunkOverlap).toBe(defaultConfig.core.chunkOverlap);
      expect(config.fileWatching.enabled).toBe(false);
      expect(config.fileWatching.debounceMs).toBe(defaultConfig.fileWatching.debounceMs);
    });
    
    it('should throw error for invalid JSON', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      await expect(loadConfig(testDir)).rejects.toThrow();
    });
    
    it('should handle empty config file', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{}');
      
      const config = await loadConfig(testDir);
      // Empty config just merges with defaults - no migration needed
      expect(config.version).toBe('0.14.0');
      expect(config.frameworks).toEqual(defaultConfig.frameworks);
      expect(config.core).toEqual(defaultConfig.core);
    });
    
    it('should merge arrays correctly (replace, not concatenate)', async () => {
      const userConfig = {
        version: '0.3.0',
        frameworks: [
          {
            name: 'nodejs',
            path: '.',
            enabled: true,
            config: {
              include: ['src/**/*.ts'],
              exclude: [],
            },
          },
        ],
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      // Arrays should be replaced, not merged
      expect(config.frameworks[0].config.include).toEqual(['src/**/*.ts']);
    });
    
    it('should auto-migrate v0.2.0 config to v0.3.0', async () => {
      const oldConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: ['node_modules'],
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
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(oldConfig, null, 2));
      
      const config = await loadConfig(testDir);
      
      // Should be migrated to v0.3.0
      expect(config.version).toBe('0.14.0');
      expect(config.core.chunkSize).toBe(100);
      expect(config.core.chunkOverlap).toBe(20);
      expect(config.mcp.port).toBe(8080);
      expect(config.frameworks).toHaveLength(1);
      expect(config.frameworks[0].name).toBe('generic');
      expect(config.frameworks[0].config.include).toEqual(['**/*.ts']);
      
      // Verify backup was created
      const backupPath = `${configPath}.v0.2.0.backup`;
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });
  });
  
  describe('configExists', () => {
    it('should return false when config does not exist', async () => {
      const exists = await configExists(testDir);
      expect(exists).toBe(false);
    });
    
    it('should return true when config exists', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{}');
      
      const exists = await configExists(testDir);
      expect(exists).toBe(true);
    });
    
    it('should handle permission errors gracefully', async () => {
      // This test might be platform-specific, so we just ensure it doesn't throw
      const nonExistentDir = path.join(testDir, 'non-existent');
      const exists = await configExists(nonExistentDir);
      expect(exists).toBe(false);
    });
  });
});

