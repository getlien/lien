import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigService } from './service.js';
import type { LienConfig } from './schema.js';
import { defaultConfig } from './schema.js';
import { ConfigError } from '../errors/index.js';

describe('ConfigService', () => {
  let service: ConfigService;
  let testDir: string;

  beforeEach(async () => {
    service = new ConfigService();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-config-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('load', () => {
    it('should return default config when file does not exist', async () => {
      const config = await service.load(testDir);
      expect(config).toEqual(defaultConfig);
    });

    it('should load and merge complexity.thresholds with defaults', async () => {
      const userConfig: Partial<LienConfig> = {
        complexity: { thresholds: { testPaths: 20, mentalLoad: 20 } },
      };

      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(userConfig, null, 2));

      const config = await service.load(testDir);

      expect(config.complexity?.thresholds.testPaths).toBe(20);
      expect(config.complexity?.thresholds.mentalLoad).toBe(20);
      // Unspecified threshold keys still fall back to defaults
      expect(config.complexity?.thresholds.estimatedBugs).toBe(
        defaultConfig.complexity?.thresholds.estimatedBugs,
      );
    });

    it('should throw ConfigError for invalid JSON', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{ invalid json }');

      await expect(service.load(testDir)).rejects.toThrow(ConfigError);
      await expect(service.load(testDir)).rejects.toThrow('Invalid JSON syntax');
    });

    it('should return only defaults for an empty config file', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, '{}');

      const config = await service.load(testDir);

      expect(config).toEqual(defaultConfig);
    });
  });

  describe('retired config keys (graceful degradation)', () => {
    // Import a fresh module instance so the warn-once flags are reset per test.
    async function freshConfigService(): Promise<ConfigService> {
      vi.resetModules();
      const { ConfigService: FreshConfigService } = await import('./service.js');
      return new FreshConfigService();
    }

    // console.warn spies must not leak across tests, or a later test's spy
    // inherits an earlier test's call count (see global-config.test.ts precedent).
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function writeConfig(raw: unknown): Promise<string> {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(configPath, JSON.stringify(raw, null, 2));
      return configPath;
    }

    const RETIRED_TOP_LEVEL_CASES: Array<{
      name: string;
      raw: Record<string, unknown>;
      warningSubstring: string;
    }> = [
      { name: 'core', raw: { core: {} }, warningSubstring: '"core"' },
      {
        name: 'chunking',
        raw: { chunking: { useAST: false } },
        warningSubstring: '"chunking"',
      },
      {
        name: 'mcp',
        raw: { mcp: { port: 8080 } },
        warningSubstring: '"mcp"',
      },
      {
        name: 'gitDetection',
        raw: { gitDetection: { enabled: false } },
        warningSubstring: '"gitDetection"',
      },
      {
        name: 'fileWatching',
        raw: { fileWatching: { enabled: false } },
        warningSubstring: '"fileWatching"',
      },
      {
        name: 'storage',
        raw: { storage: { backend: 'sqlite' } },
        warningSubstring: '"storage"',
      },
      {
        name: 'frameworks',
        raw: { frameworks: [] },
        warningSubstring: '"frameworks"',
      },
      {
        name: 'legacy indexing/version shape',
        raw: { version: '0.2.0', indexing: { include: [], exclude: [] } },
        warningSubstring: 'legacy .lien.config.json format is no longer read',
      },
    ];

    it.each(RETIRED_TOP_LEVEL_CASES)(
      'ignores retired top-level "$name" and warns once instead of throwing',
      async ({ raw, warningSubstring }) => {
        const freshService = await freshConfigService();
        await writeConfig(raw);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const config = await freshService.load(testDir);

        expect(config.complexity).toEqual(defaultConfig.complexity);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(warningSubstring));
      },
    );

    it('ignores an unrecognized top-level key and warns generically instead of throwing', async () => {
      const freshService = await freshConfigService();
      await writeConfig({ notARealSection: { foo: 1 } });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await freshService.load(testDir);

      expect(config.complexity).toEqual(defaultConfig.complexity);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unrecognized top-level .lien.config.json key "notARealSection"'),
      );
    });

    it('ignores complexity.enabled and warns once instead of throwing', async () => {
      const freshService = await freshConfigService();
      await writeConfig({ complexity: { enabled: true, thresholds: { testPaths: 30 } } });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await freshService.load(testDir);

      expect(config.complexity?.thresholds.testPaths).toBe(30);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"complexity.enabled"'));
    });

    it('warns only once per process for repeated loads of the same retired section', async () => {
      const freshService = await freshConfigService();
      await writeConfig({ mcp: { port: 8080 } });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await freshService.load(testDir);
      await freshService.load(testDir);
      await freshService.load(testDir);

      const mcpWarnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('"mcp"'));
      expect(mcpWarnings).toHaveLength(1);
    });

    it('still applies real thresholds alongside a retired section in the same file', async () => {
      const freshService = await freshConfigService();
      await writeConfig({
        mcp: { port: 8080 },
        complexity: { thresholds: { mentalLoad: 3 } },
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await freshService.load(testDir);

      expect(config.complexity?.thresholds.mentalLoad).toBe(3);
    });
  });

  describe('validate', () => {
    it('should validate the default config', () => {
      const result = service.validate(defaultConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate an empty object (complexity is optional)', () => {
      const result = service.validate({});

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-object config', () => {
      const result = service.validate('not an object');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Configuration must be an object');
    });

    it('should reject a non-object complexity section', () => {
      const result = service.validate({ complexity: 'nope' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('complexity must be an object'))).toBe(true);
    });

    it('should reject a non-object complexity.thresholds', () => {
      const result = service.validate({ complexity: { thresholds: 'nope' } });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('complexity.thresholds must be an object'))).toBe(
        true,
      );
    });

    it('should warn (not error) about a stray top-level key on direct validate()', () => {
      // load() strips retired/unknown keys before validate() ever sees them;
      // direct validate() callers skip that strip, so this is the path where
      // a stray key can actually reach validation.
      const result = service.validate({ ...defaultConfig, mcp: { port: 8080 } });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('mcp'))).toBe(true);
    });

    it('should warn (not error) about complexity.enabled on direct validate()', () => {
      const result = service.validate({
        complexity: { enabled: true, thresholds: defaultConfig.complexity?.thresholds },
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('complexity.enabled'))).toBe(true);
    });
  });

  describe('integration', () => {
    it('should load a real .lien.config.json with only complexity.thresholds end-to-end', async () => {
      const configPath = path.join(testDir, '.lien.config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({ complexity: { thresholds: { testPaths: 7, mentalLoad: 7 } } }, null, 2),
      );

      const config = await service.load(testDir);
      const validation = service.validate(config);

      expect(validation.valid).toBe(true);
      expect(config.complexity?.thresholds.testPaths).toBe(7);
      expect(config.complexity?.thresholds.mentalLoad).toBe(7);
    });
  });
});
