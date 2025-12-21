import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import os from 'os';
import { laravelDetector, scanCodebaseWithFrameworks, detectLanguage } from '@liendev/core';
import type { LienConfig } from '@liendev/core';

describe('Laravel Frontend Integration', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-laravel-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should detect Laravel and include frontend file patterns', async () => {
    // Create Laravel project structure
    await fs.mkdir(path.join(testDir, 'app', 'Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'resources', 'js', 'components'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'resources', 'views'), { recursive: true });

    // Create composer.json
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } })
    );

    // Create artisan file
    await fs.writeFile(path.join(testDir, 'artisan'), '#!/usr/bin/env php\n');

    // Detect Laravel
    const result = await laravelDetector.detect(testDir, '.');
    expect(result.detected).toBe(true);

    // Generate config
    const config = await laravelDetector.generateConfig(testDir, '.');

    // Verify PHP files are included
    expect(config.include).toContain('app/**/*.php');
    expect(config.include).toContain('resources/**/*.php');

    // Verify frontend files are included (scoped to resources/ to avoid build outputs)
    expect(config.include).toContain('resources/**/*.js');
    expect(config.include).toContain('resources/**/*.ts');
    expect(config.include).toContain('resources/**/*.jsx');
    expect(config.include).toContain('resources/**/*.tsx');
    expect(config.include).toContain('resources/**/*.vue');

    // Verify Blade templates are included
    expect(config.include).toContain('resources/views/**/*.blade.php');

    // Verify vendor is excluded (with ** prefix for nested projects)
    expect(config.exclude).toContain('**/vendor/**');
    expect(config.exclude).toContain('vendor/**');
    expect(config.exclude).toContain('**/node_modules/**');
    expect(config.exclude).toContain('node_modules/**');
    
    // Verify build outputs are excluded
    expect(config.exclude).toContain('**/public/build/**');
    expect(config.exclude).toContain('public/build/**');
  });

  it('should scan and index both PHP and Vue files', async () => {
    // Create Laravel project structure
    await fs.mkdir(path.join(testDir, 'app', 'Models'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'resources', 'js', 'components'), { recursive: true });

    // Create PHP file
    await fs.writeFile(
      path.join(testDir, 'app', 'Models', 'User.php'),
      `<?php
namespace App\\Models;
class User {
  public function posts() {}
}`
    );

    // Create Vue file
    await fs.writeFile(
      path.join(testDir, 'resources', 'js', 'components', 'UserList.vue'),
      `<template>
  <div>{{ users }}</div>
</template>
<script>
export default {
  name: 'UserList',
  data() {
    return { users: [] }
  }
}
</script>`
    );

    // Create JS file
    await fs.writeFile(
      path.join(testDir, 'resources', 'js', 'app.js'),
      `import UserList from './components/UserList.vue';
const app = createApp({});`
    );

    // Create composer.json
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } })
    );

    // Get Laravel config
    const config = await laravelDetector.generateConfig(testDir, '.');

    // Build full config
    const fullConfig: LienConfig = {
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
      frameworks: [
        {
          name: 'laravel',
          path: '.',
          enabled: true,
          config,
        },
      ],
    };

    // Scan codebase
    const files = await scanCodebaseWithFrameworks(testDir, fullConfig);

    // Should find all 3 files
    expect(files.length).toBe(3);

    // Verify PHP file is found
    const phpFile = files.find(f => f.includes('User.php'));
    expect(phpFile).toBeDefined();

    // Verify Vue file is found
    const vueFile = files.find(f => f.includes('UserList.vue'));
    expect(vueFile).toBeDefined();

    // Verify JS file is found
    const jsFile = files.find(f => f.includes('app.js'));
    expect(jsFile).toBeDefined();
  });

  it('should correctly detect language for Vue files', () => {
    expect(detectLanguage('Component.vue')).toBe('vue');
    expect(detectLanguage('UserList.vue')).toBe('vue');
    expect(detectLanguage('/resources/js/components/App.vue')).toBe('vue');
  });

  it('should correctly detect language for mixed frontend files', () => {
    expect(detectLanguage('app.js')).toBe('javascript');
    expect(detectLanguage('app.ts')).toBe('typescript');
    expect(detectLanguage('Component.jsx')).toBe('javascript');
    expect(detectLanguage('Component.tsx')).toBe('typescript');
    expect(detectLanguage('Component.vue')).toBe('vue');
  });
});

