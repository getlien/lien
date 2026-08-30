import { describe, it, expect } from 'vitest';
import { describeScanFailure } from './scan-failure.js';

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
});
