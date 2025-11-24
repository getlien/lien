import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigService } from './service.js';
import { LienConfig, LegacyLienConfig, defaultConfig } from './schema.js';
import { ConfigError } from '../errors/index.js';

describe('ConfigService', () => {
  let service: ConfigService;
  let testDir: string;
  
  beforeEach(async () => {
    service = new ConfigService();
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-config-test-'));
  });
  
  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  describe('exists', () => {
    it('should return false when config does not exist', async () => {
      const exists = await service.exists(testDir);
      expect(exists).toBe(false);
    });
    
    it('should return true when config exists', async () => {
      // Create a config file
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      
      const exists = await service.exists(testDir);
      expect(exists).toBe(true);
    });
  });
  
  describe('load', () => {
    it('should return default config when file does not exist', async () => {
      const config = await service.load(testDir);
      expect(config).toEqual(defaultConfig);
    });
    
    it('should load and merge user config with defaults', async () => {
      const userConfig: Partial<LienConfig> = {
        version: '0.3.0',
        core: {
          chunkSize: 100,
          chunkOverlap: 20,
          concurrency: 8,
          embeddingBatchSize: 75,
        },
        frameworks: [],
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));
      
      const config = await service.load(testDir);
      
      expect(config.core.chunkSize).toBe(100);
      expect(config.core.chunkOverlap).toBe(20);
      expect(config.mcp).toEqual(defaultConfig.mcp); // Should merge with defaults
    });
    
    it('should throw ConfigError for invalid JSON', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');
      
      await expect(service.load(testDir)).rejects.toThrow(ConfigError);
      await expect(service.load(testDir)).rejects.toThrow('Invalid JSON syntax');
    });
    
    it('should automatically migrate v0.2.0 config', async () => {
      const legacyConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: ['**/node_modules/**'],
          chunkSize: 100,
          chunkOverlap: 15,
          concurrency: 6,
          embeddingBatchSize: 60,
        },
        mcp: {
          port: 7133,
          transport: 'stdio',
          autoIndexOnFirstRun: true,
        },
        gitDetection: {
          enabled: true,
          pollIntervalMs: 5000,
        },
        fileWatching: {
          enabled: false,
          debounceMs: 1000,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      const config = await service.load(testDir);
      
      // Should be migrated to v0.14.0
      expect(config.version).toBe('0.13.0');
      expect(config.frameworks).toBeDefined();
      expect(config.core.chunkSize).toBe(100);
      
      // Backup should be created
      const backupExists = await fs.access(configPath + '.v0.2.0.backup')
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);
    });
  });
  
  describe('save', () => {
    it('should save valid config to file', async () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 120,
        },
      };
      
      await service.save(testDir, config);
      
      const configPath = path.join(testDir, '.lien.config.json');
      const savedContent = await fs.readFile(configPath, 'utf-8');
      const savedConfig = JSON.parse(savedContent);
      
      expect(savedConfig.core.chunkSize).toBe(120);
    });
    
    it('should throw ConfigError when trying to save invalid config', async () => {
      const invalidConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: -10, // Invalid: must be positive
        },
      };
      
      await expect(service.save(testDir, invalidConfig)).rejects.toThrow(ConfigError);
      await expect(service.save(testDir, invalidConfig)).rejects.toThrow('invalid configuration');
    });
    
    it('should format JSON with proper indentation', async () => {
      await service.save(testDir, defaultConfig);
      
      const configPath = path.join(testDir, '.lien.config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      
      // Should be formatted with 2-space indentation
      expect(content).toContain('  "version"');
      expect(content.endsWith('\n')).toBe(true);
    });
  });
  
  describe('migrate', () => {
    it('should migrate v0.2.0 config to v0.3.0', async () => {
      const legacyConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.js'],
          exclude: ['**/dist/**'],
          chunkSize: 80,
          chunkOverlap: 12,
          concurrency: 5,
          embeddingBatchSize: 45,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      const result = await service.migrate(testDir);
      
      expect(result.migrated).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(result.config.version).toBe('0.13.0');
      expect(result.config.frameworks).toHaveLength(1);
      expect(result.config.frameworks[0].name).toBe('generic');
    });
    
    it('should not migrate already modern config', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      
      const result = await service.migrate(testDir);
      
      expect(result.migrated).toBe(false);
      expect(result.backupPath).toBeUndefined();
    });
    
    it('should return default config when file does not exist', async () => {
      const result = await service.migrate(testDir);
      
      expect(result.migrated).toBe(false);
      expect(result.config).toEqual(defaultConfig);
    });
    
    it('should create backup when migrating', async () => {
      const legacyConfig: Partial<LegacyLienConfig> = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.py'],
          exclude: [],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      const result = await service.migrate(testDir);
      
      // Verify backup was created with original content
      const backupContent = await fs.readFile(result.backupPath!, 'utf-8');
      const backupConfig = JSON.parse(backupContent);
      expect(backupConfig.version).toBe('0.2.0');
      expect(backupConfig.indexing).toBeDefined();
    });
  });
  
  describe('needsMigration', () => {
    it('should return true for v0.2.0 config with indexing field', () => {
      const legacyConfig = {
        version: '0.2.0',
        indexing: { include: [] },
      };
      
      expect(service.needsMigration(legacyConfig)).toBe(true);
    });
    
    it('should return false for v0.12.0 config with frameworks and chunking', () => {
      const modernConfig = {
        version: '0.12.0',
        frameworks: [],
        chunking: {
          useAST: true,
          astFallback: 'line-based',
        },
      };
      
      expect(service.needsMigration(modernConfig)).toBe(false);
    });
    
    it('should return false for null or undefined', () => {
      expect(service.needsMigration(null)).toBe(false);
      expect(service.needsMigration(undefined)).toBe(false);
    });
  });
  
  describe('validate', () => {
    it('should validate correct modern config', () => {
      const result = service.validate(defaultConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should reject non-object config', () => {
      const result = service.validate('not an object');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Configuration must be an object');
    });
    
    it('should reject config without version', () => {
      const invalidConfig = { ...defaultConfig };
      delete (invalidConfig as any).version;
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: version');
    });
    
    it('should reject invalid chunk size', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: -5,
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chunkSize'))).toBe(true);
    });
    
    it('should reject invalid concurrency', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          concurrency: 20, // Too high (max 16)
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('concurrency'))).toBe(true);
    });
    
    it('should reject invalid MCP port', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          port: 500, // Too low (min 1024)
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('port'))).toBe(true);
    });
    
    it('should reject invalid transport type', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          transport: 'invalid' as any,
        },
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('transport'))).toBe(true);
    });
    
    it('should warn about very small chunk size', () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 30, // Valid but small
        },
      };
      
      const result = service.validate(config);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('very small'))).toBe(true);
    });
    
    it('should warn about very large chunk size', () => {
      const config: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 600, // Valid but large
        },
      };
      
      const result = service.validate(config);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('very large'))).toBe(true);
    });
    
    it('should reject absolute framework path', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        frameworks: [{
          name: 'test',
          path: '/absolute/path', // Must be relative
          enabled: true,
          config: {
            include: [],
            exclude: [],
          },
        }],
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be relative'))).toBe(true);
    });
    
    it('should reject framework without required fields', () => {
      const invalidConfig: LienConfig = {
        ...defaultConfig,
        frameworks: [{
          name: 'test',
          // Missing path, enabled, config
        } as any],
      };
      
      const result = service.validate(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should warn about legacy config format', () => {
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: [],
          chunkSize: 75,
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
        mcp: {
          port: 7133,
          transport: 'stdio',
          autoIndexOnFirstRun: true,
        },
        gitDetection: {
          enabled: true,
          pollIntervalMs: 5000,
        },
        fileWatching: {
          enabled: false,
          debounceMs: 1000,
        },
      };
      
      const result = service.validate(legacyConfig);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('legacy'))).toBe(true);
    });
  });
  
  describe('validatePartial', () => {
    it('should validate partial config with only core settings', () => {
      const partialConfig: Partial<LienConfig> = {
        core: {
          chunkSize: 100,
          chunkOverlap: 15,
          concurrency: 6,
          embeddingBatchSize: 60,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should reject invalid values in partial config', () => {
      const partialConfig: Partial<LienConfig> = {
        core: {
          chunkSize: -10, // Invalid
          chunkOverlap: 10,
          concurrency: 4,
          embeddingBatchSize: 50,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('chunkSize'))).toBe(true);
    });
    
    it('should allow missing fields in partial config', () => {
      const partialConfig: Partial<LienConfig> = {
        mcp: {
          port: 8000,
          transport: 'stdio',
          autoIndexOnFirstRun: false,
        },
      };
      
      const result = service.validatePartial(partialConfig);
      
      expect(result.valid).toBe(true);
    });
  });
  
  describe('integration', () => {
    it('should handle full lifecycle: save, load, validate', async () => {
      const customConfig: LienConfig = {
        ...defaultConfig,
        core: {
          ...defaultConfig.core,
          chunkSize: 100,
        },
        mcp: {
          ...defaultConfig.mcp,
          port: 8000,
        },
      };
      
      // Save
      await service.save(testDir, customConfig);
      
      // Load
      const loadedConfig = await service.load(testDir);
      
      // Validate
      const validation = service.validate(loadedConfig);
      
      expect(validation.valid).toBe(true);
      expect(loadedConfig.core.chunkSize).toBe(100);
      expect(loadedConfig.mcp.port).toBe(8000);
    });
    
    it('should handle migration workflow', async () => {
      // Create legacy config
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts', '**/*.js'],
          exclude: ['**/node_modules/**'],
          chunkSize: 90,
          chunkOverlap: 12,
          concurrency: 6,
          embeddingBatchSize: 55,
        },
        mcp: {
          port: 7200,
          transport: 'stdio',
          autoIndexOnFirstRun: false,
        },
        gitDetection: {
          enabled: false,
          pollIntervalMs: 3000,
        },
        fileWatching: {
          enabled: true,
          debounceMs: 500,
        },
      };
      
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(legacyConfig, null, 2));
      
      // Load should auto-migrate
      const config = await service.load(testDir);
      
      expect(config.version).toBe('0.13.0');
      expect(config.frameworks).toBeDefined();
      expect(config.core.chunkSize).toBe(90);
      expect(config.mcp.port).toBe(7200);
      expect(config.gitDetection.enabled).toBe(false);
      expect(config.fileWatching.enabled).toBe(true);
      
      // Backup should exist
      const backupExists = await fs.access(configPath + '.v0.2.0.backup')
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);
    });
  });
});

