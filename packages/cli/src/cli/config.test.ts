import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configSetCommand, configGetCommand, configListCommand } from './config.js';

// Mock @liendev/core
vi.mock('@liendev/core', () => ({
  loadGlobalConfig: vi.fn(),
  mergeGlobalConfig: vi.fn(),
}));

import { loadGlobalConfig, mergeGlobalConfig } from '@liendev/core';

const mockLoadGlobalConfig = vi.mocked(loadGlobalConfig);
const mockMergeGlobalConfig = vi.mocked(mergeGlobalConfig);

describe('config command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    mockLoadGlobalConfig.mockResolvedValue({ backend: 'sqlite' });
    mockMergeGlobalConfig.mockResolvedValue({ backend: 'sqlite' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configSetCommand', () => {
    it('should set the sqlite backend value', async () => {
      await configSetCommand('backend', 'sqlite');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ backend: 'sqlite' });
    });

    it('should reject the retired lancedb backend value', async () => {
      await expect(configSetCommand('backend', 'lancedb')).rejects.toThrow('process.exit');
      expect(mockMergeGlobalConfig).not.toHaveBeenCalled();
    });

    it('should reject unknown keys', async () => {
      await expect(configSetCommand('unknown.key', 'value')).rejects.toThrow('process.exit');
    });

    it('should reject the retired embeddings.enabled key', async () => {
      await expect(configSetCommand('embeddings.enabled', 'true')).rejects.toThrow('process.exit');
      expect(mockMergeGlobalConfig).not.toHaveBeenCalled();
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

  describe('configGetCommand', () => {
    it('should display a set value', async () => {
      mockLoadGlobalConfig.mockResolvedValue({ backend: 'sqlite' });
      await configGetCommand('backend');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('sqlite'));
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

  describe('configListCommand', () => {
    it('should list all global config keys', async () => {
      mockLoadGlobalConfig.mockResolvedValue({
        backend: 'sqlite',
      });

      await configListCommand();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('backend'));
    });

    it('should print a friendly error instead of rejecting when the global config fails to load', async () => {
      mockLoadGlobalConfig.mockRejectedValue(new Error('Invalid JSON syntax'));

      await expect(configListCommand()).resolves.toBeUndefined();

      const allOutput = vi.mocked(console.log).mock.calls.flat().join(' ');
      expect(allOutput).toContain('Failed to load global config');
      expect(allOutput).toContain('Invalid JSON syntax');
    });
  });
});
