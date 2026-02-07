import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  detectEcosystems,
  getEcosystemExcludePatterns,
  ECOSYSTEM_PRESETS,
} from './ecosystem-presets.js';

describe('ecosystem-presets', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lien-eco-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('detectEcosystems', () => {
    it('should detect nodejs by package.json', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('nodejs');
    });

    it('should detect python by requirements.txt', async () => {
      await fs.writeFile(path.join(testDir, 'requirements.txt'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('python');
    });

    it('should detect python by pyproject.toml', async () => {
      await fs.writeFile(path.join(testDir, 'pyproject.toml'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('python');
    });

    it('should detect python by setup.py', async () => {
      await fs.writeFile(path.join(testDir, 'setup.py'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('python');
    });

    it('should detect python by Pipfile', async () => {
      await fs.writeFile(path.join(testDir, 'Pipfile'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('python');
    });

    it('should detect php by composer.json', async () => {
      await fs.writeFile(path.join(testDir, 'composer.json'), '{}');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('php');
    });

    it('should detect laravel by artisan', async () => {
      await fs.writeFile(path.join(testDir, 'artisan'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('laravel');
    });

    it('should detect ruby by Gemfile', async () => {
      await fs.writeFile(path.join(testDir, 'Gemfile'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('ruby');
    });

    it('should detect rails by bin/rails', async () => {
      await fs.mkdir(path.join(testDir, 'bin'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'bin', 'rails'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('rails');
    });

    it('should detect ruby and rails together', async () => {
      await fs.writeFile(path.join(testDir, 'Gemfile'), '');
      await fs.mkdir(path.join(testDir, 'bin'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'bin', 'rails'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('ruby');
      expect(result).toContain('rails');
    });

    it('should detect rust by Cargo.toml', async () => {
      await fs.writeFile(path.join(testDir, 'Cargo.toml'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('rust');
    });

    it('should detect jvm by pom.xml', async () => {
      await fs.writeFile(path.join(testDir, 'pom.xml'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('jvm');
    });

    it('should detect jvm by build.gradle', async () => {
      await fs.writeFile(path.join(testDir, 'build.gradle'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('jvm');
    });

    it('should detect django by manage.py', async () => {
      await fs.writeFile(path.join(testDir, 'manage.py'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('django');
    });

    it('should detect dotnet by *.csproj glob marker', async () => {
      await fs.writeFile(path.join(testDir, 'MyApp.csproj'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('dotnet');
    });

    it('should detect dotnet by *.sln glob marker', async () => {
      await fs.writeFile(path.join(testDir, 'MyApp.sln'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('dotnet');
    });

    it('should detect swift by Package.swift', async () => {
      await fs.writeFile(path.join(testDir, 'Package.swift'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('swift');
    });

    it('should detect swift by *.xcodeproj glob marker', async () => {
      await fs.mkdir(path.join(testDir, 'MyApp.xcodeproj'));
      const result = await detectEcosystems(testDir);
      expect(result).toContain('swift');
    });

    it('should detect astro by astro.config.mjs', async () => {
      await fs.writeFile(path.join(testDir, 'astro.config.mjs'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('astro');
    });

    it('should not match glob markers against unrelated files', async () => {
      await fs.writeFile(path.join(testDir, 'notes.txt'), '');
      const result = await detectEcosystems(testDir);
      expect(result).not.toContain('dotnet');
      expect(result).not.toContain('swift');
      expect(result).not.toContain('astro');
    });

    it('should detect multiple ecosystems simultaneously', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
      await fs.writeFile(path.join(testDir, 'requirements.txt'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('nodejs');
      expect(result).toContain('python');
    });

    it('should detect php and laravel together', async () => {
      await fs.writeFile(path.join(testDir, 'composer.json'), '{}');
      await fs.writeFile(path.join(testDir, 'artisan'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('php');
      expect(result).toContain('laravel');
    });

    it('should detect ecosystems in immediate subdirectories (monorepo)', async () => {
      await fs.mkdir(path.join(testDir, 'backend'));
      await fs.writeFile(path.join(testDir, 'backend', 'composer.json'), '{}');
      await fs.writeFile(path.join(testDir, 'backend', 'artisan'), '');
      await fs.mkdir(path.join(testDir, 'ml-service'));
      await fs.writeFile(path.join(testDir, 'ml-service', 'requirements.txt'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('php');
      expect(result).toContain('laravel');
      expect(result).toContain('python');
    });

    it('should not scan into ignored subdirectories', async () => {
      await fs.mkdir(path.join(testDir, 'node_modules'));
      await fs.writeFile(path.join(testDir, 'node_modules', 'composer.json'), '{}');
      const result = await detectEcosystems(testDir);
      expect(result).not.toContain('php');
    });

    it('should combine root and subdirectory detections', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
      await fs.mkdir(path.join(testDir, 'api'));
      await fs.writeFile(path.join(testDir, 'api', 'requirements.txt'), '');
      const result = await detectEcosystems(testDir);
      expect(result).toContain('nodejs');
      expect(result).toContain('python');
    });

    it('should return empty array when no markers found', async () => {
      const result = await detectEcosystems(testDir);
      expect(result).toEqual([]);
    });

    it('should not duplicate ecosystem if multiple markers match', async () => {
      await fs.writeFile(path.join(testDir, 'requirements.txt'), '');
      await fs.writeFile(path.join(testDir, 'pyproject.toml'), '');
      const result = await detectEcosystems(testDir);
      const pythonCount = result.filter(n => n === 'python').length;
      expect(pythonCount).toBe(1);
    });
  });

  describe('getEcosystemExcludePatterns', () => {
    it('should return nodejs exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['nodejs']);
      expect(patterns).toContain('.next/**');
      expect(patterns).toContain('coverage/**');
    });

    it('should return python exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['python']);
      expect(patterns).toContain('venv/**');
      expect(patterns).toContain('__pycache__/**');
    });

    it('should return php exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['php']);
      expect(patterns).toContain('storage/**');
    });

    it('should return laravel exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['laravel']);
      expect(patterns).toContain('database/migrations/**');
    });

    it('should return ruby exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['ruby']);
      expect(patterns).toContain('tmp/**');
      expect(patterns).toContain('.bundle/**');
    });

    it('should return rails exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['rails']);
      expect(patterns).toContain('db/migrate/**');
      expect(patterns).toContain('storage/**');
    });

    it('should return rust exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['rust']);
      expect(patterns).toContain('target/**');
    });

    it('should return jvm exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['jvm']);
      expect(patterns).toContain('.gradle/**');
      expect(patterns).toContain('.idea/**');
    });

    it('should return swift exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['swift']);
      expect(patterns).toContain('DerivedData/**');
      expect(patterns).toContain('Pods/**');
    });

    it('should return dotnet exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['dotnet']);
      expect(patterns).toContain('bin/**');
      expect(patterns).toContain('obj/**');
    });

    it('should return django exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['django']);
      expect(patterns).toContain('staticfiles/**');
      expect(patterns).toContain('*.sqlite3');
    });

    it('should return astro exclude patterns', () => {
      const patterns = getEcosystemExcludePatterns(['astro']);
      expect(patterns).toContain('.astro/**');
    });

    it('should merge and deduplicate patterns from multiple ecosystems', () => {
      const patterns = getEcosystemExcludePatterns(['php', 'laravel']);
      // Both have public/build/** — should appear once
      const publicBuildCount = patterns.filter(p => p === 'public/build/**').length;
      expect(publicBuildCount).toBeLessThanOrEqual(1);
      // Should have patterns from both
      expect(patterns).toContain('storage/**');
      expect(patterns).toContain('database/migrations/**');
    });

    it('should return empty array for unknown ecosystem names', () => {
      const patterns = getEcosystemExcludePatterns(['unknown']);
      expect(patterns).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      const patterns = getEcosystemExcludePatterns([]);
      expect(patterns).toEqual([]);
    });
  });

  describe('ECOSYSTEM_PRESETS', () => {
    it('should have presets for all supported ecosystems', () => {
      const names = ECOSYSTEM_PRESETS.map(p => p.name);
      expect(names).toContain('nodejs');
      expect(names).toContain('python');
      expect(names).toContain('php');
      expect(names).toContain('laravel');
      expect(names).toContain('ruby');
      expect(names).toContain('rails');
      expect(names).toContain('rust');
      expect(names).toContain('jvm');
      expect(names).toContain('swift');
      expect(names).toContain('dotnet');
      expect(names).toContain('django');
      expect(names).toContain('astro');
    });

    it('should have at least one marker file per preset', () => {
      for (const preset of ECOSYSTEM_PRESETS) {
        expect(preset.markerFiles.length).toBeGreaterThan(0);
      }
    });

    it('should have at least one exclude pattern per preset', () => {
      for (const preset of ECOSYSTEM_PRESETS) {
        expect(preset.excludePatterns.length).toBeGreaterThan(0);
      }
    });
  });
});
