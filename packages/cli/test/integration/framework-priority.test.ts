import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import os from 'os';
import { detectAllFrameworks } from '../../src/frameworks/detector-service.js';

describe('Framework Priority/Conflict Resolution', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-priority-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should detect Laravel instead of Node.js when both markers exist', async () => {
    // Create Laravel directory with BOTH package.json and composer.json
    // (Laravel uses package.json for Vite/npm to compile frontend assets)
    await fs.mkdir(path.join(testDir, 'backend'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'backend', 'app'), { recursive: true });

    // Laravel markers
    await fs.writeFile(
      path.join(testDir, 'backend', 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } })
    );
    await fs.writeFile(path.join(testDir, 'backend', 'artisan'), '#!/usr/bin/env php\n');

    // Node.js marker (for Vite/npm)
    await fs.writeFile(
      path.join(testDir, 'backend', 'package.json'),
      JSON.stringify({ 
        name: 'backend',
        devDependencies: { vite: '^5.0.0' } 
      })
    );

    // Detect frameworks
    const results = await detectAllFrameworks(testDir);

    // Should only detect Laravel, NOT Node.js
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('laravel');
    expect(results[0].path).toBe('backend');
  });

  it('should detect Node.js when no higher-priority framework exists', async () => {
    // Create Node.js-only directory
    await fs.mkdir(path.join(testDir, 'frontend'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'frontend', 'package.json'),
      JSON.stringify({ name: 'frontend', dependencies: { react: '^18.0.0' } })
    );

    // Detect frameworks
    const results = await detectAllFrameworks(testDir);

    // Should detect Node.js since no Laravel markers
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('nodejs');
    expect(results[0].path).toBe('frontend');
  });

  it('should detect both Laravel and Node.js when they are in DIFFERENT directories', async () => {
    // Create Laravel backend
    await fs.mkdir(path.join(testDir, 'backend', 'app'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'backend', 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } })
    );
    await fs.writeFile(path.join(testDir, 'backend', 'artisan'), '#!/usr/bin/env php\n');

    // Create Node.js frontend (separate directory)
    await fs.mkdir(path.join(testDir, 'frontend'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'frontend', 'package.json'),
      JSON.stringify({ name: 'frontend', dependencies: { react: '^18.0.0' } })
    );

    // Detect frameworks
    const results = await detectAllFrameworks(testDir);

    // Should detect BOTH since they're in different directories
    expect(results.length).toBe(2);
    
    const laravel = results.find(r => r.name === 'laravel');
    const nodejs = results.find(r => r.name === 'nodejs');
    
    expect(laravel).toBeDefined();
    expect(laravel?.path).toBe('backend');
    
    expect(nodejs).toBeDefined();
    expect(nodejs?.path).toBe('frontend');
  });

  it('should handle monorepo with Laravel + separate Node.js projects', async () => {
    // Real-world scenario: monorepo with Laravel API + separate frontend
    
    // Laravel API
    await fs.mkdir(path.join(testDir, 'api', 'app'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'api', 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } })
    );
    await fs.writeFile(path.join(testDir, 'api', 'artisan'), '#!/usr/bin/env php\n');
    // Laravel also has package.json for Vite
    await fs.writeFile(
      path.join(testDir, 'api', 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } })
    );

    // Separate frontend app
    await fs.mkdir(path.join(testDir, 'web', 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'web', 'package.json'),
      JSON.stringify({ 
        name: 'web',
        dependencies: { 'next': '^14.0.0' } 
      })
    );

    // Root also has package.json for workspace management
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ 
        name: 'monorepo',
        workspaces: ['api', 'web'] 
      })
    );

    // Detect frameworks
    const results = await detectAllFrameworks(testDir);

    // Should detect:
    // - Laravel at api/ (NOT Node.js, despite package.json)
    // - Node.js at web/
    // - Node.js at root (for workspace management)
    expect(results.length).toBe(3);
    
    const apiFramework = results.find(r => r.path === 'api');
    expect(apiFramework?.name).toBe('laravel');
    
    const webFramework = results.find(r => r.path === 'web');
    expect(webFramework?.name).toBe('nodejs');
    
    const rootFramework = results.find(r => r.path === '.');
    expect(rootFramework?.name).toBe('nodejs');
  });
});

