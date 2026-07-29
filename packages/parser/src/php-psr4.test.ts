import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolvePsr4Map, resolvePsr4Import, clearPsr4Cache } from './php-psr4.js';

describe('resolvePsr4Map', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-test-php-psr4-'));
  });

  afterEach(async () => {
    clearPsr4Cache();
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeJson(relPath: string, data: unknown): Promise<void> {
    const abs = path.join(testDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(data, null, 2));
  }

  it('returns an empty map when there is no composer.json at all', () => {
    const map = resolvePsr4Map(testDir);
    expect(map.size).toBe(0);
  });

  it('returns an empty map when composer.json declares no autoload.psr-4', async () => {
    await writeJson('composer.json', { name: 'guzzlehttp/guzzle' });
    const map = resolvePsr4Map(testDir);
    expect(map.size).toBe(0);
  });

  it('parses a standard single-namespace PSR-4 map (guzzle shape)', async () => {
    await writeJson('composer.json', {
      name: 'guzzlehttp/guzzle',
      autoload: { 'psr-4': { 'GuzzleHttp\\': 'src/' } },
    });

    const map = resolvePsr4Map(testDir);

    expect(map.get('GuzzleHttp\\')).toBe('src/');
  });

  it('normalizes a namespace prefix missing its trailing backslash and a dir missing its trailing slash', async () => {
    await writeJson('composer.json', {
      autoload: { 'psr-4': { GuzzleHttp: 'src' } },
    });

    const map = resolvePsr4Map(testDir);

    expect(map.get('GuzzleHttp\\')).toBe('src/');
  });

  it('merges autoload and autoload-dev sections', async () => {
    await writeJson('composer.json', {
      autoload: { 'psr-4': { 'GuzzleHttp\\': 'src/' } },
      'autoload-dev': { 'psr-4': { 'GuzzleHttp\\Tests\\': 'tests/' } },
    });

    const map = resolvePsr4Map(testDir);

    expect(map.get('GuzzleHttp\\')).toBe('src/');
    expect(map.get('GuzzleHttp\\Tests\\')).toBe('tests/');
  });

  it('takes the first directory when a PSR-4 prefix maps to a fallback-dir array', async () => {
    await writeJson('composer.json', {
      autoload: { 'psr-4': { 'App\\': ['src/', 'lib/'] } },
    });

    const map = resolvePsr4Map(testDir);

    expect(map.get('App\\')).toBe('src/');
  });

  it('maps an empty-string PSR-4 dir onto the project root (symfony/console shape, #925)', async () => {
    await writeJson('composer.json', {
      autoload: { 'psr-4': { 'Symfony\\Component\\Console\\': '' } },
    });

    const map = resolvePsr4Map(testDir);

    expect(map.get('Symfony\\Component\\Console\\')).toBe('');
  });

  it('caches the map per workspace root', async () => {
    await writeJson('composer.json', {
      autoload: { 'psr-4': { 'GuzzleHttp\\': 'src/' } },
    });

    const first = resolvePsr4Map(testDir);
    // Mutate composer.json after the first read; the cached map must not change.
    await writeJson('composer.json', { autoload: { 'psr-4': { 'Other\\': 'lib/' } } });
    const second = resolvePsr4Map(testDir);

    expect(second).toBe(first);
    expect(second.get('GuzzleHttp\\')).toBe('src/');
  });
});

describe('resolvePsr4Import', () => {
  it('is a no-op for an empty map', () => {
    const map = new Map<string, string>();
    expect(resolvePsr4Import('GuzzleHttp\\Cookie\\SetCookie', map)).toBe(
      'GuzzleHttp\\Cookie\\SetCookie',
    );
  });

  it('resolves a namespaced specifier to its real source path (guzzle repro from #867)', () => {
    const map = new Map([['GuzzleHttp\\', 'src/']]);
    expect(resolvePsr4Import('GuzzleHttp\\Cookie\\SetCookie', map)).toBe('src/Cookie/SetCookie');
  });

  it('leaves a specifier unchanged when no registered prefix matches', () => {
    const map = new Map([['GuzzleHttp\\', 'src/']]);
    expect(resolvePsr4Import('PHPUnit\\Framework\\TestCase', map)).toBe(
      'PHPUnit\\Framework\\TestCase',
    );
  });

  it('matches the longest registered prefix when multiple are registered', () => {
    const map = new Map([
      ['GuzzleHttp\\', 'src/'],
      ['GuzzleHttp\\Tests\\', 'tests/'],
    ]);

    expect(resolvePsr4Import('GuzzleHttp\\Tests\\Cookie\\SetCookieTest', map)).toBe(
      'tests/Cookie/SetCookieTest',
    );
    expect(resolvePsr4Import('GuzzleHttp\\Cookie\\SetCookie', map)).toBe('src/Cookie/SetCookie');
  });

  it('resolves a bare-prefix specifier with no remaining path segment', () => {
    const map = new Map([['App\\', 'src/']]);
    expect(resolvePsr4Import('App\\Kernel', map)).toBe('src/Kernel');
  });

  it('resolves a root-mapped namespace (empty-string dir) with no leading slash (symfony/console repro, #925)', () => {
    const map = new Map([['Symfony\\Component\\Console\\', '']]);
    expect(resolvePsr4Import('Symfony\\Component\\Console\\Command\\Command', map)).toBe(
      'Command/Command',
    );
  });
});
