import { describe, it, expect } from 'vitest';
import {
  PathBoostingStrategy,
  FilenameBoostingStrategy,
  FileTypeBoostingStrategy,
} from './strategies.js';
import { BoostingComposer } from './composer.js';
import { QueryIntent } from '../intent-classifier.js';

describe('Boosting Strategies', () => {
  const baseScore = 1.0;

  describe('PathBoostingStrategy', () => {
    const strategy = new PathBoostingStrategy();

    it('should have correct name', () => {
      expect(strategy.name).toBe('path-matching');
    });

    it('should boost files with matching path segments', () => {
      const query = 'authentication handler';
      const filepath = 'src/auth/authentication-handler.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore); // Lower score = better
    });

    it('should not boost files without matching path segments', () => {
      const query = 'payment processor';
      const filepath = 'src/user/profile.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBe(baseScore); // No change
    });

    it('should ignore short tokens (<=2 chars)', () => {
      const query = 'a in to';
      const filepath = 'src/a/in/to/file.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBe(baseScore); // No change for short tokens
    });

    it('should handle case insensitivity', () => {
      const query = 'AUTH HANDLER';
      const filepath = 'src/auth/handler.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
    });
  });

  describe('FilenameBoostingStrategy', () => {
    const strategy = new FilenameBoostingStrategy();

    it('should have correct name', () => {
      expect(strategy.name).toBe('filename-matching');
    });

    it('should strongly boost exact filename matches', () => {
      const query = 'handler';
      const filepath = 'src/auth/handler.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
      expect(boostedScore).toBe(baseScore * 0.7); // Exact match
    });

    it('should moderately boost partial filename matches', () => {
      const query = 'auth';
      const filepath = 'src/authentication-handler.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
      expect(boostedScore).toBe(baseScore * 0.8); // Partial match
    });

    it('should not boost non-matching filenames', () => {
      const query = 'payment';
      const filepath = 'src/auth/handler.ts';

      const boostedScore = strategy.apply(query, filepath, baseScore);
      expect(boostedScore).toBe(baseScore);
    });

    it('should ignore file extensions', () => {
      const query = 'handler';
      const filepath1 = 'src/handler.ts';
      const filepath2 = 'src/handler.js';
      const filepath3 = 'src/handler.py';

      const score1 = strategy.apply(query, filepath1, baseScore);
      const score2 = strategy.apply(query, filepath2, baseScore);
      const score3 = strategy.apply(query, filepath3, baseScore);

      expect(score1).toBe(score2);
      expect(score2).toBe(score3);
    });
  });

  describe('FileTypeBoostingStrategy', () => {
    describe('LOCATION intent', () => {
      const strategy = new FileTypeBoostingStrategy(QueryIntent.LOCATION);

      it('should have correct name', () => {
        expect(strategy.name).toBe('file-type');
      });

      it('should not boost non-test files (no file-type-specific logic)', () => {
        const query = 'where is controller';
        const filepath = 'src/controller.ts';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        // FileTypeBoostingStrategy only handles file-type-specific boosting
        // For non-test files, no boosting is applied
        expect(boostedScore).toBe(baseScore);
      });

      it('should deprioritize test files', () => {
        const query = 'where is the handler test';
        const filepath = 'src/auth/handler.test.ts';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        // Test files are deprioritized for LOCATION intent (1.10x penalty)
        expect(boostedScore).toBeCloseTo(baseScore * 1.1);
      });
    });

    describe('CONCEPTUAL intent', () => {
      const strategy = new FileTypeBoostingStrategy(QueryIntent.CONCEPTUAL);

      it('should strongly boost documentation files', () => {
        const query = 'how does authentication work';
        const filepath = 'docs/authentication.md';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        expect(boostedScore).toBeLessThan(baseScore);
      });

      it('should extra boost architectural docs', () => {
        const query = 'how does the system work';
        const filepath = 'docs/architecture/system-design.md';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        expect(boostedScore).toBeLessThan(baseScore);
      });

      it('should slightly boost utility files', () => {
        const query = 'how does validation work';
        const filepath = 'src/utils/validator.ts'; // No token match to isolate utility boost

        const boostedScore = strategy.apply(query, filepath, baseScore);
        // Utility files are boosted (0.95) for conceptual queries
        expect(boostedScore).toBeCloseTo(baseScore * 0.95);
      });

      it('should recognize README files', () => {
        const query = 'what is this project';
        const filepath = 'README.md';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        expect(boostedScore).toBeLessThan(baseScore); // Should be boosted as doc
      });
    });

    describe('IMPLEMENTATION intent', () => {
      const strategy = new FileTypeBoostingStrategy(QueryIntent.IMPLEMENTATION);

      it('should not boost non-test files (no file-type-specific logic)', () => {
        const query = 'how is handler implemented';
        const filepath = 'src/handler.ts';

        const boostedScore = strategy.apply(query, filepath, baseScore);
        // FileTypeBoostingStrategy only handles file-type-specific boosting
        // For non-test files, no boosting is applied
        expect(boostedScore).toBe(baseScore);
      });

      it('should slightly deprioritize test files', () => {
        const query = 'how is database implemented';
        const filepath = 'src/unrelated/foo.test.ts'; // No filename/path match to isolate test penalty

        const boostedScore = strategy.apply(query, filepath, baseScore);
        // Test files should be deprioritized (score increased by 1.10x)
        expect(boostedScore).toBeCloseTo(baseScore * 1.1);
      });
    });
  });

  describe('BoostingComposer', () => {
    it('should compose multiple strategies', () => {
      const composer = new BoostingComposer()
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy());

      const query = 'auth handler';
      const filepath = 'src/auth/handler.ts';

      const boostedScore = composer.apply(query, filepath, baseScore);

      // Should apply both strategies
      expect(boostedScore).toBeLessThan(baseScore);
    });

    it('should apply strategies in order', () => {
      const composer = new BoostingComposer()
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy());

      expect(composer.getStrategyCount()).toBe(2);
      expect(composer.getStrategyNames()).toEqual(['path-matching', 'filename-matching']);
    });

    it('should support chaining', () => {
      const composer = new BoostingComposer();

      const result = composer
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy());

      expect(result).toBe(composer); // Returns itself for chaining
      expect(composer.getStrategyCount()).toBe(2);
    });

    it('should clear strategies', () => {
      const composer = new BoostingComposer()
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy());

      expect(composer.getStrategyCount()).toBe(2);

      composer.clear();

      expect(composer.getStrategyCount()).toBe(0);
    });

    it('should handle empty composer', () => {
      const composer = new BoostingComposer();

      const query = 'test';
      const filepath = 'src/test.ts';
      const boostedScore = composer.apply(query, filepath, baseScore);

      // No strategies, should return unchanged score
      expect(boostedScore).toBe(baseScore);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle authentication location query', () => {
      const composer = new BoostingComposer()
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy())
        .addStrategy(new FileTypeBoostingStrategy(QueryIntent.LOCATION));

      const query = 'where is authentication handler';
      const filepath = 'src/auth/authentication-handler.ts';

      const boostedScore = composer.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
    });

    it('should handle conceptual query for docs', () => {
      const composer = new BoostingComposer().addStrategy(
        new FileTypeBoostingStrategy(QueryIntent.CONCEPTUAL),
      );

      const query = 'how does authentication work';
      const filepath = 'docs/authentication.md';

      const boostedScore = composer.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
    });

    it('should handle implementation query', () => {
      const composer = new BoostingComposer()
        .addStrategy(new PathBoostingStrategy())
        .addStrategy(new FilenameBoostingStrategy())
        .addStrategy(new FileTypeBoostingStrategy(QueryIntent.IMPLEMENTATION));

      const query = 'how is payment processor implemented';
      const filepath = 'src/payment/processor.ts';

      const boostedScore = composer.apply(query, filepath, baseScore);
      expect(boostedScore).toBeLessThan(baseScore);
    });
  });
});
