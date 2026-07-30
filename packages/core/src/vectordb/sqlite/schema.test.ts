import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import Database from 'better-sqlite3';
import { createTestDir, cleanupTestDir } from '../../test/helpers/test-db.js';
import { openDatabase, withOpenRetry } from './schema.js';

/** A `better-sqlite3`-shaped error: `SqliteError` sets `.code`, not a message
 *  prefix, so that's what production code (and this mock) must match on. */
function sqliteError(code: string): Error & { code: string } {
  const err = new Error(`simulated ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

describe('openDatabase', () => {
  it('sets busy_timeout before journal_mode/synchronous', async () => {
    // Regression test for the actual root cause of a reproduced MCP-server
    // crash: several `lien serve` processes racing to create/open the SAME
    // brand-new index file threw an uncaught `SQLITE_BUSY: database is
    // locked` — because busy_timeout was applied AFTER journal_mode, so it
    // wasn't yet in effect for the pragma calls that could hit lock
    // contention. Asserting call ORDER (not just final pragma state) is what
    // actually locks the fix in — a reorder regression wouldn't otherwise be
    // visible from the pragma's steady-state value.
    const dir = await createTestDir();
    try {
      const dbFilePath = path.join(dir, 'structural.db');
      const calls: string[] = [];
      const originalPragma = Database.prototype.pragma;

      (Database.prototype as any).pragma = function (source: string, ...rest: unknown[]) {
        calls.push(source);

        return (originalPragma as any).apply(this, [source, ...rest]);
      };

      let db;
      try {
        db = openDatabase(dbFilePath);
      } finally {
        Database.prototype.pragma = originalPragma;
      }
      db.close();

      expect(calls[0]).toBe('busy_timeout = 5000');
      expect(calls).toEqual(['busy_timeout = 5000', 'journal_mode = WAL', 'synchronous = NORMAL']);
    } finally {
      await cleanupTestDir(dir);
    }
  });
});

describe('withOpenRetry', () => {
  it('returns the result immediately when open succeeds on the first try', async () => {
    const open = vi.fn(() => 'db-handle');
    await expect(withOpenRetry(open)).resolves.toBe('db-handle');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('retries past transient SQLite open errors and eventually succeeds', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const codes = ['SQLITE_BUSY', 'SQLITE_IOERR', 'SQLITE_CANTOPEN'];
      const open = vi.fn(() => {
        calls += 1;
        if (calls <= codes.length) throw sqliteError(codes[calls - 1]);
        return 'db-handle';
      });

      const resultPromise = withOpenRetry(open);
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('db-handle');
      expect(open).toHaveBeenCalledTimes(codes.length + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a non-transient error', async () => {
    const err = new Error('permission denied');
    const open = vi.fn(() => {
      throw err;
    });
    await expect(withOpenRetry(open)).rejects.toBe(err);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('gives up and rethrows the last error after exhausting all attempts', async () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn(() => {
        throw sqliteError('SQLITE_BUSY');
      });

      const resultPromise = withOpenRetry(open);
      // Attach a rejection handler immediately so draining fake timers below
      // doesn't trigger an unhandled-rejection warning before the final
      // `await expect(...).rejects...` attaches its own handler.
      const settled = resultPromise.catch((error: unknown) => ({ error }));
      await vi.runAllTimersAsync();

      const outcome = await settled;
      expect(outcome).toHaveProperty('error');
      expect((outcome as { error: unknown }).error).toMatchObject({ code: 'SQLITE_BUSY' });
      // Bounded attempts, not silently-infinite retry.
      expect(open.mock.calls.length).toBeGreaterThan(1);
      expect(open.mock.calls.length).toBeLessThan(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the worst-case (max jitter) total retry wait well under the 5000ms hook timeout', async () => {
    // plugins/claude/hooks/hooks.json gives every hook a 5000ms timeout, and
    // several hooks (annotate-read, augment-explore-task, api-delta-write)
    // invoke a `lien` command that runs through this exact ladder
    // (createVectorDB().initialize() -> openConnection -> withOpenRetry). If
    // the ladder's own worst-case wait approaches that ceiling, Claude Code
    // SIGKILLs the hook process mid-retry — a failure lien-npx-breaker.sh
    // cannot distinguish from a hung npm registry, since both leave the same
    // stale in-flight marker. That trips the breaker and silences every
    // nudge for its 300s cooldown. This asserts the REAL computed worst
    // case (recording every delay actually requested, under forced maximum
    // jitter), not the doc comment's claim, so a future constant change that
    // drifts back toward the hook timeout fails loudly here.
    const originalRandom = Math.random;
    const originalSetTimeout = global.setTimeout;
    const delays: number[] = [];
    Math.random = () => 1; // forces the max +30% jitter on every backoff

    (global as any).setTimeout = (fn: (...args: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0); // record the ask; don't actually wait
    };

    try {
      const open = vi.fn(() => {
        throw sqliteError('SQLITE_BUSY');
      });
      await expect(withOpenRetry(open)).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
    } finally {
      Math.random = originalRandom;
      global.setTimeout = originalSetTimeout;
    }

    const worstCaseTotalMs = delays.reduce((sum, d) => sum + d, 0);
    const HOOK_TIMEOUT_MS = 5000;
    // Real headroom for actual open work + bash/npx/node overhead, not a
    // near-miss of the timeout. The budget was tuned to leave ~1.1s of
    // headroom (computed worst case ~3904ms) — see the OPEN_RETRY_ATTEMPTS
    // doc comment for why it isn't larger: a longer ladder measurably
    // improves reliability at higher concurrency, but ~1s of headroom is
    // judged the minimum safe margin given hooks already take 200-600ms in
    // normal operation (lien-npx-breaker.sh), so this only leaves room to
    // grow the budget, not shrink the margin further.
    expect(worstCaseTotalMs).toBeLessThan(HOOK_TIMEOUT_MS - 1000);
    // Still meaningfully retrying (this budget wasn't gutted to make the
    // ceiling trivially true).
    expect(delays.length).toBeGreaterThan(5);
  });
});
