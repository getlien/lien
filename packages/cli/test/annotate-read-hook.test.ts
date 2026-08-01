/**
 * Unit tests for the PostToolUse read hook `plugins/claude/hooks/annotate-read.sh`.
 *
 * Three bugs, the first two defeating the #938/#978 never-suppress
 * guarantee (an annotation carrying a complexity/headroom/incomplete-
 * dependent-attribution signal — `hasNeverSuppressSignal` in
 * `annotate-cmd.ts` — must never be silenced by session dedup), the third
 * a distinct cost/amortization bug in the same touchfile logic:
 *
 * HOOKS-12: the touchfile dedup gate's `LIEN_ANNOTATE_GUARD=off` branch used
 * to check ONLY the touchfile's mtime (the pre-#978 TTL logic), never its
 * CONTENT (`1` = never-suppress, written by the guard-ON path already).
 * `LIEN_ANNOTATE_GUARD=off` is documented to make suppression WEAKER (a TTL
 * window instead of session-long dedup) — but for a never-suppress file it
 * did the opposite: a repeat Read within the TTL window suppressed the one
 * class of annotation that must never be suppressed. Fixed by checking the
 * touchfile's content before branching on guard mode at all.
 *
 * HOOKS-6: the npx circuit breaker (`lien-resolve.sh`) fails resolution
 * BEFORE `lien annotate` is ever invoked, so a never-suppress file vanished
 * completely silently (exit 0, no stdout) for the whole cooldown window.
 * Fixed by surfacing the degraded state itself — once per session, not per
 * file — via the same `additionalContext` channel a real annotation uses,
 * with no extra npx round-trip (the notice fires without ever invoking
 * `LIEN_CMD`).
 *
 * #1033: a genuinely trivial/below-floor file (empty `lien annotate`
 * output) used to skip the touchfile write entirely — it lived after the
 * "stay silent" early-return — so every read of that file re-spawned the
 * full `lien annotate` subprocess with zero amortization all session long.
 * Fixed by writing the touchfile ('0') before that early-return.
 *
 * `lien` (and, for the breaker suite, `npx`) are stubbed on PATH; real `jq`
 * is used throughout. Payloads use the real PostToolUse stdin shape
 * (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `tool_name`,
 * `tool_input`, `tool_response`) per docs/architecture/blast-radius-nudge.md.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  utimesSync,
  existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const HOOK = fileURLToPath(
  new URL('../../../plugins/claude/hooks/annotate-read.sh', import.meta.url),
);

/** Same hash annotate-read.sh computes: md5(file_path) truncated to 8 hex chars. */
function touchfileHash(filePath: string): string {
  return crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8);
}

function touchfilePath(storeDir: string, sessionId: string, filePath: string): string {
  return path.join(storeDir, 'annotated-sessions', sessionId, touchfileHash(filePath));
}

/** Real PostToolUse:Read stdin shape (see docs/architecture/blast-radius-nudge.md). */
const readPayload = (filePath: string, sessionId: string, cwd: string) => ({
  session_id: sessionId,
  transcript_path: '/tmp/fake-transcript.jsonl',
  cwd,
  hook_event_name: 'PostToolUse',
  tool_name: 'Read',
  tool_input: { file_path: filePath },
  tool_response: { type: 'text', file: { filePath, content: '// fixture' } },
});

function additionalContext(stdout: string): string | null {
  if (stdout === '') return null;
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: unknown } };
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  return typeof ctx === 'string' ? ctx : null;
}

describe('annotate-read.sh — HOOKS-12: never-suppress carve-out vs LIEN_ANNOTATE_GUARD', () => {
  let shimDir: string;
  let hookPath: string;
  let storeDir: string;
  let callLog: string;

  beforeAll(() => {
    shimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-annotate-hook-shim-'));
    // `lien` shim:
    //   path --store        -> $STORE_DIR
    //   path --extensions   -> "ts" (so a.ts always passes the extension filter)
    //   annotate <file> ... -> logs a call, prints $ANNOTATION_TEXT, exits $ANNOTATION_EXIT
    //   nudge ...           -> no-op
    const shim = path.join(shimDir, 'lien');
    writeFileSync(
      shim,
      [
        '#!/usr/bin/env bash',
        'if [ "$1" = "path" ] && [ "$2" = "--store" ]; then printf \'%s\' "$STORE_DIR"; exit 0; fi',
        'if [ "$1" = "path" ] && [ "$2" = "--extensions" ]; then printf \'ts\\n\'; exit 0; fi',
        'if [ "$1" = "annotate" ]; then',
        '  echo call >> "$CALL_LOG"',
        '  printf \'%s\' "$ANNOTATION_TEXT"',
        '  exit "${ANNOTATION_EXIT:-0}"',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
      'utf-8',
    );
    chmodSync(shim, 0o755);
    hookPath = `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`;
  });

  afterAll(() => {
    rmSync(shimDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    storeDir = mkdtempSync(path.join(os.tmpdir(), 'lien-annotate-hook-store-'));
    callLog = path.join(storeDir, 'call.log');
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  function callCount(): number {
    try {
      return readFileSync(callLog, 'utf-8')
        .split('\n')
        .filter(l => l.length > 0).length;
    } catch {
      return 0;
    }
  }

  function runHook(
    filePath: string,
    sessionId: string,
    opts: {
      annotationText?: string;
      annotationExit?: number;
      extraEnv?: Record<string, string>;
    } = {},
  ): { stdout: string; status: number | null } {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify(readPayload(filePath, sessionId, shimDir)),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: hookPath,
        STORE_DIR: storeDir,
        CALL_LOG: callLog,
        ANNOTATION_TEXT: opts.annotationText ?? '',
        ANNOTATION_EXIT: String(opts.annotationExit ?? 0),
        ...opts.extraEnv,
      },
    });
    return { stdout: res.stdout.trim(), status: res.status };
  }

  /** Pre-seed a touchfile directly, bypassing a real hook run, for deterministic mtime control. */
  function seedTouchfile(sessionId: string, filePath: string, content: '0' | '1', ageMinutes = 0) {
    const tf = touchfilePath(storeDir, sessionId, filePath);
    mkdirSync(path.dirname(tf), { recursive: true });
    writeFileSync(tf, content, 'utf-8');
    if (ageMinutes > 0) {
      const past = new Date(Date.now() - ageMinutes * 60_000);
      utimesSync(tf, past, past);
    }
  }

  describe('end-to-end regression (real first + second read, no pre-seeding)', () => {
    it('guard=off: a never-suppress file (annotate exits 2) still re-emits on an immediate second read', () => {
      const text =
        '⚠ Lien: complexFn cyclomatic 19/15 — avoid adding complexity here; prefer extraction.';
      const first = runHook('complex.ts', 's1', {
        annotationText: text,
        annotationExit: 2,
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(additionalContext(first.stdout)).toBe(text);
      expect(callCount()).toBe(1);
      expect(readFileSync(touchfilePath(storeDir, 's1', 'complex.ts'), 'utf-8')).toBe('1');

      // Immediate second read, well inside the default 5-minute TTL window.
      // Before the fix: guard=off's mtime-only check would suppress this
      // silently (exit 0, no stdout, no second `annotate` invocation).
      const second = runHook('complex.ts', 's1', {
        annotationText: text,
        annotationExit: 2,
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(additionalContext(second.stdout)).toBe(text);
      expect(second.status).toBe(0);
      expect(callCount()).toBe(2); // the money assertion: annotate ran again
    });

    it('guard=off: an ORDINARY file (annotate exits 0) is still TTL-suppressed on an immediate second read (unaffected)', () => {
      const first = runHook('plain.ts', 's1', {
        annotationText: 'Lien impact for plain.ts:\n  • Test coverage: some.test.ts.',
        annotationExit: 0,
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(additionalContext(first.stdout)).not.toBeNull();
      expect(callCount()).toBe(1);
      expect(readFileSync(touchfilePath(storeDir, 's1', 'plain.ts'), 'utf-8')).toBe('0');

      const second = runHook('plain.ts', 's1', {
        annotationText: 'Lien impact for plain.ts:\n  • Test coverage: some.test.ts.',
        annotationExit: 0,
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(second.stdout).toBe('');
      expect(callCount()).toBe(1); // suppressed — legacy TTL behavior intact
    });
  });

  describe('pre-seeded touchfile (deterministic mtime control)', () => {
    it('guard=off + never-suppress content, fresh mtime: still emits (the HOOKS-12 fix)', () => {
      seedTouchfile('s1', 'a.ts', '1', 0);
      const { stdout } = runHook('a.ts', 's1', {
        annotationText: 'fresh annotation',
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(additionalContext(stdout)).toBe('fresh annotation');
      expect(callCount()).toBe(1);
    });

    it('guard=off + ordinary content, mtime OLDER than the TTL: legacy re-annotation still fires', () => {
      seedTouchfile('s1', 'a.ts', '0', 10); // 10 min old, default TTL is 5 min
      const { stdout } = runHook('a.ts', 's1', {
        annotationText: 'stale-ttl reannotation',
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(additionalContext(stdout)).toBe('stale-ttl reannotation');
      expect(callCount()).toBe(1);
    });

    it('guard=off + ordinary content, mtime WITHIN the TTL: suppressed (legacy behavior intact)', () => {
      seedTouchfile('s1', 'a.ts', '0', 0);
      const { stdout } = runHook('a.ts', 's1', {
        annotationText: 'should not appear',
        extraEnv: { LIEN_ANNOTATE_GUARD: 'off' },
      });
      expect(stdout).toBe('');
      expect(callCount()).toBe(0);
    });

    it('guard=on (default) + never-suppress content: always re-emits regardless of mtime (sanity)', () => {
      seedTouchfile('s1', 'a.ts', '1', 60); // an hour old — irrelevant under guard=on
      const { stdout } = runHook('a.ts', 's1', { annotationText: 'guard-on never-suppress' });
      expect(additionalContext(stdout)).toBe('guard-on never-suppress');
      expect(callCount()).toBe(1);
    });

    it('guard=on (default) + ordinary content: stays suppressed regardless of mtime (sanity)', () => {
      seedTouchfile('s1', 'a.ts', '0', 60);
      const { stdout } = runHook('a.ts', 's1', { annotationText: 'should not appear' });
      expect(stdout).toBe('');
      expect(callCount()).toBe(0);
    });
  });

  it('a different, never-seen file in the same session still emits (per-file, not per-session, suppression)', () => {
    seedTouchfile('s1', 'a.ts', '0', 0);
    const { stdout } = runHook('b.ts', 's1', { annotationText: 'b.ts annotation' });
    expect(additionalContext(stdout)).toBe('b.ts annotation');
  });

  describe('#1033: a trivial/below-floor file (empty annotate output) amortizes too', () => {
    it('stays silent on both reads but only spawns `annotate` ONCE — the touchfile write happens even when output is empty', () => {
      // ANNOTATION_TEXT defaults to '' — simulates isTrivial/belowRiskFloor
      // suppressing the whole annotation (a real trivial/low-risk file).
      const first = runHook('trivial.ts', 's1', { annotationExit: 0 });
      expect(first.stdout).toBe('');
      expect(callCount()).toBe(1);
      // Before the fix: no touchfile was ever written for this path, so this
      // directory either wouldn't exist or would be empty.
      expect(readFileSync(touchfilePath(storeDir, 's1', 'trivial.ts'), 'utf-8')).toBe('0');

      const second = runHook('trivial.ts', 's1', { annotationExit: 0 });
      expect(second.stdout).toBe('');
      // The money assertion: before the fix this would be 2 — every read of
      // a trivial file re-spawned `annotate` for the rest of the session.
      expect(callCount()).toBe(1);

      const third = runHook('trivial.ts', 's1', { annotationExit: 0 });
      expect(third.stdout).toBe('');
      expect(callCount()).toBe(1);
    });

    it('a genuinely trivial file cannot produce a never-suppress touchfile (exit 2 implies non-empty output, never reached here)', () => {
      // Defensive/documentation test: hasNeverSuppressSignal-driven exit 2 is
      // only ever paired with real (non-empty) output in the real CLI, so
      // the '0' written above is always the correct, safe default for the
      // empty-output path — there is no way for a trivial read to need '1'.
      runHook('trivial.ts', 's1', { annotationExit: 0 });
      expect(readFileSync(touchfilePath(storeDir, 's1', 'trivial.ts'), 'utf-8')).not.toBe('1');
    });
  });
});

describe('annotate-read.sh — HOOKS-6: npx circuit breaker no longer fails silently', () => {
  let breakerShimDir: string;
  let minimalPath: string;
  let breakerDir: string;
  let npxCallLog: string;

  beforeAll(() => {
    // A PATH with ONLY a fake `npx` (no `lien` at all, real or shim) plus the
    // bare minimum system dirs a real `lien`/`npx` on this dev machine would
    // never live in (both are typically under nvm/homebrew bin dirs) — so
    // `command -v lien` in lien-resolve.sh reliably fails and falls through
    // to the npx/breaker branch regardless of what's globally installed.
    breakerShimDir = mkdtempSync(path.join(os.tmpdir(), 'lien-breaker-hook-shim-'));
    npxCallLog = path.join(breakerShimDir, 'npx-calls.log');
    const npxShim = path.join(breakerShimDir, 'npx');
    writeFileSync(npxShim, `#!/usr/bin/env bash\necho "$@" >> "${npxCallLog}"\nexit 0\n`, 'utf-8');
    chmodSync(npxShim, 0o755);
    minimalPath = `${breakerShimDir}:/usr/bin:/bin:/sbin`;
  });

  afterAll(() => {
    rmSync(breakerShimDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    breakerDir = mkdtempSync(path.join(os.tmpdir(), 'lien-breaker-state-'));
    writeFileSync(npxCallLog, '', 'utf-8');
  });

  afterEach(() => {
    rmSync(breakerDir, { recursive: true, force: true });
  });

  function npxCallCount(): number {
    return readFileSync(npxCallLog, 'utf-8')
      .split('\n')
      .filter(l => l.length > 0).length;
  }

  function runHook(
    filePath: string,
    sessionId: string,
    extraEnv: Record<string, string> = {},
  ): { stdout: string; status: number | null } {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify(readPayload(filePath, sessionId, breakerShimDir)),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: minimalPath,
        LIEN_NPX_BREAKER_MARKER: path.join(breakerDir, 'inflight'),
        ...extraEnv,
      },
    });
    return { stdout: res.stdout.trim(), status: res.status };
  }

  it('breaker already open: emits a one-time degraded notice instead of a silent exit-0, with zero npx invocations', () => {
    const untilMarker = path.join(breakerDir, 'breaker-open-until');
    writeFileSync(untilMarker, String(Math.floor(Date.now() / 1000) + 300), 'utf-8');

    const { stdout, status } = runHook('complex.ts', 's1', {
      LIEN_NPX_BREAKER_UNTIL_MARKER: untilMarker,
    });
    expect(status).toBe(0);
    const ctx = additionalContext(stdout);
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('Lien unavailable');
    expect(ctx).toContain('breaker');
    // The money assertion for "no 4x npx round-trip cost": npx was never invoked.
    expect(npxCallCount()).toBe(0);
    // And the notice marker was actually written (for the once-per-session gate below).
    expect(existsSync(path.join(breakerDir, 'notice-shown', 's1'))).toBe(true);
  });

  it('same session, second Read while breaker is still open: silent (notice already shown once)', () => {
    const untilMarker = path.join(breakerDir, 'breaker-open-until');
    writeFileSync(untilMarker, String(Math.floor(Date.now() / 1000) + 300), 'utf-8');
    const env = { LIEN_NPX_BREAKER_UNTIL_MARKER: untilMarker };

    const first = runHook('complex.ts', 's1', env);
    expect(additionalContext(first.stdout)).not.toBeNull();

    const second = runHook('other.ts', 's1', env); // even a different file — notice is session-scoped, not file-scoped
    expect(second.stdout).toBe('');
    expect(second.status).toBe(0);
    expect(npxCallCount()).toBe(0);
  });

  it('a different session while breaker is still open: notice shown again (once PER SESSION, not once ever)', () => {
    const untilMarker = path.join(breakerDir, 'breaker-open-until');
    writeFileSync(untilMarker, String(Math.floor(Date.now() / 1000) + 300), 'utf-8');
    const env = { LIEN_NPX_BREAKER_UNTIL_MARKER: untilMarker };

    const first = runHook('complex.ts', 's1', env);
    expect(additionalContext(first.stdout)).not.toBeNull();

    const secondSession = runHook('complex.ts', 's2', env);
    expect(additionalContext(secondSession.stdout)).not.toBeNull();
  });

  it('breaker trips THIS call (stale in-flight marker, no until-marker yet): still surfaces the notice, not a silent exit-0', () => {
    const marker = path.join(breakerDir, 'inflight');
    mkdirSync(breakerDir, { recursive: true });
    // A marker older than the default 7s stale threshold — the fingerprint
    // of a prior call that was SIGKILLed mid-flight.
    writeFileSync(marker, String(Math.floor(Date.now() / 1000) - 100), 'utf-8');

    const { stdout, status } = runHook('complex.ts', 's1', {
      LIEN_NPX_BREAKER_MARKER: marker,
    });
    expect(status).toBe(0);
    expect(additionalContext(stdout)).toContain('Lien unavailable');
    expect(npxCallCount()).toBe(0);
    // Side effect confirms real integration with lien-resolve.sh, not a
    // shortcut: the breaker really did open for the next 300s.
    expect(existsSync(path.join(breakerDir, 'breaker-open-until'))).toBe(true);
    expect(existsSync(marker)).toBe(false); // stale marker consumed
  });

  it('LIEN_NPX_BREAKER=off: bypasses the breaker entirely (real npx path), no notice logic involved', () => {
    // With the breaker disabled, lien-resolve.sh sets LIEN_CMD to a direct
    // npx invocation — our npx shim then actually runs (and "succeeds" by
    // printing nothing), so annotate-read.sh proceeds normally rather than
    // hitting the breaker-open branch at all.
    const { status } = runHook('complex.ts', 's1', { LIEN_NPX_BREAKER: 'off' });
    expect(status).toBe(0);
    expect(npxCallCount()).toBeGreaterThan(0);
  });
});
