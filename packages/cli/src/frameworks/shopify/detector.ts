import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generateShopifyConfig } from './config.js';

/**
 * Shopify Liquid theme framework detector
 */
export const shopifyDetector: FrameworkDetector = {
  name: 'shopify',
  priority: 100, // High priority (same as Laravel)
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'shopify',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // 1. Check for config/settings_schema.json (STRONGEST signal)
    const settingsSchemaPath = path.join(fullPath, 'config', 'settings_schema.json');
    let hasSettingsSchema = false;
    
    try {
      await fs.access(settingsSchemaPath);
      hasSettingsSchema = true;
      result.evidence.push('Found config/settings_schema.json');
    } catch {
      // Not present, continue checking other markers
    }
    
    // 2. Check for layout/theme.liquid
    const themeLayoutPath = path.join(fullPath, 'layout', 'theme.liquid');
    let hasThemeLayout = false;
    
    try {
      await fs.access(themeLayoutPath);
      hasThemeLayout = true;
      result.evidence.push('Found layout/theme.liquid');
    } catch {
      // Not present
    }
    
    // 3. Check for typical Shopify directories
    const shopifyDirs = ['sections', 'snippets', 'templates', 'locales'];
    let foundDirs = 0;
    
    for (const dir of shopifyDirs) {
      try {
        const dirPath = path.join(fullPath, dir);
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          foundDirs++;
        }
      } catch {
        // Directory doesn't exist
      }
    }
    
    if (foundDirs >= 2) {
      result.evidence.push(`Shopify directory structure detected (${foundDirs}/${shopifyDirs.length} dirs)`);
    }
    
    // 4. Check for shopify.theme.toml (Shopify CLI)
    try {
      const tomlPath = path.join(fullPath, 'shopify.theme.toml');
      await fs.access(tomlPath);
      result.evidence.push('Found shopify.theme.toml');
    } catch {
      // Optional file
    }
    
    // 5. Check for .shopifyignore
    try {
      const ignorePath = path.join(fullPath, '.shopifyignore');
      await fs.access(ignorePath);
      result.evidence.push('Found .shopifyignore');
    } catch {
      // Optional file
    }
    
    // Determine detection confidence with early returns
    // High: Has settings_schema.json + 2+ directories
    if (hasSettingsSchema && foundDirs >= 2) {
      result.detected = true;
      result.confidence = 'high';
      return result;
    }
    
    // Medium: Has settings_schema alone, OR has theme.liquid + 1+ directory
    if (hasSettingsSchema || (hasThemeLayout && foundDirs >= 1)) {
      result.detected = true;
      result.confidence = 'medium';
      return result;
    }
    
    // Medium: Has 3+ typical directories but no strong markers
    if (foundDirs >= 3) {
      result.detected = true;
      result.confidence = 'medium';
      return result;
    }
    
    // Not detected
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generateShopifyConfig(rootDir, relativePath);
  },
};

