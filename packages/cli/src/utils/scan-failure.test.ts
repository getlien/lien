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
  it('fires when the scan parsed chunks but none of them was code', () => {
    // serilog's ILogger.cs: 1370 lines, one whole-file chunk, no symbol
    // extracted at all (#970 Bug 2). `lien complexity` called this clean.
    expect(describeUnanalyzableScan({ filesAnalyzed: 1, declarationsAnalyzed: 0 })).toBe(
      '1 file parsed, but it did not contain a function, class or type the parser recognised',
    );
  });

  it('pluralises the chunk count', () => {
    expect(describeUnanalyzableScan({ filesAnalyzed: 58, declarationsAnalyzed: 0 })).toContain(
      '58 files parsed',
    );
  });

  it('stays silent as soon as anything declared something', () => {
    // Measured on serilog: 440 of 731 chunks carry a symbolType and 291 do
    // not. An untyped chunk is ordinary, so only a corpus-wide zero counts.
    expect(
      describeUnanalyzableScan({ filesAnalyzed: 254, declarationsAnalyzed: 440 }),
    ).toBeUndefined();
    expect(describeUnanalyzableScan({ filesAnalyzed: 1, declarationsAnalyzed: 1 })).toBeUndefined();
  });

  // THE IMPORTANT CAVEAT, and the defect the first version of this shipped:
  // zero declarations does NOT mean "failed to parse". It is also what an
  // ordinary declaration-free file looks like, and those are common -- 73 of
  // 316 tracked source files in this repo (23%), across TypeScript, Python,
  // Rust and Swift. So this function is only sound over a WHOLE CORPUS, and
  // callers must not apply it to a single named file. `lien complexity`
  // enforces that by skipping the check entirely under `--files`; there is a
  // command-level test pinning it.
  it('cannot distinguish a failed parse from a declaration-free file, by construction', () => {
    // Both produce one untyped whole-file chunk, so both arrive here as
    // exactly this input. It fires for both -- which is why the caller, not
    // this function, decides when the reading is meaningful.
    expect(describeUnanalyzableScan({ filesAnalyzed: 1, declarationsAnalyzed: 0 })).toBeDefined();
  });

  it('defers to describeScanFailure when nothing parsed at all', () => {
    // Otherwise an empty scan reports two different reasons for one problem.
    expect(describeUnanalyzableScan({ filesAnalyzed: 0, declarationsAnalyzed: 0 })).toBeUndefined();
  });
});
