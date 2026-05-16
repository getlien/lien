import net from 'net';
import {
  PROTOCOL_VERSION,
  encodeRequest,
  parseResponse,
  type AnnotateRequest,
  type AnnotateResponse,
} from './protocol.js';

export interface AnnotateClientOptions {
  socketPath: string;
  /** Per-request timeout (ms). Default: 5000. */
  timeoutMs?: number;
}

/**
 * Send one annotation request to a running daemon and resolve with its
 * response. Rejects on any socket-level failure (connect refused, timeout,
 * malformed reply) so callers can decide whether to spawn a daemon and
 * retry, or fall through to the one-shot CLI path.
 */
export function requestAnnotation(
  opts: AnnotateClientOptions,
  payload: Omit<AnnotateRequest, 'v'>,
): Promise<AnnotateResponse> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: opts.socketPath });
    let buffer = '';
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      action();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`annotate-daemon timeout after ${timeoutMs}ms`)));
    }, timeoutMs);
    timer.unref?.();

    socket.once('connect', () => {
      socket.write(encodeRequest({ v: PROTOCOL_VERSION, ...payload }));
    });

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      const resp = parseResponse(line);
      clearTimeout(timer);
      if (resp === null) {
        settle(() => reject(new Error('annotate-daemon returned malformed response')));
        return;
      }
      settle(() => resolve(resp));
    });

    socket.once('error', err => {
      clearTimeout(timer);
      settle(() => reject(err));
    });

    socket.once('close', () => {
      clearTimeout(timer);
      settle(() => reject(new Error('annotate-daemon closed connection without response')));
    });
  });
}
