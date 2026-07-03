import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configSetCommand, configGetCommand, configListCommand } from './config.js';

// Mock @liendev/core
vi.mock('@liendev/core', () => ({
  loadGlobalConfig: vi.fn(),
  mergeGlobalConfig: vi.fn(),
  configService: {
    load: vi.fn(),
    save: vi.fn(),
  },
}));

import { loadGlobalConfig, mergeGlobalConfig, configService } from '@liendev/core';
import type { LienConfig } from '@liendev/core';

const mockLoadGlobalConfig = vi.mocked(loadGlobalConfig);
const mockMergeGlobalConfig = vi.mocked(mergeGlobalConfig);
const mockConfigServiceLoad = vi.mocked(configService.load);
const mockConfigServiceSave = vi.mocked(configService.save);

const baseProjectConfig: LienConfig = {
  core: { chunkSize: 200, chunkOverlap: 20, concurrency: 4, embeddingBatchSize: 32 },
  chunking: { useAST: true, astFallback: 'line-based' },
  mcp: { port: 7133, transport: 'stdio', autoIndexOnFirstRun: true },
  gitDetection: { enabled: true, pollIntervalMs: 2000 },
  fileWatching: { enabled: true, debounceMs: 300 },
  embeddings: { enabled: true },
};

describe('config command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    mockLoadGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
    mockMergeGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
    mockConfigServiceLoad.mockResolvedValue({ ...baseProjectConfig });
    mockConfigServiceSave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configSetCommand (global keys)', () => {
    it('should set a valid backend value', async () => {
      await configSetCommand('backend', 'lancedb');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ backend: 'lancedb' });
    });

    it('should reject unknown keys', async () => {
      await expect(configSetCommand('unknown.key', 'value')).rejects.toThrow('process.exit');
    });

    it('should reject retired qdrant keys', async () => {
      await expect(configSetCommand('qdrant.url', 'http://localhost:6333')).rejects.toThrow(
        'process.exit',
      );
    });

    it('should reject invalid values for constrained keys', async () => {
      await expect(configSetCommand('backend', 'qdrant')).rejects.toThrow('process.exit');
    });
  });

  describe('configSetCommand (project keys)', () => {
    it('should set embeddings.enabled to false via ConfigService', async () => {
      await configSetCommand('embeddings.enabled', 'false');

      expect(mockConfigServiceLoad).toHaveBeenCalledWith(process.cwd());
      expect(mockConfigServiceSave).toHaveBeenCalledWith(
        process.cwd(),
        expect.objectContaining({ embeddings: { enabled: false } }),
      );
      // Global config must not be touched for a project-scoped key.
      expect(mockMergeGlobalConfig).not.toHaveBeenCalled();
    });

    it('should set embeddings.enabled to true via ConfigService', async () => {
      mockConfigServiceLoad.mockResolvedValue({
        ...baseProjectConfig,
        embeddings: { enabled: false },
      });

      await configSetCommand('embeddings.enabled', 'true');

      expect(mockConfigServiceSave).toHaveBeenCalledWith(
        process.cwd(),
        expect.objectContaining({ embeddings: { enabled: true } }),
      );
    });

    it('should preserve the rest of the loaded project config when setting embeddings.enabled', async () => {
      await configSetCommand('embeddings.enabled', 'false');

      expect(mockConfigServiceSave).toHaveBeenCalledWith(
        process.cwd(),
        expect.objectContaining({ core: baseProjectConfig.core, mcp: baseProjectConfig.mcp }),
      );
    });

    it('should reject invalid values for embeddings.enabled', async () => {
      await expect(configSetCommand('embeddings.enabled', 'maybe')).rejects.toThrow('process.exit');
      expect(mockConfigServiceSave).not.toHaveBeenCalled();
    });

    it('should exit with an error when the project config fails to load', async () => {
      mockConfigServiceLoad.mockRejectedValue(new Error('Invalid JSON syntax'));

      await expect(configSetCommand('embeddings.enabled', 'true')).rejects.toThrow('process.exit');
    });
  });

  describe('configGetCommand (global keys)', () => {
    it('should display a set value', async () => {
      mockLoadGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
      await configGetCommand('backend');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('lancedb'));
    });

    it('should display (not set) for missing values', async () => {
      mockLoadGlobalConfig.mockResolvedValue({});
      await configGetCommand('backend');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not set'));
    });

    it('should reject unknown keys', async () => {
      await expect(configGetCommand('unknown')).rejects.toThrow('process.exit');
    });
  });

  describe('configGetCommand (project keys)', () => {
    it('should read embeddings.enabled from ConfigService', async () => {
      mockConfigServiceLoad.mockResolvedValue({
        ...baseProjectConfig,
        embeddings: { enabled: false },
      });

      await configGetCommand('embeddings.enabled');

      expect(mockConfigServiceLoad).toHaveBeenCalledWith(process.cwd());
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('false'));
      // Global config must not be consulted for a project-scoped key.
      expect(mockLoadGlobalConfig).not.toHaveBeenCalled();
    });
  });

  describe('configListCommand', () => {
    it('should list all global config keys', async () => {
      mockLoadGlobalConfig.mockResolvedValue({
        backend: 'lancedb',
      });

      await configListCommand();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('backend'));
    });

    it('should also list project config keys', async () => {
      await configListCommand();

      const allOutput = vi.mocked(console.log).mock.calls.flat().join(' ');
      expect(allOutput).toContain('embeddings.enabled');
      expect(allOutput).toContain('Project Configuration');
    });

    it('should print a friendly error instead of rejecting when the global config fails to load', async () => {
      mockLoadGlobalConfig.mockRejectedValue(new Error('Invalid JSON syntax'));

      await expect(configListCommand()).resolves.toBeUndefined();

      const allOutput = vi.mocked(console.log).mock.calls.flat().join(' ');
      expect(allOutput).toContain('Failed to load global config');
      expect(allOutput).toContain('Invalid JSON syntax');
      // Project config section must still render even though global failed.
      expect(allOutput).toContain('Project Configuration');
    });
  });
});
