import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
vi.mock('../mcp/server.js', () => ({
  startMCPServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/banner.js', () => ({
  showBanner: vi.fn(),
}));

import { serveCommand } from './serve.js';
import { startMCPServer } from '../mcp/server.js';

describe('serveCommand', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.mocked(startMCPServer).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call startMCPServer with rootDir defaulting to cwd', async () => {
    await serveCommand({});

    expect(startMCPServer).toHaveBeenCalledWith({
      rootDir: process.cwd(),
      verbose: true,
      watch: undefined,
    });
  });

  it('should resolve --root to absolute path', async () => {
    // Use an existing directory for the test
    const tempDir = path.join(process.cwd(), '.test-serve-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    try {
      await serveCommand({ root: tempDir });

      expect(startMCPServer).toHaveBeenCalledWith({
        rootDir: path.resolve(tempDir),
        verbose: true,
        watch: undefined,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should reject non-existent --root directory', async () => {
    await serveCommand({ root: '/nonexistent/path/that/does/not/exist' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--root directory does not exist'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should reject --root that is not a directory', async () => {
    const tempFile = path.join(process.cwd(), '.test-serve-file-' + Date.now());
    await fs.writeFile(tempFile, 'test');

    try {
      await serveCommand({ root: tempFile });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--root path is not a directory'),
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      await fs.rm(tempFile, { force: true }).catch(() => {});
    }
  });

  it('should pass watch=false when --no-watch is set', async () => {
    await serveCommand({ noWatch: true });

    expect(startMCPServer).toHaveBeenCalledWith(expect.objectContaining({ watch: false }));
  });

  it('should warn about deprecated --watch flag', async () => {
    await serveCommand({ watch: true });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--watch flag is deprecated'),
    );
    expect(startMCPServer).toHaveBeenCalledWith(expect.objectContaining({ watch: true }));
  });

  it('should prioritize --no-watch over --watch', async () => {
    await serveCommand({ watch: true, noWatch: true });

    expect(startMCPServer).toHaveBeenCalledWith(expect.objectContaining({ watch: false }));
  });

  it('should exit on startMCPServer failure', async () => {
    vi.mocked(startMCPServer).mockRejectedValueOnce(new Error('Server crash'));

    await serveCommand({});

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start MCP server'),
      expect.any(Error),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
