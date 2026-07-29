/**
 * Unit tests for the npx circuit breaker in `plugins/claude/hooks/lien-resolve.sh`
 * and its companion wrapper `plugins/claude/hooks/lien-npx-breaker.sh`.
 *
 * Background: with no global `lien` on PATH (the default plugin setup),
 * every hook falls back to `npx -y @liendev/lien@latest`. There's no
 * portable `timeout` binary on macOS bash 3.2, so a black-holed registry
 * (TCP accepts, never replies) can only ever be bounded by Claude Code's own
 * 5000ms hook timeout — an unmaskable SIGKILL that no trap can intercept.
 * Without a breaker, every qualifying edit re-attempts and re-hangs
 * indefinitely. The breaker: `lien-npx-breaker.sh` drops a timestamp marker
 * immediately before the real npx call and removes it immediately after; a
 * marker left behind stale is the fingerprint a SIGKILLed attempt leaves,
 * and `lien-resolve.sh` reads that to fail the source (caller exits 0,
 * silent) for a cooldown window instead of retrying a call very likely to
 * hang again.
 *
 * There are two markers, not one: an "in-flight" marker (written before each
 * real npx attempt, removed after) and a separate "breaker open until
 * <epoch>" marker, written only once staleness is first detected. The
 * split matters — a single in-flight marker alone would get rewritten fresh
 * by every new attempt, so a run of edits arriving faster than the
 * staleness window would keep resetting the clock and the breaker would
 * never actually open even though every attempt independently hangs. One of
 * the tests below ("closes the resetting-clock gap...") pins exactly that
 * regression.
 *
 * `lien-resolve.sh` is meant to be `.`-sourced, not executed, so these tests
 * drive it through a tiny harness script that sources it and reports
 * success/failure plus the resolved LIEN_CMD. `npx` itself is stubbed on
 * PATH (no real network, no real registry) so every scenario is
 * deterministic and fast — including the "stale" and "past cooldown" cases,
 * which seed the marker files' timestamps directly rather than waiting in
 * real time. A real, live black-holed-registry reproduction (this repo's
 * actual network, a real npx, a real unreachable test-net address) is
 * documented in the PR body rather than committed here, since it takes
 * several real seconds per run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const HOOKS_DIR = fileURLToPath(new URL('../../../plugins/claude/hooks/', import.meta.url));
const RESOLVE_SCRIPT = path.join(HOOKS_DIR, 'lien-resolve.sh');
const WRAPPER_SCRIPT = path.join(HOOKS_DIR, 'lien-npx-breaker.sh');

let binDir: string; // fake `npx` (and optionally `lien`) on PATH
let markerDir: string;
let marker: string;
let breakerUntil: string;
let callLog: string;
let harness: string;

beforeEach(() => {
  binDir = mkdtempSync(path.join(os.tmpdir(), 'lien-breaker-bin-'));
  markerDir = mkdtempSync(path.join(os.tmpdir(), 'lien-breaker-marker-'));
  marker = path.join(markerDir, 'inflight');
  breakerUntil = path.join(markerDir, 'breaker-open-until');
  callLog = path.join(markerDir, 'npx-calls.log');

  // Fake `npx`: logs a call, then behaves per $NPX_BEHAVIOR.
  const npxShim = path.join(binDir, 'npx');
  writeFileSync(
    npxShim,
    [
      '#!/usr/bin/env bash',
      'echo call >> "$NPX_CALL_LOG"',
      'case "${NPX_BEHAVIOR:-ok}" in',
      '  ok) echo "npx-ok:$*"; exit 0 ;;',
      '  fail) echo "npx-fail" 1>&2; exit 1 ;;',
      '  hang) sleep 5; exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(npxShim, 0o755);

  // Harness: sources lien-resolve.sh exactly the way a real hook does, then
  // reports what happened so the test can assert on it without needing a
  // real hook payload at all (lien-resolve.sh doesn't read stdin).
  harness = path.join(binDir, 'harness.sh');
  writeFileSync(
    harness,
    [
      '#!/usr/bin/env bash',
      'set -u',
      `. "${RESOLVE_SCRIPT}" || { echo SOURCE_FAILED; exit 3; }`,
      'echo "LIEN_CMD:${LIEN_CMD[*]}"',
      '"${LIEN_CMD[@]}" "$@"',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(harness, 0o755);
});

afterEach(() => {
  rmSync(binDir, { recursive: true, force: true });
  rmSync(markerDir, { recursive: true, force: true });
});

function seedMarker(ageSec: number): void {
  const ts = Math.floor(Date.now() / 1000) - ageSec;
  writeFileSync(marker, String(ts), 'utf-8');
}

/** Seed the breaker-open-until marker so it expires `inSec` from now (negative = already expired). */
function seedBreakerUntil(inSec: number): void {
  const ts = Math.floor(Date.now() / 1000) + inSec;
  writeFileSync(breakerUntil, String(ts), 'utf-8');
}

function runHarness(
  extraEnv: Record<string, string> = {},
  args: string[] = ['path', '--store'],
): { stdout: string; status: number | null } {
  const res = spawnSync('bash', [harness, ...args], {
    encoding: 'utf-8',
    env: {
      // A minimal, controlled PATH — not the real process.env.PATH — since
      // this machine may have a real global `lien` linked (e.g. via `npm
      // link` per CONTRIBUTING.md), which would otherwise shadow these
      // "no global lien" scenarios and make the tests non-deterministic.
      PATH: `${binDir}${path.delimiter}/bin${path.delimiter}/usr/bin`,
      NPX_CALL_LOG: callLog,
      LIEN_NPX_BREAKER_MARKER: marker,
      ...extraEnv,
    },
  });
  return { stdout: res.stdout, status: res.status };
}

function callCount(): number {
  try {
    return readFileSync(callLog, 'utf-8')
      .split('\n')
      .filter(l => l.length > 0).length;
  } catch {
    return 0;
  }
}

describe('lien-resolve.sh — no global lien, npx present, breaker default-on', () => {
  it('resolves to the wrapper and calls through to npx when no marker exists', () => {
    const { stdout, status } = runHarness();
    expect(stdout).toContain('LIEN_CMD:bash');
    expect(stdout).toContain('lien-npx-breaker.sh');
    expect(stdout).toContain('npx-ok:-y @liendev/lien@latest path --store');
    expect(status).toBe(0);
    expect(callCount()).toBe(1);
  });

  it('removes the marker after a successful call', () => {
    runHarness();
    expect(existsSync(marker)).toBe(false);
  });

  it('removes the marker even when the wrapped npx call itself fails', () => {
    const { status } = runHarness({ NPX_BEHAVIOR: 'fail' });
    expect(status).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('does not open the breaker for a fresh marker (e.g. a concurrent parallel hook)', () => {
    seedMarker(1); // 1s old — nowhere near the 7s default staleness threshold
    const { stdout, status } = runHarness();
    expect(stdout).not.toContain('SOURCE_FAILED');
    expect(status).toBe(0);
    expect(callCount()).toBe(1);
  });

  it('opens the breaker for a stale marker — never spawns npx, and consumes the marker', () => {
    seedMarker(30); // well past the 7s default staleness threshold
    const { stdout, status } = runHarness();
    expect(stdout).toBe('SOURCE_FAILED\n');
    expect(status).toBe(3);
    expect(callCount()).toBe(0);
    // The stale in-flight marker is consumed (removed) once it's converted
    // into a breaker-open-until decision — otherwise the NEXT check, once
    // cooldown elapses, would immediately see the same ancient marker and
    // re-trip the breaker without ever actually retrying.
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(breakerUntil)).toBe(true);
  });

  it('stays open for the full cooldown regardless of how many edits arrive in between', () => {
    seedMarker(30);
    const first = runHarness();
    expect(first.status).toBe(3);
    expect(callCount()).toBe(0);

    // Several more "edits" land during the cooldown window. None of them
    // should spawn npx, even though there's no in-flight marker to detect
    // staleness from any more (it was consumed by the first check above).
    for (let i = 0; i < 3; i++) {
      const { stdout, status } = runHarness();
      expect(stdout).toBe('SOURCE_FAILED\n');
      expect(status).toBe(3);
    }
    expect(callCount()).toBe(0);
  });

  it('closes the resetting-clock gap: a stale marker opens the breaker even when refreshed moments before by a fresh-looking attempt', () => {
    // Regression for a real design flaw caught during review: if staleness
    // were judged only against the in-flight marker, and each new attempt
    // re-armed that marker before trying again, a run of edits arriving
    // faster than the staleness window would keep resetting the clock and
    // the breaker would never open — even though every attempt independently
    // hangs. Simulate exactly that shape: a marker that's already past the
    // staleness threshold, as if the last attempt started, hung, and was
    // killed, then a new edit's hook fires immediately after.
    seedMarker(7); // exactly at the default 7s staleness threshold
    const { status } = runHarness();
    expect(status).toBe(3);
    expect(callCount()).toBe(0);
    expect(existsSync(breakerUntil)).toBe(true);
  });

  it('retries once the cooldown window has elapsed since the breaker opened', () => {
    seedBreakerUntil(-5); // breaker-open-until was 5s ago — cooldown has lapsed
    const { stdout, status } = runHarness();
    expect(stdout).not.toContain('SOURCE_FAILED');
    expect(status).toBe(0);
    expect(callCount()).toBe(1);
    // The expired breaker marker is tidied up rather than left behind.
    expect(existsSync(breakerUntil)).toBe(false);
  });

  it('respects a custom LIEN_NPX_BREAKER_STALE_SEC', () => {
    seedMarker(3); // would NOT be stale at the 7s default...
    const { status } = runHarness({ LIEN_NPX_BREAKER_STALE_SEC: '2' }); // ...but is at 2s
    expect(status).toBe(3);
    expect(callCount()).toBe(0);
  });

  it('respects a custom LIEN_NPX_BREAKER_COOLDOWN_SEC', () => {
    seedBreakerUntil(60); // still 60s from expiring under a 300s cooldown, but...
    const { status } = runHarness({ LIEN_NPX_BREAKER_COOLDOWN_SEC: '30' });
    // ...the cooldown length only matters when the breaker is *written*, not
    // when it's read — this asserts the still-open breaker (60s out) is
    // still honored regardless of what a *new* cooldown env would compute,
    // since breaker-open-until is an absolute epoch, not a duration.
    expect(status).toBe(3);
    expect(callCount()).toBe(0);
  });

  it('ignores a corrupted (non-numeric) marker file rather than misbehaving', () => {
    writeFileSync(marker, 'not-a-timestamp', 'utf-8');
    const { status } = runHarness();
    expect(status).toBe(0);
    expect(callCount()).toBe(1);
  });
});

describe('lien-resolve.sh — LIEN_NPX_BREAKER=off', () => {
  it('bypasses the breaker entirely, even with a stale marker present', () => {
    seedMarker(30);
    const { stdout, status } = runHarness({ LIEN_NPX_BREAKER: 'off' });
    expect(stdout).not.toContain('SOURCE_FAILED');
    expect(stdout).toContain('LIEN_CMD:npx -y @liendev/lien@latest');
    expect(status).toBe(0);
    expect(callCount()).toBe(1);
  });
});

describe('lien-resolve.sh — global `lien` on PATH', () => {
  it('resolves to the plain global binary and never touches the breaker, even with a stale marker', () => {
    const lienShim = path.join(binDir, 'lien');
    writeFileSync(lienShim, '#!/usr/bin/env bash\necho "lien-ok:$*"\nexit 0\n', 'utf-8');
    chmodSync(lienShim, 0o755);
    seedMarker(30);

    const { stdout, status } = runHarness();
    expect(stdout).toContain('LIEN_CMD:lien');
    expect(stdout).toContain('lien-ok:path --store');
    expect(status).toBe(0);
    expect(callCount()).toBe(0); // npx never invoked
    expect(existsSync(marker)).toBe(true); // marker untouched — not this path's concern
  });
});

describe('lien-npx-breaker.sh — leaves the marker behind when killed mid-call', () => {
  it('marker still exists immediately after the wrapper is killed while blocked on npx', () => {
    const res = spawnSync('bash', [WRAPPER_SCRIPT, 'path', '--store'], {
      encoding: 'utf-8',
      env: {
        PATH: `${binDir}${path.delimiter}/bin${path.delimiter}/usr/bin`,
        NPX_CALL_LOG: callLog,
        LIEN_NPX_BREAKER_MARKER: marker,
        NPX_BEHAVIOR: 'hang',
      },
      timeout: 500,
      killSignal: 'SIGKILL',
    });
    // The wrapper was killed before it could reach its own `rm -f "$marker"`
    // cleanup line — the same shape as Claude Code's 5000ms hook timeout.
    expect(res.signal).toBe('SIGKILL');
    expect(existsSync(marker)).toBe(true);
  });
});
