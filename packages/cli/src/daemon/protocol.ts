/**
 * annotate-daemon wire protocol — newline-delimited JSON over a Unix socket.
 *
 * One request → one response per connection. Errors are not raised across
 * the wire; the daemon always returns `{ annotation: null }` on any
 * internal failure so the hook degrades silently (matches the one-shot
 * annotateCommand contract).
 */

export const PROTOCOL_VERSION = 1;

export interface AnnotateRequest {
  v: typeof PROTOCOL_VERSION;
  /** Claude Code session id — used as the suppression-map key. */
  session_id: string;
  /** Absolute or repo-relative path to the file the model just Read. */
  file_path: string;
  /** Caller's cwd; used to resolve relative file_path under subdirs. */
  cwd: string;
}

export interface AnnotateResponse {
  v: typeof PROTOCOL_VERSION;
  /** Formatted annotation, or null when impact is trivial / suppressed. */
  annotation: string | null;
  /** Optional diagnostic — non-empty when the daemon swallowed an error. */
  error?: string;
}

export function encodeRequest(req: AnnotateRequest): string {
  return JSON.stringify(req) + '\n';
}

export function encodeResponse(resp: AnnotateResponse): string {
  return JSON.stringify(resp) + '\n';
}

/**
 * Parse a single newline-terminated JSON frame. Returns null when the line
 * is empty or unparseable — callers must treat that as "no result" rather
 * than throwing, so a malformed wire payload can't crash the daemon.
 */
export function parseRequest(line: string): AnnotateRequest | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<AnnotateRequest>;
    if (
      obj.v !== PROTOCOL_VERSION ||
      typeof obj.session_id !== 'string' ||
      typeof obj.file_path !== 'string' ||
      typeof obj.cwd !== 'string'
    ) {
      return null;
    }
    return obj as AnnotateRequest;
  } catch {
    return null;
  }
}

export function parseResponse(line: string): AnnotateResponse | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<AnnotateResponse>;
    if (obj.v !== PROTOCOL_VERSION) return null;
    const annotation = obj.annotation;
    if (annotation !== null && typeof annotation !== 'string') return null;
    return { v: PROTOCOL_VERSION, annotation, error: obj.error };
  } catch {
    return null;
  }
}
