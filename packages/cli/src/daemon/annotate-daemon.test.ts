import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { startAnnotateDaemon, type AnnotateDaemonHandle } from './annotate-daemon.js';
import { requestAnnotation } from './client.js';

/**
 * Integration tests run the daemon in-process (no subprocess spawn) so we
 * can introspect timer behavior. Each test gets a fresh tmp rootDir + socket
 * path. The daemon `process.chdir`s into the rootDir; we restore cwd in
 * afterEach so cross-test pollution can't happen.
 */
describe('annotate-daemon', () => {
  let originalCwd: string;
  let tmpDir: string;
  let socketPath: string;
  let handle: AnnotateDaemonHandle | null = null;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-daemon-test-'));
    socketPath = path.join(tmpDir, 'annotate-daemon.sock');
    // Make tmpDir look like a project root so resolveProjectRoot stops here.
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('responds with null for a missing file against an empty index', async () => {
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      idleTimeoutMs: 60_000,
      versionCheckIntervalMs: 60_000,
    });

    const resp = await requestAnnotation(
      { socketPath },
      {
        session_id: 'sess-1',
        file_path: 'no-such-file.ts',
        cwd: tmpDir,
      },
    );
    expect(resp.annotation).toBeNull();
  });

  it('rejects malformed requests with an error response', async () => {
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      versionCheckIntervalMs: 60_000,
    });
    const resp = await requestAnnotation(
      { socketPath },
      {
        session_id: 'has spaces',
        file_path: 'foo.ts',
        cwd: tmpDir,
      },
    );
    expect(resp.annotation).toBeNull();
    expect(resp.error).toBe('invalid-session-id');
  });

  it('serves multiple concurrent connections', async () => {
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      versionCheckIntervalMs: 60_000,
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        requestAnnotation(
          { socketPath },
          { session_id: `sess-${i}`, file_path: `f-${i}.ts`, cwd: tmpDir },
        ),
      ),
    );
    for (const r of results) {
      expect(r.annotation).toBeNull();
    }
  });

  it('unlinks a stale socket file on startup', async () => {
    // Pre-create a stale file at the socket path. Daemon should remove it
    // and bind cleanly rather than EADDRINUSE.
    await fs.writeFile(socketPath, 'stale');
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      versionCheckIntervalMs: 60_000,
    });
    const resp = await requestAnnotation(
      { socketPath },
      { session_id: 'sess', file_path: 'x.ts', cwd: tmpDir },
    );
    expect(resp.annotation).toBeNull();
  });

  it('shuts down gracefully on close() and unlinks the socket', async () => {
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      versionCheckIntervalMs: 60_000,
    });
    await handle.close();
    handle = null;
    await expect(fs.access(socketPath)).rejects.toThrow();
  });

  it('idle timer triggers shutdown when no requests arrive', async () => {
    handle = await startAnnotateDaemon({
      rootDir: tmpDir,
      socketPath,
      // The check interval is `min(idleTimeoutMs, 60_000)`. Picking a small
      // value here keeps the test fast (~150ms total).
      idleTimeoutMs: 50,
      versionCheckIntervalMs: 60_000,
    });
    // Wait long enough for the idle timer to fire at least once after the
    // 50ms threshold.
    await new Promise(resolve => setTimeout(resolve, 200));
    handle = null;
    await expect(fs.access(socketPath)).rejects.toThrow();
  });
});
