import { TestPatternConfig } from '../../config/schema.js';

/**
 * Laravel/PHP test patterns
 * Supports: PHPUnit, Pest
 */
export const laravelTestPatterns: TestPatternConfig = {
  directories: [
    'tests',
    'tests/Feature',
    'tests/Unit',
    'tests/Browser',
    'test',
  ],
  extensions: [
    'Test.php',
  ],
  prefixes: [],
  suffixes: [
    'Test',
  ],
  frameworks: [
    'phpunit',
    'pest',
  ],
};

