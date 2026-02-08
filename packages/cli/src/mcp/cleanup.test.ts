import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupCleanupHandlers } from './cleanup.js';
import type { LogFn } from './types.js';

function createMockServer() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockFileWatcher() {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('setupCleanupHandlers', () => {
  let log: LogFn;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.fn<LogFn>();
    // Mock process.exit so it throws instead of exiting the process
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('should return an async function', () => {
    const cleanup = setupCleanupHandlers(
      createMockServer(),
      setInterval(() => {}, 99999),
      null,
      null,
      log
    );
    expect(typeof cleanup).toBe('function');
  });

  it('should clear the versionCheckInterval when called', async () => {
    const interval = setInterval(() => {}, 99999);
    const clearSpy = vi.spyOn(global, 'clearInterval');

    const cleanup = setupCleanupHandlers(
      createMockServer(),
      interval,
      null,
      null,
      log
    );

    await expect(cleanup()).rejects.toThrow('process.exit called');
    expect(clearSpy).toHaveBeenCalledWith(interval);
    clearSpy.mockRestore();
  });

  it('should clear the gitPollInterval when provided', async () => {
    const versionInterval = setInterval(() => {}, 99999);
    const gitInterval = setInterval(() => {}, 99999);
    const clearSpy = vi.spyOn(global, 'clearInterval');

    const cleanup = setupCleanupHandlers(
      createMockServer(),
      versionInterval,
      gitInterval,
      null,
      log
    );

    await expect(cleanup()).rejects.toThrow('process.exit called');
    expect(clearSpy).toHaveBeenCalledWith(versionInterval);
    expect(clearSpy).toHaveBeenCalledWith(gitInterval);
    clearSpy.mockRestore();
  });

  it('should stop the file watcher when provided', async () => {
    const watcher = createMockFileWatcher();

    const cleanup = setupCleanupHandlers(
      createMockServer(),
      setInterval(() => {}, 99999),
      null,
      watcher,
      log
    );

    await expect(cleanup()).rejects.toThrow('process.exit called');
    expect(watcher.stop).toHaveBeenCalledOnce();
  });

  it('should call server.close()', async () => {
    const server = createMockServer();

    const cleanup = setupCleanupHandlers(
      server,
      setInterval(() => {}, 99999),
      null,
      null,
      log
    );

    await expect(cleanup()).rejects.toThrow('process.exit called');
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('should call process.exit even if watcher.stop() throws', async () => {
    const watcher = createMockFileWatcher();
    watcher.stop.mockRejectedValue(new Error('watcher stop failed'));

    const cleanup = setupCleanupHandlers(
      createMockServer(),
      setInterval(() => {}, 99999),
      null,
      watcher,
      log
    );

    // process.exit is in the finally block, so it runs even if watcher.stop throws
    await expect(cleanup()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
