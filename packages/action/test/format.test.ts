import { describe, it, expect } from 'vitest';
import { formatTime, formatDeltaValue } from '@liendev/review';

describe('formatTime', () => {
  describe('positive values', () => {
    it('formats minutes under 60 as "Xm"', () => {
      expect(formatTime(45)).toBe('45m');
      expect(formatTime(0)).toBe('0m');
      expect(formatTime(59)).toBe('59m');
    });

    it('formats exactly 60 minutes as "1h"', () => {
      expect(formatTime(60)).toBe('1h');
    });

    it('formats hours with minutes as "Xh Ym"', () => {
      expect(formatTime(90)).toBe('1h 30m');
      expect(formatTime(125)).toBe('2h 5m');
      expect(formatTime(474)).toBe('7h 54m');
    });

    it('formats exact hours without minutes', () => {
      expect(formatTime(120)).toBe('2h');
      expect(formatTime(180)).toBe('3h');
    });
  });

  describe('negative values', () => {
    it('formats negative minutes under 60 as "-Xm"', () => {
      expect(formatTime(-45)).toBe('-45m');
      expect(formatTime(-30)).toBe('-30m');
    });

    it('formats negative hours as "-Xh"', () => {
      expect(formatTime(-60)).toBe('-1h');
      expect(formatTime(-120)).toBe('-2h');
    });

    it('formats negative hours with minutes as "-Xh Ym"', () => {
      expect(formatTime(-474)).toBe('-7h 54m');
      expect(formatTime(-90)).toBe('-1h 30m');
    });
  });

  describe('rounding', () => {
    it('rounds to nearest minute first to avoid "1h 60m"', () => {
      expect(formatTime(119.5)).toBe('2h'); // rounds 119.5 to 120
      expect(formatTime(119.4)).toBe('1h 59m'); // rounds 119.4 to 119
    });

    it('rounds fractional minutes', () => {
      expect(formatTime(59.4)).toBe('59m');
      expect(formatTime(59.6)).toBe('1h');
    });
  });
});

describe('formatDeltaValue', () => {
  it('formats halstead_bugs with 2 decimal places', () => {
    expect(formatDeltaValue('halstead_bugs', 2.5)).toBe('2.50');
    expect(formatDeltaValue('halstead_bugs', -1.234)).toBe('-1.23');
    expect(formatDeltaValue('halstead_bugs', 0)).toBe('0.00');
  });

  it('formats halstead_effort as human-readable time', () => {
    expect(formatDeltaValue('halstead_effort', 474)).toBe('7h 54m');
    expect(formatDeltaValue('halstead_effort', -474)).toBe('-7h 54m');
    expect(formatDeltaValue('halstead_effort', 45)).toBe('45m');
  });

  it('formats other metrics as rounded integers', () => {
    expect(formatDeltaValue('cyclomatic', 5)).toBe('5');
    expect(formatDeltaValue('cognitive', -3)).toBe('-3');
    expect(formatDeltaValue('cyclomatic', 2.7)).toBe('3');
  });
});
