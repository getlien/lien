import { describe, it, expect } from 'vitest';
import type { RelevanceCategory } from './relevance.js';
import { calculateRelevance } from './relevance.js';

describe('calculateRelevance', () => {
  describe('highly_relevant category', () => {
    it('should return highly_relevant for score 0.0', () => {
      expect(calculateRelevance(0.0)).toBe('highly_relevant');
    });

    it('should return highly_relevant for score 0.5', () => {
      expect(calculateRelevance(0.5)).toBe('highly_relevant');
    });

    it('should return highly_relevant for score 0.99', () => {
      expect(calculateRelevance(0.99)).toBe('highly_relevant');
    });

    it('should return highly_relevant for boundary score exactly 0.999999', () => {
      expect(calculateRelevance(0.999999)).toBe('highly_relevant');
    });
  });

  describe('relevant category', () => {
    it('should return relevant for score 1.0 (boundary)', () => {
      expect(calculateRelevance(1.0)).toBe('relevant');
    });

    it('should return relevant for score 1.1', () => {
      expect(calculateRelevance(1.1)).toBe('relevant');
    });

    it('should return relevant for score 1.29', () => {
      expect(calculateRelevance(1.29)).toBe('relevant');
    });

    it('should return relevant for boundary score exactly 1.299999', () => {
      expect(calculateRelevance(1.299999)).toBe('relevant');
    });
  });

  describe('loosely_related category', () => {
    it('should return loosely_related for score 1.3 (boundary)', () => {
      expect(calculateRelevance(1.3)).toBe('loosely_related');
    });

    it('should return loosely_related for score 1.4', () => {
      expect(calculateRelevance(1.4)).toBe('loosely_related');
    });

    it('should return loosely_related for boundary score exactly 1.499999', () => {
      expect(calculateRelevance(1.499999)).toBe('loosely_related');
    });
  });

  describe('not_relevant category', () => {
    it('should return not_relevant for score 1.5 (boundary)', () => {
      expect(calculateRelevance(1.5)).toBe('not_relevant');
    });

    it('should return not_relevant for score 2.0', () => {
      expect(calculateRelevance(2.0)).toBe('not_relevant');
    });

    it('should return not_relevant for very high scores', () => {
      expect(calculateRelevance(10.0)).toBe('not_relevant');
    });
  });

  describe('edge cases', () => {
    it('should handle negative scores (if they occur)', () => {
      // Cosine distance shouldn't be negative, but handle gracefully
      expect(calculateRelevance(-0.5)).toBe('highly_relevant');
    });

    it('should handle very small positive scores', () => {
      expect(calculateRelevance(0.001)).toBe('highly_relevant');
    });

    it('should handle exact boundary values', () => {
      const boundaries: Array<[number, RelevanceCategory]> = [
        [0.999, 'highly_relevant'],
        [1.0, 'relevant'],
        [1.299, 'relevant'],
        [1.3, 'loosely_related'],
        [1.499, 'loosely_related'],
        [1.5, 'not_relevant'],
      ];

      boundaries.forEach(([score, expected]) => {
        expect(calculateRelevance(score)).toBe(expected);
      });
    });
  });
});
