import { spawn } from 'child_process';
import fs from 'fs';
import { getAnnotateDaemonSocketPath, startAnnotateDaemon } from '../daemon/annotate-daemon.js';

export interface AnnotateDaemonCommandOptions {
  detach?: boolean;
  verbose?: boolean;
}

/**
 * `lien annotate-daemon [--detach]`
 *
 * Without `--detach`: starts the daemon in the foreground and blocks until
 * a fatal signal. SIGINT/SIGTERM trigger graceful shutdown.
 *
 * With `--detach`: respawns the current process with the same argv minus
 * `--detach`, in `detached` mode with stdio detached from the parent, then
 * exits 0. The child becomes the daemon and orphans to init.
 */
export async function annotateDaemonCommand(
  options: AnnotateDaemonCommandOptions = {},
): Promise<void> {
  if (options.detach) {
    detachAndExit(options);
    return;
  }

  const handle = await startAnnotateDaemon({ verbose: options.verbose });

  const shutdown = async (signal: NodeJS.Signals) => {
    if (options.verbose) {
      process.stderr.write(`[lien annotate-daemon] caught ${signal}, shutting down\n`);
    }
    try {
      await handle.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // Keep the event loop alive — server is already listening but we need
  // commander's action to keep awaiting.
  await new Promise<void>(() => undefined);
}

function detachAndExit(options: AnnotateDaemonCommandOptions): void {
  // If another daemon is already serving this repo, don't spawn a second.
  // A live socket means there's a process behind it; if it's stale, the
  // next client connect will fail and *that* hook will respawn.
  const socketPath = getAnnotateDaemonSocketPath();
  if (fs.existsSync(socketPath)) {
    if (options.verbose) {
      process.stderr.write(`[lien annotate-daemon] socket already exists at ${socketPath}\n`);
    }
    return;
  }

  const argv = process.argv.slice(1).filter(a => a !== '--detach');
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}
