import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import os from 'os';
import { phpDetector } from './detector.js';

describe('PHP Detector', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(os.tmpdir(), 'lien-php-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should detect generic PHP project with composer.json', async () => {
    // Create a generic PHP project (not Laravel)
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { 
          php: '^8.1',
          'monolog/monolog': '^3.0'
        }
      })
    );

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(true);
    expect(result.name).toBe('php');
    expect(result.confidence).toBe('high');
    expect(result.evidence).toContain('Found composer.json');
  });

  it('should NOT detect Laravel projects (let Laravel detector handle it)', async () => {
    // Create a Laravel project
    await fs.mkdir(path.join(testDir, 'app'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { 
          'laravel/framework': '^11.0'
        }
      })
    );
    await fs.writeFile(path.join(testDir, 'artisan'), '#!/usr/bin/env php\n');

    const result = await phpDetector.detect(testDir, '.');

    // Should NOT detect - Laravel detector will handle this
    expect(result.detected).toBe(false);
  });

  it('should detect PHP project with PHPUnit', async () => {
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { php: '^8.1' },
        'require-dev': {
          'phpunit/phpunit': '^10.0'
        }
      })
    );

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(true);
    expect(result.evidence.some(e => e.includes('PHPUnit'))).toBe(true);
    expect(result.evidence.some(e => e.includes('PHP project structure'))).toBe(true);
  });

  it('should detect PHP project with Pest', async () => {
    await fs.mkdir(path.join(testDir, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { php: '^8.1' },
        'require-dev': {
          'pestphp/pest': '^2.0'
        }
      })
    );

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(true);
    expect(result.evidence.some(e => e.includes('Pest'))).toBe(true);
    expect(result.evidence.some(e => e.includes('PHP project structure'))).toBe(true);
  });

  it('should NOT detect project without composer.json', async () => {
    // Create a directory with no composer.json
    await fs.mkdir(testDir, { recursive: true });

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(false);
  });

  it('should detect PHP version from composer.json', async () => {
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { 
          php: '^8.2'
        }
      })
    );

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(true);
    expect(result.version).toBe('^8.2');
    expect(result.evidence.some(e => e.includes('PHP ^8.2'))).toBe(true);
  });

  it('should detect Symfony projects', async () => {
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'composer.json'),
      JSON.stringify({ 
        require: { 
          php: '^8.1',
          'symfony/framework-bundle': '^6.0'
        }
      })
    );

    const result = await phpDetector.detect(testDir, '.');

    expect(result.detected).toBe(true);
    expect(result.evidence.some(e => e.includes('Symfony'))).toBe(true);
  });
});

