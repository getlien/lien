import { TestPatternConfig } from '../../config/schema.js';

/**
 * Node.js/TypeScript/JavaScript test patterns
 * Supports: Jest, Vitest, Mocha, AVA, Playwright
 */
export const nodejsTestPatterns: TestPatternConfig = {
  directories: [
    'test',
    'tests',
    '__tests__',
    'spec',
    'specs',
    'e2e',
  ],
  extensions: [
    '.test.ts',
    '.test.tsx',
    '.test.js',
    '.test.jsx',
    '.test.mjs',
    '.test.cjs',
    '.spec.ts',
    '.spec.tsx',
    '.spec.js',
    '.spec.jsx',
    '.spec.mjs',
    '.spec.cjs',
  ],
  prefixes: [],
  suffixes: [
    '.test',
    '.spec',
  ],
  frameworks: [
    'jest',
    'vitest',
    'mocha',
    'ava',
    'playwright',
    'jasmine',
  ],
};

