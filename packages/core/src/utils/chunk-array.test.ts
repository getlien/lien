import { describe, it, expect } from 'vitest';
import { chunkArray } from './chunk-array.js';

describe('chunkArray', () => {
  it('should split array into chunks of given size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('should return single chunk when array fits', () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('should return exact chunks when evenly divisible', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('should return empty array for empty input', () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it('should handle chunk size of 1', () => {
    expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('should throw RangeError for size <= 0', () => {
    expect(() => chunkArray([1], 0)).toThrow(RangeError);
    expect(() => chunkArray([1], -1)).toThrow(RangeError);
  });

  it('should work with non-number types', () => {
    expect(chunkArray(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });
});
