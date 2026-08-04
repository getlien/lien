import { describe, it, expect } from 'vitest';
import {
  applyDependentCountHonesty,
  DEPENDENT_COUNTS_NOT_COMPUTED_NOTE,
} from './dependent-count-honesty.js';
import type { ToolResult } from './metadata-shaper.js';

/** A shaped `search_code` result for `file`, carrying `dependentCount`. */
function shaped(file: string, dependentCount?: number): ToolResult {
  return {
    content: 'code',
    metadata: {
      file,
      startLine: 1,
      endLine: 5,
      ...(dependentCount === undefined ? {} : { dependentCount }),
    },
    score: 0.4,
    relevance: 'relevant',
  };
}

/** True when the key is genuinely absent, not merely `undefined`-valued. */
function hasCount(result: ToolResult): boolean {
  return Object.prototype.hasOwnProperty.call(result.metadata, 'dependentCount');
}

describe('applyDependentCountHonesty (#1072)', () => {
  describe('case 1 — a genuine resolved zero acquires nothing (the negative control)', () => {
    it('keeps a zero count on a language with no attribution blind spot', () => {
      const out = applyDependentCountHonesty([shaped('src/orphan.ts', 0)], true);

      expect(out.results[0].metadata.dependentCount).toBe(0);
      expect(out.note).toBeUndefined();
    });

    it.each([
      ['typescript', 'src/a.ts'],
      ['python', 'pkg/a.py'],
      ['go', 'internal/a.go'],
      ['rust', 'src/a.rs'],
      ['php', 'src/A.php'],
      ['ruby', 'lib/a.rb'],
      ['javascript', 'src/a.js'],
    ])('%s: a zero survives untouched and silent', (_language, file) => {
      const out = applyDependentCountHonesty([shaped(file, 0)], true);

      expect(out.results[0].metadata.dependentCount).toBe(0);
      expect(out.note).toBeUndefined();
    });

    it('returns results structurally unchanged when nothing needs hedging', () => {
      const input = [shaped('src/a.ts', 3), shaped('src/b.ts', 0)];

      const out = applyDependentCountHonesty(input, true);

      expect(out.results).toEqual(input);
    });
  });

  describe('case 2 — a zero in a blind-spot language is omitted, silently', () => {
    it.each([
      ['csharp', 'src/Widget.cs'],
      ['java', 'src/main/java/com/example/Widget.java'],
      ['kotlin', 'src/main/kotlin/com/example/Widget.kt'],
      ['swift', 'Sources/Widget.swift'],
    ])('%s: drops the key entirely rather than reporting 0', (_language, file) => {
      const out = applyDependentCountHonesty([shaped(file, 0)], true);

      expect(hasCount(out.results[0])).toBe(false);
      // No note: a response-level warning here would fire on most searches in
      // four whole languages, which is exactly #1014's shape.
      expect(out.note).toBeUndefined();
    });

    it.each([
      ['csharp', 'src/Widget.cs'],
      ['java', 'src/main/java/com/example/Widget.java'],
      ['kotlin', 'src/main/kotlin/com/example/Widget.kt'],
      ['swift', 'Sources/Widget.swift'],
    ])('%s: KEEPS a positive count — a real recovered floor, not a guess', (_language, file) => {
      const out = applyDependentCountHonesty([shaped(file, 7)], true);

      expect(out.results[0].metadata.dependentCount).toBe(7);
      expect(out.note).toBeUndefined();
    });

    it('decides per result, not per response', () => {
      const out = applyDependentCountHonesty(
        [shaped('Sources/Widget.swift', 0), shaped('src/util.ts', 0), shaped('src/Api.cs', 2)],
        true,
      );

      expect(hasCount(out.results[0])).toBe(false);
      expect(out.results[1].metadata.dependentCount).toBe(0);
      expect(out.results[2].metadata.dependentCount).toBe(2);
      expect(out.note).toBeUndefined();
    });

    it('leaves the input array untouched (returns copies, never mutates)', () => {
      const input = [shaped('Sources/Widget.swift', 0)];

      applyDependentCountHonesty(input, true);

      expect(input[0].metadata.dependentCount).toBe(0);
    });

    it('leaves a file of no AST-supported language alone', () => {
      // `detectLanguage` returns null; there is no language fact to gate on, so
      // the honest move is to change nothing.
      const out = applyDependentCountHonesty([shaped('README.md', 0)], true);

      expect(out.results[0].metadata.dependentCount).toBe(0);
      expect(out.note).toBeUndefined();
    });
  });

  describe('case 3 — counts never computed for this store', () => {
    it('omits every count and returns exactly one response-level note', () => {
      const out = applyDependentCountHonesty(
        [shaped('src/a.ts', 0), shaped('src/b.ts', 0), shaped('Sources/C.swift', 0)],
        false,
      );

      expect(out.results.every(r => !hasCount(r))).toBe(true);
      expect(out.note).toBe(DEPENDENT_COUNTS_NOT_COMPUTED_NOTE);
    });

    it('omits even a POSITIVE count — a stale table can still hold rows', () => {
      // `hasDependentCounts()` is answered from stored state, so `false` here
      // means "these numbers are not this corpus's numbers" regardless of what
      // they say. Trusting a positive value would be trusting the shape again.
      const out = applyDependentCountHonesty([shaped('src/a.ts', 9)], false);

      expect(hasCount(out.results[0])).toBe(false);
      expect(out.note).toBe(DEPENDENT_COUNTS_NOT_COMPUTED_NOTE);
    });

    it('names the fix, so the note is actionable and self-clearing', () => {
      expect(DEPENDENT_COUNTS_NOT_COMPUTED_NOTE).toContain('⚠ Lien:');
      expect(DEPENDENT_COUNTS_NOT_COMPUTED_NOTE).toContain('lien index');
    });
  });

  describe('never speaks about a field that was never there', () => {
    it('adds no note for an empty result set', () => {
      expect(applyDependentCountHonesty([], false)).toEqual({ results: [] });
      expect(applyDependentCountHonesty([], true)).toEqual({ results: [] });
    });

    it('adds no note when no result carries dependentCount at all', () => {
      const input = [shaped('src/a.ts'), shaped('src/b.ts')];

      expect(applyDependentCountHonesty(input, false)).toEqual({ results: input });
      expect(applyDependentCountHonesty(input, true)).toEqual({ results: input });
    });
  });
});
