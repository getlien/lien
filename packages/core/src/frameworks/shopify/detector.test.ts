import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { shopifyDetector } from './detector.js';

describe('shopifyDetector', () => {
  let testDir: string;
  
  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(process.cwd(), '.test-shopify-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  describe('detection', () => {
    it('should detect Shopify theme with settings_schema.json and directories', async () => {
      // Create Shopify theme structure
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        JSON.stringify([{ name: 'theme_info' }])
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.name).toBe('shopify');
      expect(result.confidence).toBe('high');
      expect(result.evidence).toContain('Found config/settings_schema.json');
      expect(result.evidence.some(e => e.includes('Shopify directory structure'))).toBe(true);
    });
    
    it('should detect with layout/theme.liquid and directories', async () => {
      await fs.mkdir(path.join(testDir, 'layout'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'layout', 'theme.liquid'),
        '<!DOCTYPE html><html>{{ content_for_layout }}</html>'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.confidence).toBe('medium');
      expect(result.evidence).toContain('Found layout/theme.liquid');
    });
    
    it('should detect with shopify.theme.toml', async () => {
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        '[]'
      );
      await fs.writeFile(
        path.join(testDir, 'shopify.theme.toml'),
        '[environments.local]\ntheme = "main"'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.evidence).toContain('Found shopify.theme.toml');
    });
    
    it('should detect with .shopifyignore', async () => {
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        '[]'
      );
      await fs.writeFile(
        path.join(testDir, '.shopifyignore'),
        'node_modules/\nconfig/settings_data.json'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.evidence).toContain('Found .shopifyignore');
    });
    
    it('should have HIGH confidence with settings_schema + 2+ directories', async () => {
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        '[]'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.confidence).toBe('high');
    });
    
    it('should have MEDIUM confidence with only settings_schema', async () => {
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        '[]'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.confidence).toBe('medium');
    });
    
    it('should have MEDIUM confidence with 3+ directories but no markers', async () => {
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'locales'), { recursive: true });
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(true);
      expect(result.confidence).toBe('medium');
    });
    
    it('should NOT detect non-Shopify directory', async () => {
      // Just create some random directories
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'dist'), { recursive: true });
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(false);
    });
    
    it('should NOT detect Node.js-only project', async () => {
      await fs.writeFile(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: { vue: '^3.0.0' } })
      );
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      expect(result.detected).toBe(false);
    });
    
    it('should count all 4 standard directories', async () => {
      await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });
      await fs.mkdir(path.join(testDir, 'locales'), { recursive: true });
      await fs.writeFile(
        path.join(testDir, 'config', 'settings_schema.json'),
        '[]'
      );
      
      const result = await shopifyDetector.detect(testDir, '.');
      
      // Should mention 4 out of 4 standard directories
      const evidence = result.evidence.find(e => e.includes('directory structure'));
      expect(evidence).toBeDefined();
      expect(evidence).toContain('4/4');
    });
  });
  
  describe('priority', () => {
    it('should have priority 100 (same as Laravel)', () => {
      expect(shopifyDetector.priority).toBe(100);
    });
  });
  
  describe('config generation', () => {
    it('should generate valid config', async () => {
      const config = await shopifyDetector.generateConfig(testDir, '.');
      
      expect(config).toHaveProperty('include');
      expect(config).toHaveProperty('exclude');
      expect(Array.isArray(config.include)).toBe(true);
      expect(Array.isArray(config.exclude)).toBe(true);
      
      // Check for key patterns
      expect(config.include).toContain('layout/**/*.liquid');
      expect(config.include).toContain('sections/**/*.liquid');
      expect(config.include).toContain('snippets/**/*.liquid');
      expect(config.include).toContain('blocks/**/*.liquid');
      expect(config.exclude).toContain('node_modules/**');
    });
  });
});

