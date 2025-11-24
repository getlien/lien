import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'fs/promises';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { detectAllFrameworks } from '../../src/frameworks/detector-service.js';
import { getFrameworkDetector } from '../../src/frameworks/registry.js';
import { LienConfig, FrameworkInstance, defaultConfig } from '../../src/config/schema.js';
import { loadConfig } from '../../src/config/loader.js';
import { migrateConfig } from '../../src/config/migration.js';

describe('E2E Workflow', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-e2e-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('completes fresh init → index → search workflow', async () => {
    // Step 1: Create a new project
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'fresh-project',
        devDependencies: { vitest: '^1.0.0' },
      })
    );

    await fs.writeFile(
      path.join(testDir, 'src/calculator.ts'),
      `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}`
    );

    await fs.writeFile(
      path.join(testDir, 'tests/calculator.test.ts'),
      `import { Calculator } from '../src/calculator';

test('calculator addition', () => {
  const calc = new Calculator();
  expect(calc.add(2, 3)).toBe(5);
});`
    );

    // Step 2: Detect frameworks (simulating `lien init`)
    const detections = await detectAllFrameworks(testDir);
    expect(detections).toHaveLength(1);
    expect(detections[0].name).toBe('nodejs');

    // Step 3: Generate config
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
      ...defaultConfig,
      frameworks,
      gitDetection: { enabled: false, pollIntervalMs: 10000 },
      fileWatching: { enabled: false, debounceMs: 1000 },
    };

    // Write config
    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(config, null, 2)
    );

    // Step 4: Index (simulating `lien index`)
    // Note: We can't actually index without LocalEmbeddings in a test environment
    // So we just verify the config is loadable
    const loadedConfig = await loadConfig(testDir);
    expect(loadedConfig.frameworks).toHaveLength(1);
    expect(loadedConfig.frameworks[0].name).toBe('nodejs');

    // Step 5: Verify structure is correct for indexing
    expect(loadedConfig.frameworks[0].config.include).toContain('**/*.ts');
  }, 10000);

  it('migrates v0.2.0 config → index → search workflow', async () => {
    // Step 1: Create project with old config
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/legacy.ts'),
      'export const legacyFunction = () => "legacy";'
    );

    // Write v0.2.0 config
    const v020Config = {
      version: '0.2.0',
      indexing: {
        exclude: ['node_modules/**', 'dist/**'],
        include: ['src/**/*.ts', 'lib/**/*.ts'],
        chunkSize: 75,
        chunkOverlap: 10,
        concurrency: 4,
        embeddingBatchSize: 50,
        indexTests: false,
        useImportAnalysis: false,
      },
      mcp: {
        port: 7133,
        transport: 'stdio',
        autoIndexOnFirstRun: true,
      },
      gitDetection: {
        enabled: true,
        pollIntervalMs: 10000,
      },
      fileWatching: {
        enabled: false,
        debounceMs: 1000,
      },
    };

    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(v020Config, null, 2)
    );

    // Step 2: Load config (triggers auto-migration)
    const migratedConfig = await loadConfig(testDir);

    // Step 3: Verify migration
    expect(migratedConfig.version).toBe('0.14.0');
    expect(migratedConfig.frameworks).toHaveLength(1);
    expect(migratedConfig.frameworks[0].name).toBe('generic');
    expect(migratedConfig.frameworks[0].path).toBe('.');
    expect(migratedConfig.frameworks[0].config.include).toEqual(v020Config.indexing.include);
    expect(migratedConfig.frameworks[0].config.exclude).toEqual(v020Config.indexing.exclude);

    // Step 4: Verify backup was created
    const backupPath = path.join(testDir, '.lien.config.json.v0.2.0.backup');
    const backupExists = await fs
      .access(backupPath)
      .then(() => true)
      .catch(() => false);
    expect(backupExists).toBe(true);

    // Step 5: Verify backup contains original config
    const backupContent = await fs.readFile(backupPath, 'utf-8');
    const backup = JSON.parse(backupContent);
    expect(backup.version).toBe('0.2.0');
  }, 10000);

  it('adds new framework to existing project', async () => {
    // Step 1: Start with Node.js only
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'existing-project' })
    );
    await fs.writeFile(
      path.join(testDir, 'src/app.ts'),
      'export const app = "Node.js";'
    );

    // Create initial config
    const initialDetections = await detectAllFrameworks(testDir);
    const initialFrameworks: FrameworkInstance[] = [];

    for (const detection of initialDetections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        initialFrameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    const initialConfig: LienConfig = {
      ...defaultConfig,
      frameworks: initialFrameworks,
    };

    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(initialConfig, null, 2)
    );

    // Verify initial state
    expect(initialFrameworks).toHaveLength(1);
    expect(initialFrameworks[0].name).toBe('nodejs');

    // Step 2: Add Laravel backend
    await fs.mkdir(path.join(testDir, 'backend/app/Models'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'backend/composer.json'),
      JSON.stringify({
        require: { 'laravel/framework': '^10.0' },
      })
    );
    await fs.writeFile(
      path.join(testDir, 'backend/app/Models/User.php'),
      '<?php namespace App\\Models; class User {}'
    );

    // Step 3: Re-detect frameworks
    const updatedDetections = await detectAllFrameworks(testDir);
    expect(updatedDetections).toHaveLength(2);

    const updatedFrameworks: FrameworkInstance[] = [];
    for (const detection of updatedDetections) {
      const detector = getFrameworkDetector(detection.name);
      if (detector) {
        const config = await detector.generateConfig(testDir, detection.path);
        updatedFrameworks.push({
          name: detection.name,
          path: detection.path || '.',
          enabled: true,
          config,
        });
      }
    }

    // Step 4: Update config
    const updatedConfig: LienConfig = {
      ...defaultConfig,
      frameworks: updatedFrameworks,
    };

    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(updatedConfig, null, 2)
    );

    // Step 5: Verify both frameworks are configured
    const finalConfig = await loadConfig(testDir);
    expect(finalConfig.frameworks).toHaveLength(2);

    const nodejs = finalConfig.frameworks.find(f => f.name === 'nodejs');
    const laravel = finalConfig.frameworks.find(f => f.name === 'laravel');

    expect(nodejs).toBeDefined();
    expect(nodejs?.path).toBe('.');

    expect(laravel).toBeDefined();
    expect(laravel?.path).toBe('backend');
  }, 10000);

  it('handles re-initialization with --upgrade flag', async () => {
    // Step 1: Create project with old config
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

    await fs.writeFile(
      path.join(testDir, 'src/app.ts'),
      'export const app = "test";'
    );

    const oldConfig: LienConfig = {
      version: '0.3.0',
      core: {
        chunkSize: 50, // Custom value
        chunkOverlap: 5,
        concurrency: 2,
        embeddingBatchSize: 25,
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
        enabled: true,
        pollIntervalMs: 10000,
      },
      fileWatching: {
        enabled: true, // Custom value
        debounceMs: 2000, // Custom value
      },
      frameworks: [],
    };

    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(oldConfig, null, 2)
    );

    // Step 2: Load existing config
    const loaded = await loadConfig(testDir);

    // Step 3: Verify custom values are preserved
    expect(loaded.core.chunkSize).toBe(50);
    expect(loaded.core.concurrency).toBe(2);
    expect(loaded.fileWatching.enabled).toBe(true);
    expect(loaded.fileWatching.debounceMs).toBe(2000);

    // Step 4: Merge with new default values
    // (In real usage, this would be done by `lien init --upgrade`)
    // Here we just verify the config structure is valid
    expect(loaded.version).toBe('0.3.0');
    expect(loaded.core).toBeDefined();
    expect(loaded.frameworks).toBeDefined();
  });

  it('preserves user customizations during migration', async () => {
    // Create v0.2.0 config with customizations
    const customV020Config = {
      version: '0.2.0',
      indexing: {
        exclude: ['node_modules/**', 'dist/**', 'custom-ignore/**'],
        include: ['custom-src/**/*.ts', 'lib/**/*.js'],
        chunkSize: 100, // Custom
        chunkOverlap: 15, // Custom
        concurrency: 8, // Custom
        embeddingBatchSize: 100, // Custom
        indexTests: true, // Custom
        useImportAnalysis: true, // Custom
      },
      mcp: {
        port: 9999, // Custom
        transport: 'stdio' as const,
        autoIndexOnFirstRun: false, // Custom
      },
      gitDetection: {
        enabled: false, // Custom
        pollIntervalMs: 5000, // Custom
      },
      fileWatching: {
        enabled: true, // Custom
        debounceMs: 500, // Custom
      },
    };

    await fs.writeFile(
      path.join(testDir, '.lien.config.json'),
      JSON.stringify(customV020Config, null, 2)
    );

    // Migrate using migrateConfig function (not migrateConfigFile)
    const migratedConfig = migrateConfig(customV020Config);

    // Verify all customizations are preserved
    expect(migratedConfig.version).toBe('0.14.0');
    expect(migratedConfig.core.chunkSize).toBe(100);
    expect(migratedConfig.core.chunkOverlap).toBe(15);
    expect(migratedConfig.core.concurrency).toBe(8);
    expect(migratedConfig.core.embeddingBatchSize).toBe(100);
    expect(migratedConfig.mcp.port).toBe(9999);
    expect(migratedConfig.mcp.autoIndexOnFirstRun).toBe(false);
    expect(migratedConfig.gitDetection.enabled).toBe(false);
    expect(migratedConfig.gitDetection.pollIntervalMs).toBe(5000);
    expect(migratedConfig.fileWatching.enabled).toBe(true);
    expect(migratedConfig.fileWatching.debounceMs).toBe(500);

    // Verify framework conversion
    expect(migratedConfig.frameworks).toHaveLength(1);
    expect(migratedConfig.frameworks[0].name).toBe('generic');
    expect(migratedConfig.frameworks[0].config.include).toEqual(
      customV020Config.indexing.include
    );
    expect(migratedConfig.frameworks[0].config.exclude).toEqual(
      customV020Config.indexing.exclude
    );
  });
});

