import { describe, it, expect } from 'vitest';
import {
  describeScanFailure,
  describePartialScan,
  describeUnanalyzableScan,
} from './scan-failure.js';

describe('describeScanFailure', () => {
  it('reports the scanner’s own error when the scan failed', () => {
    expect(
      describeScanFailure({ success: false, error: 'No files found to index', chunkCount: 0 }),
    ).toBe('No files found to index');
  });

  it('still reports a failure when the scanner gave no reason', () => {
    expect(describeScanFailure({ success: false, chunkCount: 0 })).toContain('unreported reason');
  });

  it('treats a successful scan with zero chunks as no data, not as clean', () => {
    // An empty parse is the absence of evidence, not evidence of cleanliness.
    expect(describeScanFailure({ success: true, chunkCount: 0 })).toContain('no parseable chunks');
  });

  it('returns undefined only when the scan genuinely produced content', () => {
    expect(describeScanFailure({ success: true, chunkCount: 42 })).toBeUndefined();
  });

  it('reports failure even when chunks came back alongside an error', () => {
    // A partial result is still a failed run; the caller must not treat the
    // surviving chunks as a complete corpus.
    expect(describeScanFailure({ success: false, error: 'parse aborted', chunkCount: 7 })).toBe(
      'parse aborted',
    );
  });

  it('names the size cap when every candidate file was skipped', () => {
    // "no parseable chunks" would send someone hunting a parser bug when the
    // real answer is that every file was too large to read.
    const reason = describeScanFailure({ success: true, chunkCount: 0, filesSkipped: 3 });
    expect(reason).toContain('size cap');
    expect(reason).toContain('3 files');
  });

  it('singularises the skipped-file count', () => {
    expect(describeScanFailure({ success: true, chunkCount: 0, filesSkipped: 1 })).toContain(
      '1 file',
    );
  });

  it('still reports the generic reason when nothing was skipped', () => {
    expect(describeScanFailure({ success: true, chunkCount: 0, filesSkipped: 0 })).toContain(
      'no parseable chunks',
    );
  });

  it('does not mention skips when chunks were produced', () => {
    expect(describeScanFailure({ success: true, chunkCount: 10, filesSkipped: 2 })).toBeUndefined();
  });
});

describe('describePartialScan', () => {
  // The gap this exists to close: a deletion diff where most of the changed set
  // is gone from disk. `describeScanFailure` sees chunks and returns undefined,
  // so without this the report reads as a clean review of files it never opened.
  it('reports files that failed to parse when others succeeded', () => {
    expect(describePartialScan({ success: true, chunkCount: 400, filesErrored: 88 })).toBe(
      '88 files could not be parsed and were not examined',
    );
  });

  it('is silent when nothing errored', () => {
    expect(
      describePartialScan({ success: true, chunkCount: 400, filesErrored: 0 }),
    ).toBeUndefined();
    expect(describePartialScan({ success: true, chunkCount: 400 })).toBeUndefined();
  });

  it('defers to describeScanFailure when NOTHING parsed', () => {
    // Total failure is that function's job; reporting both would double-count.
    expect(describePartialScan({ success: true, chunkCount: 0, filesErrored: 12 })).toBeUndefined();
  });

  it('says "file"/"was" for exactly one', () => {
    expect(describePartialScan({ success: true, chunkCount: 5, filesErrored: 1 })).toBe(
      '1 file could not be parsed and was not examined',
    );
  });
});

describe('describeUnanalyzableScan', () => {
  it('fires when files parsed but none of them was code', () => {
    // A documentation-only repository: the README chunks fine, so
    // describeScanFailure passes and the ranking/report is empty for a reason
    // that has nothing to do with the code being healthy (#1148).
    expect(describeUnanalyzableScan({ filesAnalyzed: 1, codeFilesAnalyzed: 0 })).toBe(
      '1 file parsed, but it is not in a language lien can analyse',
    );
  });

  it('pluralises', () => {
    expect(describeUnanalyzableScan({ filesAnalyzed: 58, codeFilesAnalyzed: 0 })).toBe(
      '58 files parsed, but none of them are in a language lien can analyse',
    );
  });

  it('stays silent as soon as one file is analysable', () => {
    // The unsupported-language fixture: main.cbl is dropped entirely and
    // conf.yaml is what remains, so this is the boundary that matters.
    expect(describeUnanalyzableScan({ filesAnalyzed: 2, codeFilesAnalyzed: 1 })).toBeUndefined();
  });

  it('defers to describeScanFailure when nothing parsed at all', () => {
    // Otherwise an empty scan reports two different reasons for one problem.
    expect(describeUnanalyzableScan({ filesAnalyzed: 0, codeFilesAnalyzed: 0 })).toBeUndefined();
  });

  // THE FALSE-ALARM GUARD. These are the shapes a declaration-count gate
  // refused, and they are ordinary code: 73 of 316 tracked source files in
  // this repo (23%) declare nothing the parser types, plus whole plausible
  // packages -- design tokens, `export type` aliases, barrels of re-exports,
  // Go `var`, Rust `pub const`. All of them ARE code, so all of them must
  // pass. Never re-gate this on declarations or on maxComplexity (#1148).
  it('stays silent for code that declares nothing the parser types', () => {
    expect(describeUnanalyzableScan({ filesAnalyzed: 1, codeFilesAnalyzed: 1 })).toBeUndefined();
  });

  it('stays silent for a constants-only package across several files', () => {
    expect(describeUnanalyzableScan({ filesAnalyzed: 3, codeFilesAnalyzed: 3 })).toBeUndefined();
  });
});
