import { describe, it, expect } from 'vitest';
import { extractCitedSpans, verifyCitation, shouldGateFinding } from '../src/citation-gate.js';

describe('extractCitedSpans', () => {
  it('extracts a single backtick-quoted span', () => {
    expect(extractCitedSpans('The hook hardcodes `paths[0:3]` inline.')).toEqual(['paths[0:3]']);
  });

  it('extracts spans from multiple texts (message + evidence)', () => {
    const spans = extractCitedSpans('sees `foo.bar()`', 'evidence cites `baz.qux`');
    expect(spans).toEqual(['foo.bar()', 'baz.qux']);
  });

  it('drops spans shorter than the minimum citation length', () => {
    expect(extractCitedSpans('a bare `x` here')).toEqual([]);
  });

  it('drops CLI-flag-shaped illustrative spans (leading dash)', () => {
    // The untrusted-input rule's own worked example quotes `--votes foo` as a
    // hypothetical malformed CLI arg — never expected to appear verbatim in
    // the file. Treating it as a citation would gate a TRUE finding on an
    // illustrative example alone.
    expect(extractCitedSpans('`--votes foo` produces NaN')).toEqual([]);
  });

  it('drops a dash-prefixed span even with leading whitespace inside the backticks', () => {
    // The dash check runs on the TRIMMED span, so leading whitespace can't
    // smuggle a dash-prefixed illustrative value past the guard: trimming
    // only removes whitespace, it can never remove the leading `-` itself.
    expect(extractCitedSpans('`  --flag` was passed')).toEqual([]);
  });

  it('ignores undefined text arguments', () => {
    expect(extractCitedSpans(undefined, '`realSpan`', undefined)).toEqual(['realSpan']);
  });

  it('returns an empty array when there are no backtick spans at all', () => {
    expect(extractCitedSpans('Plain prose with no code quoted.')).toEqual([]);
  });
});

describe('verifyCitation', () => {
  it('returns "no-citation" when there are no spans to check', () => {
    expect(verifyCitation([], 'any file content')).toBe('no-citation');
  });

  it('returns "unverifiable" when the current file content is unavailable', () => {
    expect(verifyCitation(['foo.bar()'], null)).toBe('unverifiable');
  });

  it('returns "match" when at least one span is found in the current file', () => {
    expect(verifyCitation(['foo.bar()', 'notThere()'], 'const x = foo.bar();')).toBe('match');
  });

  it('returns "mismatch" only when NONE of the spans are found', () => {
    expect(verifyCitation(['gone()', 'alsoGone()'], 'const x = stillHere();')).toBe('mismatch');
  });
});

describe('shouldGateFinding — the #845/#846 shape', () => {
  it('gates a finding whose sole citation quotes code that was removed by the fix', () => {
    // Run A (commit e6337d90): valid finding citing the hardcoded slice.
    const runAFinding = {
      message: 'The hook hardcodes `$paths[0:3]` while MAX_DOC_REF_PATHS is 3 elsewhere.',
    };
    // The fix (commit 7308ff5d) removed the slice entirely.
    const fixedFileContent =
      'paths=$(join_paths "$docRefs")\ncount=$((docRefCount - ${#paths[@]}))';
    expect(shouldGateFinding(runAFinding, fixedFileContent)).toBe(true);
  });

  it('does not gate when the finding has no quoted citation at all', () => {
    const finding = { message: 'This function has an off-by-one error in the loop bound.' };
    expect(shouldGateFinding(finding, 'whatever the current file says')).toBe(false);
  });

  it('does not gate when the citation still matches the current file (region unchanged)', () => {
    const finding = { message: 'Still hardcodes `paths[0:3]` here.' };
    const unchangedFile = 'display=${paths[0:3]}\n';
    expect(shouldGateFinding(finding, unchangedFile)).toBe(false);
  });

  it('does not gate a true finding on changed code that carries a VALID citation', () => {
    // A new, independently-produced finding whose evidence cites a real
    // fragment of the current (changed) code — must be delivered.
    const finding = {
      message: 'The new conditional silently swallows the error.',
      evidence: 'Consumer at line 40 calls `result.catch(() => undefined)`.',
    };
    const currentFile = 'async function run() {\n  return result.catch(() => undefined);\n}';
    expect(shouldGateFinding(finding, currentFile)).toBe(false);
  });

  it('does not gate when the current file is unavailable (fetch failure) — fail open', () => {
    const finding = { message: 'Cites `someRemovedThing()` which is gone.' };
    expect(shouldGateFinding(finding, null)).toBe(false);
  });

  it('is not fooled by a suggestion field (suggestion is never checked)', () => {
    // A `suggestion` proposes code that does not exist yet by definition —
    // this module must never read it as a citation.
    const finding = {
      message: 'Missing a null check before the property access.',
      suggestion: 'Add `if (x == null) return;` before the access.',
    };
    // `if (x == null) return;` deliberately absent from "current" content.
    expect(shouldGateFinding(finding as { message: string }, 'function f(x) { return x.y; }')).toBe(
      false,
    );
  });

  it('gates only when EVERY extracted span mismatches, not when one of several matches', () => {
    const finding = {
      message: 'Changed from `oldPattern()` to `newPattern()`, but a stray caller still uses it.',
    };
    // `oldPattern()` is gone, but `newPattern()` is present — any-match passes.
    const currentFile = 'function caller() { return newPattern(); }';
    expect(shouldGateFinding(finding, currentFile)).toBe(false);
  });
});
