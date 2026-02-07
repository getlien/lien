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
    it('should have presets for nodejs, python, php, and laravel', () => {
      const names = ECOSYSTEM_PRESETS.map(p => p.name);
      expect(names).toContain('nodejs');
      expect(names).toContain('python');
      expect(names).toContain('php');
      expect(names).toContain('laravel');
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
