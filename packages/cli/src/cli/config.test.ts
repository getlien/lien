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
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    mockLoadGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
    mockMergeGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configSetCommand', () => {
    it('should set a valid backend value', async () => {
      await configSetCommand('backend', 'qdrant');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ backend: 'qdrant' });
    });

    it('should set embeddings.device to gpu', async () => {
      await configSetCommand('embeddings.device', 'gpu');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ embeddings: { device: 'gpu' } });
    });

    it('should set embeddings.device to cpu', async () => {
      await configSetCommand('embeddings.device', 'cpu');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ embeddings: { device: 'cpu' } });
    });

    it('should reject unknown keys', async () => {
      await expect(configSetCommand('unknown.key', 'value')).rejects.toThrow('process.exit');
    });

    it('should reject invalid values for constrained keys', async () => {
      await expect(configSetCommand('backend', 'invalid')).rejects.toThrow('process.exit');
    });

    it('should reject invalid embeddings.device values', async () => {
      await expect(configSetCommand('embeddings.device', 'tpu')).rejects.toThrow('process.exit');
    });

    it('should allow free-form values for qdrant.url', async () => {
      await configSetCommand('qdrant.url', 'http://localhost:6333');
      expect(mockMergeGlobalConfig).toHaveBeenCalledWith({ qdrant: { url: 'http://localhost:6333' } });
    });
  });

  describe('configGetCommand', () => {
    it('should display a set value', async () => {
      mockLoadGlobalConfig.mockResolvedValue({ backend: 'qdrant', qdrant: { url: 'http://localhost:6333' } });
      await configGetCommand('backend');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('qdrant'));
    });

    it('should display (not set) for missing values', async () => {
      mockLoadGlobalConfig.mockResolvedValue({ backend: 'lancedb' });
      await configGetCommand('embeddings.device');
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
        embeddings: { device: 'gpu' },
      });

      await configListCommand();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('backend'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('embeddings.device'));
    });
  });
});
