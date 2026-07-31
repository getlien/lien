/**
 * Build-identity stamping for the nudge-outcome ledger (`nudge-events.jsonl`).
 *
 * Motivation (see docs/architecture/nudge-telemetry.md's "Build provenance"
 * section and issue #916): an empty window in `lien stats` is ambiguous —
 * nudges could have been shown and ignored, never triggered, or recording
 * could have been IMPOSSIBLE because the deployed plugin hooks predate the
 * instrumentation entirely. That third case actually happened: a directory-
 * source plugin install pinned to a stale branch produced a silently empty
 * ledger with no way to tell "no engagement" from "no capable build ever ran".
 *
 * The fix pairs two facts into a `BuildStamp` on every recorded event:
 *   - cliVersion — the running `lien` binary's package.json version.
 *   - hooksHash  — a short content hash of the plugin hooks directory the
 *                  CALLING hook script lives in.
 *
 * CLI version alone is insufficient: the failure mode that motivated this
 * file was stale *hooks* running alongside an otherwise-current CLI (an npm
 * install can be current while a directory-pinned plugin checkout is not).
 * The CLI cannot discover the live hooks directory on its own — the whole
 * point of the bug is that the plugin snapshot and the CLI installation can
 * come from different places — so `hooksHash` is only ever computed from a
 * `hooksDir` the CALLER (a hook script, via its own `BASH_SOURCE`) supplies.
 * A bare CLI invocation with no `hooksDir` still gets a stamp — just missing
 * `hooksHash` — a partial-but-honest signal, never a crash.
 *
 * Per-event, not a session header: matches every event in the ledger with
 * its own build stamp so a reader never needs to reconstruct which session
 * header a given shown/signal belongs to — robust to interleaved writes from
 * concurrent sessions, and to the byte-cap trim dropping an old header event
 * while its session's later events survive.
 *
 * Cost discipline: hashing the hooks directory is filesystem-only, no
 * subprocess (a dozen small shell scripts), but doing it on EVERY event would
 * still be wasted repeat work — signals fire on every `get_dependents`/
 * `get_files_context` call. So the stamp is computed once per session and
 * cached to a small per-session file (same touchfile pattern as
 * `annotated-sessions/` and `test-sessions/`, GC'd the same way by
 * SessionStart). Every later event in that session reads the cache (one
 * small file read) instead of re-hashing.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getIndexDir } from '@liendev/core';
import { getPackageVersion } from './version.js';

export interface BuildStamp {
  /** The running `lien` CLI's package.json version. */
  cliVersion: string;
  /** Short content hash of the hooks directory, when known — absent when no
   *  `hooksDir` was ever supplied for this session (e.g. a bare CLI call). */
  hooksHash?: string;
}

const BUILD_CACHE_DIRNAME = 'nudge-build';

// Defense-in-depth: sessionId is interpolated into a filesystem path (the
// per-session cache file below), so it must be validated the same way the
// shell hooks already gate it (`case "$session_id" in *[!A-Za-z0-9_-]*) exit
// 0`) — the CLI is a directly-invokable public surface and must not depend
// on its caller for that guarantee. Mirrors test-ledger.ts's identical
// SESSION_ID_RE guard, for the same reason.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Where this session's cached stamp lives, mirroring annotated-sessions/'s
 * per-session shape — or null when `sessionId` fails validation, so an unsafe
 * id never gets a cache path at all. Validate-then-assert-containment: even a
 * gap in `SESSION_ID_RE` couldn't escape `nudge-build/`, since the resolved
 * path is also checked against it before being returned.
 */
export function nudgeBuildCachePath(rootDir: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const dir = path.join(getIndexDir(rootDir), BUILD_CACHE_DIRNAME);
  const filePath = path.join(dir, `${sessionId}.json`);
  const rel = path.relative(dir, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return filePath;
}

/**
 * Deterministic short hash over every regular file directly inside
 * `hooksDir` (name + content, sorted by name so filesystem iteration order
 * never changes the result). No subprocess, no recursion — the hooks
 * directory is a flat handful of small shell scripts plus `hooks.json`.
 * Returns undefined for a missing/unreadable directory or an empty one
 * (fail-open: a bad `hooksDir` degrades to "hooksHash unknown", not a crash).
 */
export async function hashHooksDir(hooksDir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(hooksDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort();
    if (files.length === 0) return undefined;

    const hash = crypto.createHash('sha256');
    for (const name of files) {
      const content = await fs.readFile(path.join(hooksDir, name));
      hash.update(name);
      hash.update('\0');
      hash.update(content);
    }
    return hash.digest('hex').slice(0, 12);
  } catch {
    return undefined;
  }
}

async function readCachedStamp(cachePath: string): Promise<BuildStamp | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).cliVersion === 'string'
    ) {
      const v = parsed as Record<string, unknown>;
      return {
        cliVersion: v.cliVersion as string,
        ...(typeof v.hooksHash === 'string' ? { hooksHash: v.hooksHash } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCachedStamp(cachePath: string, stamp: BuildStamp): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(stamp), 'utf-8');
  } catch {
    // Best-effort cache; the event's own stamp does not depend on this persisting.
  }
}

/**
 * Resolve this session's build stamp, computing and caching it on first use.
 * A cached stamp that already has `hooksHash` is reused as-is. A cached
 * stamp that lacks one (an earlier call in this session had no `hooksDir`)
 * is topped up when THIS call supplies one, rather than permanently locking
 * the session into a partial stamp. An unsafe `sessionId` (see
 * `nudgeBuildCachePath`) simply skips caching — the stamp is still computed
 * and returned correctly every time, just never persisted. Never throws —
 * worst case returns `{ cliVersion }` alone.
 */
export async function getBuildStamp(
  rootDir: string,
  sessionId: string,
  hooksDir?: string,
): Promise<BuildStamp> {
  const cachePath = nudgeBuildCachePath(rootDir, sessionId);
  const cached = cachePath ? await readCachedStamp(cachePath) : null;
  if (cached && (cached.hooksHash || !hooksDir)) return cached;

  const cliVersion = getPackageVersion();
  const hooksHash = hooksDir ? await hashHooksDir(hooksDir) : undefined;
  const stamp: BuildStamp = { cliVersion, ...(hooksHash ? { hooksHash } : {}) };
  if (cachePath) await writeCachedStamp(cachePath, stamp);
  return stamp;
}
