import { describe, it, expect } from 'vitest';
import { SuppressionTracker } from './annotate-daemon.js';

describe('SuppressionTracker', () => {
  it('records and returns true within the TTL', () => {
    const t = new SuppressionTracker(1000);
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(false);
    t.record('s1', 'foo.ts');
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(true);
  });

  it('expires entries past the TTL and reports unsuppressed', () => {
    let nowMs = 0;
    const t = new SuppressionTracker(100, () => nowMs);
    t.record('s1', 'foo.ts');
    nowMs = 50;
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(true);
    nowMs = 200;
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(false);
    // After a hit-expiry check, the next record should re-suppress.
    t.record('s1', 'foo.ts');
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(true);
  });

  it('isolates suppression state per session', () => {
    const t = new SuppressionTracker(1000);
    t.record('s1', 'foo.ts');
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(true);
    expect(t.isSuppressed('s2', 'foo.ts')).toBe(false);
  });

  it('isolates suppression state per file within a session', () => {
    const t = new SuppressionTracker(1000);
    t.record('s1', 'foo.ts');
    expect(t.isSuppressed('s1', 'foo.ts')).toBe(true);
    expect(t.isSuppressed('s1', 'bar.ts')).toBe(false);
  });
});
