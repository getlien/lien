import fs from 'fs';
import net from 'net';
import path from 'path';
import { VectorDB, VERSION_CHECK_INTERVAL_MS } from '@liendev/core';
import { resolveProjectRoot } from '../cli/project-root.js';
import { getStoreRoot } from '../cli/store-paths.js';
import { resolvePathsForFile, runAnnotateOnce } from '../cli/annotate-cmd.js';
import { clearDependencyCache } from '../mcp/handlers/dependency-analyzer.js';
import { toAbsolutePath, type AbsolutePath } from '../types/paths.js';
import {
  PROTOCOL_VERSION,
  encodeResponse,
  parseRequest,
  type AnnotateResponse,
} from './protocol.js';

const SUPPRESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface AnnotateDaemonOptions {
  /** Project root to serve. Defaults to resolveProjectRoot(process.cwd()). */
  rootDir?: string;
  /** Override the socket path (otherwise computed from store root). */
  socketPath?: string;
  /** Idle-shutdown timeout in ms. Default 30 min. */
  idleTimeoutMs?: number;
  /** Suppression TTL in ms. Default 5 min. */
  suppressionTtlMs?: number;
  /** Override the version-check poll interval (mostly for tests). */
  versionCheckIntervalMs?: number;
  /** Verbose stderr logging for debugging. */
  verbose?: boolean;
}

export interface AnnotateDaemonHandle {
  socketPath: string;
  rootDir: AbsolutePath;
  /** Shut the daemon down (unlinks the socket, clears timers). */
  close(): Promise<void>;
}

/**
 * Compute the conventional per-repo socket path:
 *   <getStoreRoot>/annotate-daemon.sock
 */
export function getAnnotateDaemonSocketPath(cwd: string = process.cwd()): string {
  return path.join(getStoreRoot(cwd), 'annotate-daemon.sock');
}

/**
 * Start the daemon. Returns a handle for graceful shutdown (used by tests
 * and by the CLI on SIGINT/SIGTERM).
 */
export async function startAnnotateDaemon(
  opts: AnnotateDaemonOptions = {},
): Promise<AnnotateDaemonHandle> {
  const rootDir = toAbsolutePath(
    opts.rootDir ? path.resolve(opts.rootDir) : resolveProjectRoot(process.cwd()),
  );
  const socketPath = opts.socketPath ?? path.join(getStoreRoot(rootDir), 'annotate-daemon.sock');
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const suppressionTtlMs = opts.suppressionTtlMs ?? SUPPRESSION_TTL_MS;
  const versionCheckIntervalMs = opts.versionCheckIntervalMs ?? VERSION_CHECK_INTERVAL_MS;

  const log = createLogger(opts.verbose);

  // Align process cwd with the project root so internal normalizers in
  // findDependents / ComplexityAnalyzer (which read process.cwd()) see the
  // right workspace root. Daemon is one-per-repo, so this is set once and
  // never changes for the daemon's lifetime.
  try {
    process.chdir(rootDir);
  } catch (err) {
    log(`Failed to chdir to ${rootDir}: ${err}`);
  }

  await fs.promises.mkdir(path.dirname(socketPath), { recursive: true });
  // Stale socket from a crashed predecessor → unlink before bind. ENOENT is
  // fine; anything else is unusual but non-fatal (bind will surface a real
  // error if needed).
  await fs.promises.unlink(socketPath).catch(() => undefined);

  const vectorDB = new VectorDB(rootDir);
  try {
    await vectorDB.initialize();
    log(`VectorDB initialized at ${rootDir}`);
  } catch (err) {
    log(`VectorDB init failed (continuing — requests will return null): ${err}`);
  }

  const suppression = new SuppressionTracker(suppressionTtlMs);
  const state = { lastActivity: Date.now() };

  const versionInterval = setInterval(() => {
    void checkVersionAndReconnect(vectorDB, log);
  }, versionCheckIntervalMs);
  versionInterval.unref?.();

  const idleInterval = setInterval(
    () => {
      if (Date.now() - state.lastActivity >= idleTimeoutMs) {
        log('Idle timeout reached; shutting down.');
        void handle.close();
      }
    },
    Math.min(idleTimeoutMs, 60_000),
  );
  idleInterval.unref?.();

  const server = net.createServer(socket => {
    socket.setEncoding('utf-8');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      state.lastActivity = Date.now();
      void handleRequest(line, {
        vectorDB,
        rootDir,
        suppression,
        log,
      })
        .then(resp => {
          socket.write(encodeResponse(resp));
          socket.end();
        })
        .catch(err => {
          log(`Request handler crashed: ${err}`);
          socket.write(
            encodeResponse({ v: PROTOCOL_VERSION, annotation: null, error: String(err) }),
          );
          socket.end();
        });
    });
    socket.on('error', () => {
      // Client disconnect mid-write is normal under bash piping; ignore.
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  log(`Listening on ${socketPath}`);

  let closing = false;
  const handle: AnnotateDaemonHandle = {
    socketPath,
    rootDir,
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(versionInterval);
      clearInterval(idleInterval);
      await new Promise<void>(resolve => server.close(() => resolve()));
      await fs.promises.unlink(socketPath).catch(() => undefined);
      clearDependencyCache();
      log('Daemon shut down.');
    },
  };
  return handle;
}

interface HandleRequestCtx {
  vectorDB: VectorDB;
  rootDir: AbsolutePath;
  suppression: SuppressionTracker;
  log: (msg: string) => void;
}

async function handleRequest(line: string, ctx: HandleRequestCtx): Promise<AnnotateResponse> {
  const req = parseRequest(line);
  if (!req) return { v: PROTOCOL_VERSION, annotation: null, error: 'malformed-request' };

  // Defensive: session_id was previously interpolated into a filesystem
  // path. Daemon uses it only as a Map key, but reject pathological values
  // to keep the suppression table well-behaved.
  if (!SESSION_ID_PATTERN.test(req.session_id)) {
    return { v: PROTOCOL_VERSION, annotation: null, error: 'invalid-session-id' };
  }

  if (ctx.suppression.isSuppressed(req.session_id, req.file_path)) {
    return { v: PROTOCOL_VERSION, annotation: null };
  }

  const paths = resolvePathsForFile(req.file_path, req.cwd);
  if (!paths) return { v: PROTOCOL_VERSION, annotation: null };

  let annotation: string | null = null;
  try {
    annotation = await runAnnotateOnce(ctx.vectorDB, paths);
  } catch (err) {
    ctx.log(`runAnnotateOnce threw: ${err}`);
    return { v: PROTOCOL_VERSION, annotation: null, error: 'annotate-failed' };
  }

  if (annotation !== null) {
    ctx.suppression.record(req.session_id, req.file_path);
  }
  return { v: PROTOCOL_VERSION, annotation };
}

/**
 * Per-session, per-file suppression with a TTL. Replaces the disk
 * touchfile machinery from the v1 hook. Lazy GC: an expired entry is only
 * cleaned up on the next access for that key (good enough — sessions
 * naturally churn within an idle timeout).
 */
export class SuppressionTracker {
  private readonly bySession = new Map<string, Map<string, number>>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isSuppressed(sessionId: string, filePath: string): boolean {
    const perSession = this.bySession.get(sessionId);
    if (!perSession) return false;
    const ts = perSession.get(filePath);
    if (ts === undefined) return false;
    if (this.now() - ts > this.ttlMs) {
      perSession.delete(filePath);
      if (perSession.size === 0) this.bySession.delete(sessionId);
      return false;
    }
    return true;
  }

  record(sessionId: string, filePath: string): void {
    let perSession = this.bySession.get(sessionId);
    if (!perSession) {
      perSession = new Map();
      this.bySession.set(sessionId, perSession);
    }
    perSession.set(filePath, this.now());
  }
}

async function checkVersionAndReconnect(
  vectorDB: VectorDB,
  log: (msg: string) => void,
): Promise<void> {
  try {
    if (await vectorDB.checkVersion()) {
      log('Index version changed; reconnecting and clearing scan cache.');
      await vectorDB.reconnect();
      clearDependencyCache();
    }
  } catch (err) {
    log(`Version check failed: ${err}`);
  }
}

function createLogger(verbose: boolean | undefined): (msg: string) => void {
  if (!verbose) return () => undefined;
  return msg => {
    process.stderr.write(`[lien annotate-daemon] ${msg}\n`);
  };
}
