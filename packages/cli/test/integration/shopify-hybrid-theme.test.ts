import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { detectAllFrameworks } from '../../src/frameworks/detector-service.js';

describe('Shopify + Node.js Hybrid Theme', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = path.join(process.cwd(), '.test-shopify-hybrid-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  it('should detect both Shopify and Node.js in hybrid theme', async () => {
    // Create Shopify theme structure
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'layout'), { recursive: true });
    
    // Shopify marker files
    await fs.writeFile(
      path.join(testDir, 'config', 'settings_schema.json'),
      JSON.stringify([{ name: 'theme_info', theme_name: 'Test Theme' }])
    );
    await fs.writeFile(
      path.join(testDir, 'layout', 'theme.liquid'),
      '<!DOCTYPE html><html>{{ content_for_layout }}</html>'
    );
    await fs.writeFile(
      path.join(testDir, 'sections', 'header.liquid'),
      '{% render "menu" %}'
    );
    
    // Node.js/Vue frontend
    await fs.mkdir(path.join(testDir, 'frontend', 'components'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'hybrid-shopify-theme',
        dependencies: {
          vue: '^3.5.0',
          vite: '^6.0.0'
        },
        devDependencies: {
          vitest: '^2.0.0'
        }
      })
    );
    await fs.writeFile(
      path.join(testDir, 'frontend', 'components', 'Cart.vue'),
      '<template><div class="cart">Cart</div></template>'
    );
    
    // Detect frameworks
    const results = await detectAllFrameworks(testDir);
    
    // Should detect BOTH frameworks
    expect(results).toHaveLength(2);
    
    const frameworkNames = results.map((r) => r.name).sort();
    expect(frameworkNames).toEqual(['nodejs', 'shopify']);
    
    // Both should have HIGH confidence
    const shopify = results.find((r) => r.name === 'shopify');
    const nodejs = results.find((r) => r.name === 'nodejs');
    
    expect(shopify).toBeDefined();
    expect(shopify?.confidence).toBe('high');
    expect(shopify?.path).toBe('.');
    
    expect(nodejs).toBeDefined();
    expect(nodejs?.confidence).toBe('high');
    expect(nodejs?.path).toBe('.');
  });
  
  it('should detect Shopify-only theme without Node.js', async () => {
    // Pure Shopify theme (no package.json)
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });
    
    await fs.writeFile(
      path.join(testDir, 'config', 'settings_schema.json'),
      '[]'
    );
    
    const results = await detectAllFrameworks(testDir);
    
    // Should detect only Shopify
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('shopify');
    expect(results[0].confidence).toBe('high');
  });
  
  it('should detect Node.js-only project without Shopify', async () => {
    // Pure Node.js project
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'nodejs-app',
        dependencies: {
          express: '^4.0.0'
        }
      })
    );
    await fs.writeFile(
      path.join(testDir, 'src', 'index.ts'),
      'console.log("hello");'
    );
    
    const results = await detectAllFrameworks(testDir);
    
    // Should detect only Node.js
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('nodejs');
    expect(results[0].confidence).toBe('high');
  });
  
  it('should handle Shopify theme with blocks directory', async () => {
    // Modern Shopify theme with blocks (Online Store 2.0)
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'blocks'), { recursive: true });
    
    await fs.writeFile(
      path.join(testDir, 'config', 'settings_schema.json'),
      '[]'
    );
    await fs.writeFile(
      path.join(testDir, 'blocks', 'hero.liquid'),
      '<div class="hero">{{ block.settings.title }}</div>'
    );
    
    const results = await detectAllFrameworks(testDir);
    
    expect(results.length).toBeGreaterThan(0);
    const shopify = results.find((r) => r.name === 'shopify');
    expect(shopify).toBeDefined();
  });
  
  it('should generate correct config for hybrid theme', async () => {
    // Create minimal hybrid structure
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'sections'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'snippets'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'config', 'settings_schema.json'),
      '[]'
    );
    await fs.writeFile(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'test', dependencies: { vue: '^3.0.0' } })
    );
    
    const results = await detectAllFrameworks(testDir);
    
    expect(results).toHaveLength(2);
    
    // Each framework should have its own config
    for (const result of results) {
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidence');
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });
});

