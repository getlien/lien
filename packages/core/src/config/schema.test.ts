import { describe, it, expect } from 'vitest';
import { DEFAULT_COMPLEXITY_THRESHOLDS } from '@liendev/parser';
import { defaultConfig } from './schema.js';

describe('defaultConfig.complexity.thresholds', () => {
  it('equals the canonical DEFAULT_COMPLEXITY_THRESHOLDS (#988: no independent copy)', () => {
    // `defaultConfig` is the USER-FACING default that `ConfigService.load()`
    // returns whenever a project has no `.lien.config.json`, and that
    // `lien delta` (packages/cli/src/cli/delta-cmd.ts) ultimately gates on.
    // This file used to hardcode its own literal
    // `{ testPaths: 15, mentalLoad: 15, timeToUnderstandMinutes: 60, estimatedBugs: 1.5 }`
    // with nothing enforcing agreement with the other three copies (#988). A
    // drift here would mean the config a user believes they have (or the
    // default they never overrode) silently diverges from what `lien delta`
    // actually enforces. This test fails the moment that stops being true.
    expect(defaultConfig.complexity?.thresholds).toEqual(DEFAULT_COMPLEXITY_THRESHOLDS);
  });
});
