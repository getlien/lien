import { describe, it, expect } from 'vitest';
import { computeDependentCounts, normalizeFileForCounts } from './dependent-counts.js';

function row(file: string, imports: string[]): { file: string; imports: string } {
  return { file, imports: JSON.stringify(imports) };
}

describe('normalizeFileForCounts', () => {
  it('strips extensions and converts backslashes', () => {
    expect(normalizeFileForCounts('src/utils/logger.ts')).toBe('src/utils/logger');
    expect(normalizeFileForCounts('src\\utils\\logger.ts')).toBe('src/utils/logger');
    expect(normalizeFileForCounts('  src/a.py  ')).toBe('src/a');
  });
});

describe('computeDependentCounts', () => {
  it('counts distinct importer files for a relative-import target', () => {
    const rows = [
      row('src/consumers/a.ts', ['../utils/logger']),
      row('src/consumers/b.ts', ['../utils/logger']),
      row('src/utils/logger.ts', []),
    ];
    const counts = computeDependentCounts(rows);
    expect(counts.get('src/utils/logger')).toBe(2);
  });

  it('does not double count multiple imports of the same target from one file', () => {
    const rows = [
      // Duplicate import string from the same importer — shouldn't inflate the count.
      row('src/consumers/a.ts', ['../utils/logger', '../utils/logger']),
      row('src/utils/logger.ts', []),
    ];
    const counts = computeDependentCounts(rows);
    expect(counts.get('src/utils/logger')).toBe(1);
  });

  it('ignores self-imports', () => {
    const rows = [row('src/utils/logger.ts', ['./logger'])];
    const counts = computeDependentCounts(rows);
    expect(counts.get('src/utils/logger')).toBeUndefined();
  });

  it('leaves bare package specifiers unresolved (conservative undercount)', () => {
    const rows = [row('src/a.ts', ['lodash', '@liendev/core'])];
    const counts = computeDependentCounts(rows);
    // Bare specifiers pass through unchanged and won't match any real file
    // path in this fixture — verifies they don't silently attach to 'src/a'.
    expect(counts.get('lodash')).toBe(1);
    expect(counts.get('src/a')).toBeUndefined();
  });

  it('resolves nested relative imports against the importer directory', () => {
    const rows = [row('src/api/routes/users.ts', ['../../db/client']), row('src/db/client.ts', [])];
    const counts = computeDependentCounts(rows);
    expect(counts.get('src/db/client')).toBe(1);
  });

  it('returns an empty map for rows with no imports', () => {
    const rows = [row('src/a.ts', []), { file: 'src/b.ts', imports: null as unknown as string }];
    expect(computeDependentCounts(rows).size).toBe(0);
  });

  it('tolerates malformed imports JSON', () => {
    const rows = [{ file: 'src/a.ts', imports: '{not valid json' }];
    expect(computeDependentCounts(rows).size).toBe(0);
  });
});
