import { describe, it, expect } from 'vitest';
import { matchesSymbolFilter, filterBySymbolType, type FilterableRecord } from './filters.js';

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

describe('filterBySymbolType (#1005 Phase 3 Item B: Java annotation declarations)', () => {
  // `filterBySymbolType` reads `symbolType` directly; `getSymbolsForType`
  // (the function actually backing `get_symbols`-style lookups) reads a
  // SEPARATE `interfaceNames` column instead, populated from
  // `metadata.symbols?.interfaces` (see row-mapping.ts's `chunkToRow`) --
  // an annotation chunk must agree on BOTH, or the two mechanisms disagree
  // about whether the annotation "is" an interface. The Java extractor maps
  // `annotation_type_declaration` to `symbolType: 'interface'`, and
  // `chunker.ts`'s existing `buildLegacySymbols`/`SYMBOL_TYPE_TO_ARRAY`
  // plumbing (already shared by every other `'interface'`-typed symbol)
  // populates `symbols.interfaces` automatically -- no separate code path
  // needed. This test pins that agreement at the `FilterableRecord` layer
  // (the shape row-mapping.ts actually produces), independent of chunker.ts.
  function annotationRecord(): FilterableRecord {
    return {
      file: 'src/main/java/a/b/Foo.java',
      language: 'java',
      type: 'function',
      symbolName: 'Foo',
      symbolType: 'interface',
      interfaceNames: ['Foo'],
    };
  }

  it('filterBySymbolType matches an annotation chunk under "interface" via symbolType', () => {
    const records = [annotationRecord()];
    expect(filterBySymbolType(records, 'interface')).toEqual(records);
  });

  it('filterBySymbolType does NOT match an annotation chunk under "class"', () => {
    const records = [annotationRecord()];
    expect(filterBySymbolType(records, 'class')).toEqual([]);
  });

  it('getSymbolsForType agrees: the annotation name is reachable via interfaceNames, not classNames or functionNames', () => {
    const r = annotationRecord();
    // matchesSymbolFilter accepts a `symbolType` filter option and internally
    // calls the same `getSymbolsForType`/`matchesSymbolType` path
    // `filterBySymbolType`'s callers rely on for symbol-name filtering.
    expect(matchesSymbolFilter(r, { symbolType: 'interface', pattern: 'Foo' })).toBe(true);
    expect(matchesSymbolFilter(r, { symbolType: 'class', pattern: 'Foo' })).toBe(false);
  });
});
