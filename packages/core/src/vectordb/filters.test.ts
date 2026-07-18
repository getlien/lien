import { describe, it, expect } from 'vitest';
import { matchesSymbolFilter, type FilterableRecord } from './filters.js';

function record(extra: Partial<FilterableRecord> = {}): FilterableRecord {
  return {
    file: 'src/foo.ts',
    language: 'typescript',
    type: 'function',
    symbolName: 'doThing',
    ...extra,
  };
}

describe('matchesSymbolFilter', () => {
  it('matches a plain code record with a symbolName', () => {
    expect(matchesSymbolFilter(record(), {})).toBe(true);
  });

  it('excludes markdown "doc" chunks: prose breadcrumbs are not code symbols', () => {
    expect(matchesSymbolFilter(record({ type: 'doc', symbolName: 'Guide > Install' }), {})).toBe(
      false,
    );
  });

  it('excludes YAML "config" chunks: key-path breadcrumbs are not code symbols', () => {
    expect(matchesSymbolFilter(record({ type: 'config', symbolName: 'jobs.review' }), {})).toBe(
      false,
    );
  });
});
