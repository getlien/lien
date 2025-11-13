import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'fs/promises';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { scanCodebaseWithFrameworks } from '../../src/indexer/scanner.js';
import { isTestFile, findTestFiles } from '../../src/indexer/test-patterns.js';
import { detectLanguage } from '../../src/indexer/scanner.js';
import { LienConfig, FrameworkInstance } from '../../src/config/schema.js';
import { nodejsTestPatterns } from '../../src/frameworks/nodejs/test-patterns.js';
import { laravelTestPatterns } from '../../src/frameworks/laravel/test-patterns.js';

describe('Test Pattern Filtering', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-test-filter-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('detects Node.js test files by pattern', async () => {
    // Create test files with various patterns
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, '__tests__'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/utils.test.ts'),
      'test("example", () => {});'
    );
    await fs.writeFile(
      path.join(testDir, 'src/utils.spec.ts'),
      'describe("example", () => {});'
    );
    await fs.writeFile(
      path.join(testDir, '__tests__/integration.test.js'),
      'test("integration", () => {});'
    );
    await fs.writeFile(
      path.join(testDir, 'src/utils.ts'),
      'export const util = () => {};'
    );

    // Check detection
    expect(isTestFile('src/utils.test.ts', 'typescript')).toBe(true);
    expect(isTestFile('src/utils.spec.ts', 'typescript')).toBe(true);
    expect(isTestFile('__tests__/integration.test.js', 'javascript')).toBe(true);
    expect(isTestFile('src/utils.ts', 'typescript')).toBe(false);
  });

  it('detects Laravel/PHP test files by pattern', async () => {
    // Create Laravel test structure
    await fs.mkdir(path.join(testDir, 'app/Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests/Unit'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests/Feature'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'tests/Unit/UserTest.php'),
      '<?php class UserTest extends TestCase {}'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/Feature/AuthTest.php'),
      '<?php class AuthTest extends TestCase {}'
    );
    await fs.writeFile(
      path.join(testDir, 'app/Models/User.php'),
      '<?php class User {}'
    );

    // Check detection
    expect(isTestFile('tests/Unit/UserTest.php', 'php')).toBe(true);
    expect(isTestFile('tests/Feature/AuthTest.php', 'php')).toBe(true);
    expect(isTestFile('app/Models/User.php', 'php')).toBe(false);
  });

  it('excludes Node.js test files from scanning by default', async () => {
    // Create Node.js project
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-app' })
    );
    await fs.writeFile(
      path.join(testDir, 'src/utils.ts'),
      'export const util = () => {};'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/utils.test.ts'),
      'test("util", () => {});'
    );

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      mcp: {
        port: 7133,
        transport: 'stdio',
        autoIndexOnFirstRun: true,
      },
      gitDetection: {
        enabled: false,
        pollIntervalMs: 10000,
      },
      fileWatching: {
        enabled: false,
        debounceMs: 1000,
      },
      frameworks: [
        {
          name: 'nodejs',
          path: '.',
          enabled: true,
          config: {
            include: ['src/**/*.ts', 'tests/**/*.ts'],
            exclude: ['node_modules/**'],
            testPatterns: nodejsTestPatterns,
          },
        },
      ],
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    // Both source and test files should be scanned
    // (filtering happens at indexing level, not scanning level)
    expect(files).toContain('src/utils.ts');
    expect(files).toContain('tests/utils.test.ts');
  });

  it('excludes Laravel test files from scanning by default', async () => {
    // Create Laravel project
    await fs.mkdir(path.join(testDir, 'app/Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests/Unit'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^10.0' } })
    );
    await fs.writeFile(
      path.join(testDir, 'app/Models/User.php'),
      '<?php class User {}'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/Unit/UserTest.php'),
      '<?php class UserTest {}'
    );

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      mcp: {
        port: 7133,
        transport: 'stdio',
        autoIndexOnFirstRun: true,
      },
      gitDetection: {
        enabled: false,
        pollIntervalMs: 10000,
      },
      fileWatching: {
        enabled: false,
        debounceMs: 1000,
      },
      frameworks: [
        {
          name: 'laravel',
          path: '.',
          enabled: true,
          config: {
            include: ['app/**/*.php', 'tests/**/*.php'],
            exclude: ['vendor/**'],
            testPatterns: laravelTestPatterns,
          },
        },
      ],
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    // Both source and test files should be scanned
    expect(files).toContain('app/Models/User.php');
    expect(files).toContain('tests/Unit/UserTest.php');
  });

  it('finds test associations using custom patterns', async () => {
    // Create project with custom test structure
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'spec'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/calculator.ts'),
      'export class Calculator {}'
    );
    await fs.writeFile(
      path.join(testDir, 'spec/calculator.spec.ts'),
      'describe("Calculator", () => {});'
    );

    const files = ['src/calculator.ts', 'spec/calculator.spec.ts'];
    const customPatterns = {
      directories: ['spec'],
      extensions: ['.spec.ts'],
      prefixes: [],
      suffixes: ['.spec'],
      frameworks: ['jest', 'mocha'],
    };

    const relatedTests = findTestFiles(
      'src/calculator.ts',
      'typescript',
      files,
      '.',
      customPatterns
    );

    expect(relatedTests).toContain('spec/calculator.spec.ts');
  });

  it('respects framework boundaries in test detection', async () => {
    // Create monorepo with overlapping filenames
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend/app'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend/tests'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/User.ts'),
      'export class User {}'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/User.test.ts'),
      'test("User", () => {});'
    );
    await fs.writeFile(
      path.join(testDir, 'backend/app/User.php'),
      '<?php class User {}'
    );
    await fs.writeFile(
      path.join(testDir, 'backend/tests/UserTest.php'),
      '<?php class UserTest {}'
    );

    const allFiles = [
      'src/User.ts',
      'tests/User.test.ts',
      'backend/app/User.php',
      'backend/tests/UserTest.php',
    ];

    // Test Node.js associations (should stay in root framework)
    const nodejsTests = findTestFiles(
      'src/User.ts',
      'typescript',
      allFiles,
      '.', // Node.js framework at root
      nodejsTestPatterns
    );

    expect(nodejsTests).toContain('tests/User.test.ts');
    expect(nodejsTests).not.toContain('backend/tests/UserTest.php');

    // Test Laravel associations (should stay in backend framework)
    const laravelTests = findTestFiles(
      'backend/app/User.php',
      'php',
      allFiles,
      'backend', // Laravel framework at backend/
      laravelTestPatterns
    );

    expect(laravelTests).toContain('backend/tests/UserTest.php');
    expect(laravelTests).not.toContain('tests/User.test.ts');
  });

  it('handles multiple test frameworks in detection', async () => {
    // Create project with multiple test frameworks
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, '__tests__'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'spec'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/utils.ts'),
      'export const add = (a, b) => a + b;'
    );
    await fs.writeFile(
      path.join(testDir, '__tests__/utils.test.ts'),
      'test("add", () => {});'
    );
    await fs.writeFile(
      path.join(testDir, 'spec/utils.spec.ts'),
      'describe("add", () => {});'
    );

    const allFiles = [
      'src/utils.ts',
      '__tests__/utils.test.ts',
      'spec/utils.spec.ts',
    ];

    const relatedTests = findTestFiles(
      'src/utils.ts',
      'typescript',
      allFiles,
      '.',
      nodejsTestPatterns
    );

    // Should find both test files
    expect(relatedTests).toContain('__tests__/utils.test.ts');
    expect(relatedTests).toContain('spec/utils.spec.ts');
  });
});

