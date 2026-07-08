import { describe, it, expect } from 'vitest';
import { PARSE_STAGE_MAX_CONCURRENCY, getParseStageConcurrency } from './constants.js';

describe('getParseStageConcurrency', () => {
  it('caps a configured concurrency above the ceiling down to the ceiling', () => {
    // The validated indexing.concurrency/core.concurrency range tops out at 16
    // (packages/core/src/config/service.ts) — this is the exact ADR-013
    // scenario that measured ~1.55GB peak RSS.
    expect(getParseStageConcurrency(16)).toBe(PARSE_STAGE_MAX_CONCURRENCY);
  });

  it('passes through a configured concurrency below the ceiling unchanged', () => {
    // The cap must never raise concurrency — only clamp it down.
    expect(getParseStageConcurrency(2)).toBe(2);
    expect(getParseStageConcurrency(1)).toBe(1);
  });

  it('passes through a configured concurrency equal to the ceiling unchanged', () => {
    expect(getParseStageConcurrency(PARSE_STAGE_MAX_CONCURRENCY)).toBe(PARSE_STAGE_MAX_CONCURRENCY);
  });

  it('exposes the ceiling as 4, matching the ADR-013 Phase 0 measurement', () => {
    expect(PARSE_STAGE_MAX_CONCURRENCY).toBe(4);
  });
});
