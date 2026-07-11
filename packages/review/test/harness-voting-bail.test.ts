/**
 * Unit tests for the `--bail N` early-abort dispatch in the harness voting
 * layer. `runVotesWithBail` takes a vote thunk, so the abort logic is testable
 * with fake fast/slow/failing vote fns and zero LLM spend.
 *
 * The invariants under test:
 *  - No `bail` → every vote dispatches (byte-identical to the prior Promise.all
 *    path), aborted:false.
 *  - `bail` → votes run in waves; once cumulative failures reach `bail`,
 *    dispatch stops and `aborted` is true iff votes were left unrun.
 *  - A wave in flight always finishes before the bail check — a slow failing
 *    vote still counts toward the threshold.
 */
import { describe, it, expect } from 'vitest';
import { runVotesWithBail, BAIL_WAVE_SIZE } from './harness/voting.js';
import type { AssertedRun } from './harness/voting.js';

function fakeRun(passed: boolean): AssertedRun {
  return { result: { findings: [], toolCalls: [], turns: 0 }, cost: 0, passed };
}

/** A vote thunk that returns the next scripted outcome and counts invocations. */
function sequencedVoteFn(outcomes: boolean[]): {
  voteFn: () => Promise<AssertedRun>;
  calls: () => number;
} {
  let i = 0;
  return {
    voteFn: () => Promise.resolve(fakeRun(outcomes[i++])),
    calls: () => i,
  };
}

describe('runVotesWithBail — default (no bail)', () => {
  it('dispatches every vote and never aborts', async () => {
    const { voteFn, calls } = sequencedVoteFn([true, false, true, false, true]);
    const { runs, aborted } = await runVotesWithBail(voteFn, 5);
    expect(runs).toHaveLength(5);
    expect(calls()).toBe(5);
    expect(aborted).toBe(false);
  });

  it('does not abort even when most votes fail', async () => {
    const { voteFn } = sequencedVoteFn([false, false, false, false]);
    const { runs, aborted } = await runVotesWithBail(voteFn, 4);
    expect(runs).toHaveLength(4);
    expect(aborted).toBe(false);
  });
});

describe('runVotesWithBail — with bail', () => {
  it('aborts after the wave in which the Nth failure lands', async () => {
    // waveSize 3, bail 2: wave 1 = [fail, fail, pass] → 2 failures → abort with
    // 7 of 10 votes never dispatched.
    const { voteFn, calls } = sequencedVoteFn([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    const { runs, aborted } = await runVotesWithBail(voteFn, 10, 2, 3);
    expect(runs).toHaveLength(3);
    expect(calls()).toBe(3); // remaining 7 never dispatched
    expect(aborted).toBe(true);
    expect(runs.filter(r => !r.passed)).toHaveLength(2);
  });

  it('does not abort when the Nth failure lands in the final wave (nothing left to skip)', async () => {
    // count 3, waveSize 3, bail 2: one wave of [pass, fail, fail]. Failures hit
    // the threshold but every requested vote already ran → not aborted.
    const { voteFn } = sequencedVoteFn([true, false, false]);
    const { runs, aborted } = await runVotesWithBail(voteFn, 3, 2, 3);
    expect(runs).toHaveLength(3);
    expect(aborted).toBe(false);
  });

  it('runs all votes when failures never reach the bail threshold', async () => {
    const { voteFn, calls } = sequencedVoteFn([true, false, true, true, true, true]);
    const { runs, aborted } = await runVotesWithBail(voteFn, 6, 3, 3);
    expect(runs).toHaveLength(6);
    expect(calls()).toBe(6);
    expect(aborted).toBe(false);
  });

  it('waits for a slow failing vote within a wave before deciding to bail', async () => {
    // The 2nd vote is slow AND failing. The bail check runs only after the wave's
    // Promise.all settles, so the slow failure must count — proving waves await
    // in full rather than racing the abort.
    const delays = [1, 25, 1, 1, 1, 1];
    const passed = [true, false, true, true, true, true];
    let i = 0;
    const voteFn = (): Promise<AssertedRun> => {
      const idx = i++;
      return new Promise(res => setTimeout(() => res(fakeRun(passed[idx])), delays[idx]));
    };
    const { runs, aborted } = await runVotesWithBail(voteFn, 6, 1, 3);
    expect(runs).toHaveLength(3); // first wave of 3 contained the slow failure
    expect(aborted).toBe(true);
    expect(runs.filter(r => !r.passed)).toHaveLength(1);
  });

  it('exposes a small default wave size', () => {
    expect(BAIL_WAVE_SIZE).toBe(3);
  });
});
