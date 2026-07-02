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
    mockLoadGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
    mockMergeGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configSetCommand', () => {
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

  describe('configGetCommand', () => {
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

  describe('configListCommand', () => {
    it('should list all config keys', async () => {
      mockLoadGlobalConfig.mockResolvedValue({
        backend: 'lancedb',
      });

      await configListCommand();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('backend'));
    });
  });
});
