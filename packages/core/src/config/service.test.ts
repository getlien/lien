import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigService } from './service.js';
import type { LienConfig, LegacyLienConfig } from './schema.js';
import { defaultConfig } from './schema.js';
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
        mcp: {
          ...defaultConfig.mcp,
          port: 8080,
        },
        frameworks: [],
      };

      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));

      const config = await service.load(testDir);

      expect(config.mcp.port).toBe(8080);
      expect(config.core).toEqual(defaultConfig.core); // Should merge with defaults
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

      // Migration removed - just merges with defaults
      // Old indexing field is ignored, uses defaults
      expect(config.core).toEqual(defaultConfig.core);
    });
  });

  describe('retired config keys (graceful degradation)', () => {
    // Import a fresh module instance so the warn-once flags are reset per test
    async function freshConfigService() {
      vi.resetModules();
      const { ConfigService: FreshConfigService } = await import('./service.js');
      return new FreshConfigService();
    }

    // console.warn spies must not leak across tests, or a later test's spy
    // inherits an earlier test's call count (see global-config.test.ts precedent).
    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('concurrency', () => {
      it('should ignore core.concurrency and warn once instead of throwing', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(configPath, JSON.stringify({ core: { concurrency: 8 } }, null, 2));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const config = await freshService.load(testDir);

        expect(config.core).toEqual(defaultConfig.core);
        expect((config.core as Record<string, unknown>).concurrency).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"concurrency"'));
      });

      it('should ignore legacy indexing.concurrency and warn once instead of throwing', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(
          configPath,
          JSON.stringify({ indexing: { include: [], exclude: [], concurrency: 12 } }, null, 2),
        );
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const config = await freshService.load(testDir);

        // Legacy `indexing` is dropped entirely on merge (pre-existing behavior);
        // what matters here is that the retired key didn't throw, and was warned about.
        expect(config.core).toEqual(defaultConfig.core);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"concurrency"'));
      });

      it('should warn only once per process for repeated loads', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(configPath, JSON.stringify({ core: { concurrency: 16 } }, null, 2));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await freshService.load(testDir);
        await freshService.load(testDir);
        await freshService.load(testDir);

        expect(warnSpy).toHaveBeenCalledOnce();
      });
    });

    describe('chunkSize/chunkOverlap', () => {
      it('should ignore core.chunkSize/core.chunkOverlap and warn once instead of throwing', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(
          configPath,
          JSON.stringify({ core: { chunkSize: 100, chunkOverlap: 20 } }, null, 2),
        );
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const config = await freshService.load(testDir);

        expect(config.core).toEqual(defaultConfig.core);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"chunkSize"'));
      });

      it('should ignore legacy indexing.chunkSize/indexing.chunkOverlap and warn once instead of throwing', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(
          configPath,
          JSON.stringify(
            { indexing: { include: [], exclude: [], chunkSize: 90, chunkOverlap: 5 } },
            null,
            2,
          ),
        );
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const config = await freshService.load(testDir);

        expect(config.core).toEqual(defaultConfig.core);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"chunkSize"'));
      });

      it('should warn only once per process for repeated loads', async () => {
        const freshService = await freshConfigService();
        const configPath = path.join(testDir, '.lien.config.json');
        await fs.writeFile(
          configPath,
          JSON.stringify({ core: { chunkSize: 75, chunkOverlap: 10 } }, null, 2),
        );
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await freshService.load(testDir);
        await freshService.load(testDir);
        await freshService.load(testDir);

        expect(warnSpy).toHaveBeenCalledOnce();
      });
    });
  });

  describe('save', () => {
    it('should save valid config to file', async () => {
      const config: LienConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          port: 8080,
        },
      };

      await service.save(testDir, config);

      const configPath = path.join(testDir, '.lien.config.json');
      const savedContent = await fs.readFile(configPath, 'utf-8');
      const savedConfig = JSON.parse(savedContent);

      expect(savedConfig.mcp.port).toBe(8080);
    });

    it('should throw ConfigError when trying to save invalid config', async () => {
      const invalidConfig = {
        ...defaultConfig,
        mcp: {
          ...defaultConfig.mcp,
          port: 500, // Invalid: below 1024
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
      // Version field removed - no longer in config
      expect(content).toContain('"core"');
      expect(content.endsWith('\n')).toBe(true);
    });
  });

  // Migration tests removed - migration no longer exists

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
      // Version field removed - no longer validated
      const invalidConfig = { ...defaultConfig };
      delete (invalidConfig as any).core;

      const result = service.validate(invalidConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
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

    it('should warn about legacy config format', () => {
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts'],
          exclude: [],
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
    it('should reject invalid values in partial config', () => {
      const partialConfig: Partial<LienConfig> = {
        gitDetection: {
          enabled: true,
          pollIntervalMs: 50, // Invalid: must be at least 100ms
        },
      };

      const result = service.validatePartial(partialConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('pollIntervalMs'))).toBe(true);
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
      expect(loadedConfig.mcp.port).toBe(8000);
    });

    it('should handle migration workflow', async () => {
      // Create legacy config
      const legacyConfig: LegacyLienConfig = {
        version: '0.2.0',
        indexing: {
          include: ['**/*.ts', '**/*.js'],
          exclude: ['**/node_modules/**'],
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

      // Load config - migration removed, just merges with defaults
      const config = await service.load(testDir);

      // Migration removed - old indexing field ignored, uses defaults for core settings
      expect(config.core).toEqual(defaultConfig.core);
      expect(config.mcp.port).toBe(7200);
      expect(config.gitDetection.enabled).toBe(false);
      expect(config.fileWatching.enabled).toBe(true);
    });
  });
});
