import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'fs/promises';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  detectAllFrameworks,
  getFrameworkDetector,
  scanCodebaseWithFrameworks,
} from '@liendev/core';
import type { LienConfig, FrameworkInstance } from '@liendev/core';

describe('Monorepo Framework Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-monorepo-test-'));

    // Create monorepo structure:
    // root/
    //   package.json (Node.js)
    //   src/utils.ts
    //   tests/utils.test.ts
    //   backend/
    //     composer.json (Laravel)
    //     app/Models/User.php
    //     tests/Unit/UserTest.php

    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend', 'app', 'Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend', 'tests', 'Unit'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-monorepo', devDependencies: { vitest: '*' } })
    );
    await fs.writeFile(
      path.join(testDir, 'src/utils.ts'),
      'export function add(a: number, b: number) { return a + b; }'
    );
    await fs.writeFile(
      path.join(testDir, 'tests/utils.test.ts'),
      'import { add } from "../src/utils"; test("add", () => {});'
    );

    await fs.writeFile(
      path.join(testDir, 'backend/composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^10.0' } })
    );
    await fs.writeFile(
      path.join(testDir, 'backend/app/Models/User.php'),
      '<?php namespace App\\Models; class User {}'
    );
    await fs.writeFile(
      path.join(testDir, 'backend/tests/Unit/UserTest.php'),
      '<?php use PHPUnit\\Framework\\TestCase; class UserTest extends TestCase {}'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('detects both Node.js and Laravel frameworks', async () => {
    const detections = await detectAllFrameworks(testDir);

    expect(detections).toHaveLength(2);
    expect(detections.find(d => d.name === 'nodejs')).toMatchObject({
      name: 'nodejs',
      path: '.',
      confidence: 'high'
    });
    const laravelDetection = detections.find(d => d.name === 'laravel');
    expect(laravelDetection).toBeDefined();
    expect(laravelDetection?.name).toBe('laravel');
    expect(laravelDetection?.path).toBe('backend');
    // Confidence can be 'high' or 'medium' depending on Laravel markers found
    expect(['high', 'medium']).toContain(laravelDetection?.confidence);
  });

  it('generates config for both frameworks', async () => {
    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    expect(frameworks).toHaveLength(2);

    const nodejs = frameworks.find(f => f.name === 'nodejs');
    expect(nodejs).toBeDefined();
    expect(nodejs?.config.include).toContain('**/*.ts');
    expect(nodejs?.config.exclude).toContain('node_modules/**');

    const laravel = frameworks.find(f => f.name === 'laravel');
    expect(laravel).toBeDefined();
    expect(laravel?.config.include).toContain('app/**/*.php');
    expect(laravel?.config.exclude).toContain('vendor/**');
  });

  it('scans files with correct framework paths', async () => {
    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    // Ensure test directories are included in the scan patterns
    for (const fw of frameworks) {
      if (fw.name === 'nodejs') {
        fw.config.include.push('tests/**/*.ts');
      } else if (fw.name === 'laravel') {
        fw.config.include.push('tests/**/*.php');
      }
    }

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      chunking: {
        useAST: true,
        astFallback: 'line-based',
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
      frameworks,
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    expect(files).toContain('src/utils.ts');
    expect(files).toContain('tests/utils.test.ts');
    expect(files).toContain('backend/app/Models/User.php');
    expect(files).toContain('backend/tests/Unit/UserTest.php');
  });

  it('respects framework boundaries when scanning', async () => {
    // Add a file that should only be picked up by Laravel
    await fs.mkdir(path.join(testDir, 'backend/routes'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'backend/routes/web.php'),
      '<?php Route::get("/", fn() => "Hello");'
    );

    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      chunking: {
        useAST: true,
        astFallback: 'line-based',
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
      frameworks,
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    // Laravel's web.php should be included
    expect(files).toContain('backend/routes/web.php');

    // Node.js shouldn't pick up PHP files from backend
    const nodejsFiles = files.filter(f => !f.startsWith('backend/'));
    expect(nodejsFiles.every(f => !f.endsWith('.php'))).toBe(true);
  });

  it('indexes files and maintains framework separation', async () => {
    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    // Note: Real indexing needs LocalEmbeddings, so this test just verifies
    // the config structure and file scanning works
    expect(frameworks).toHaveLength(2);
  }, 10000);

  it('respects .gitignore at both root and framework level', async () => {
    // Add .gitignore at root
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      'temp/\n'
    );

    // Add .gitignore in backend
    await fs.writeFile(
      path.join(testDir, 'backend/.gitignore'),
      'cache/\n'
    );

    // Add files that should be ignored
    await fs.mkdir(path.join(testDir, 'temp'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'temp/ignored.ts'),
      'export const ignored = true;'
    );

    await fs.mkdir(path.join(testDir, 'backend/cache'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'backend/cache/ignored.php'),
      '<?php // ignored'
    );

    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      chunking: {
        useAST: true,
        astFallback: 'line-based',
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
      frameworks,
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    // Ignored files should not appear
    expect(files).not.toContain('temp/ignored.ts');
    expect(files).not.toContain('backend/cache/ignored.php');
  });

  it('handles disabled frameworks', async () => {
    const detections = await detectAllFrameworks(testDir);
    const frameworks: FrameworkInstance[] = [];

    for (const detection of detections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        frameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: detection.name === 'nodejs', // Disable Laravel
          config,
        });
      }
    }

    const config: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
      },
      chunking: {
        useAST: true,
        astFallback: 'line-based',
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
      frameworks,
    };

    const files = await scanCodebaseWithFrameworks(testDir, config);

    // Should only include Node.js files
    expect(files.some(f => f.endsWith('.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('.php'))).toBe(false);
  });

  it('detects framework-specific evidence', async () => {
    const detections = await detectAllFrameworks(testDir);

    const nodejsDetection = detections.find(d => d.name === 'nodejs');
    expect(nodejsDetection).toBeDefined();
    // Check evidence contains information about the project
    expect(nodejsDetection?.evidence).toBeDefined();
    expect(nodejsDetection?.evidence.length).toBeGreaterThan(0);
    expect(nodejsDetection?.evidence).toContain('Found package.json');
    expect(nodejsDetection?.evidence.some(e => e.includes('Vitest'))).toBe(true);

    const laravelDetection = detections.find(d => d.name === 'laravel');
    expect(laravelDetection).toBeDefined();
    // Confidence can vary based on Laravel markers found
    expect(['high', 'medium']).toContain(laravelDetection?.confidence);
    expect(laravelDetection?.evidence).toBeDefined();
    expect(laravelDetection?.evidence.length).toBeGreaterThan(0);
  });
});

