import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generateLaravelConfig } from './config.js';

/**
 * Laravel/PHP framework detector
 */
export const laravelDetector: FrameworkDetector = {
  name: 'laravel',
  priority: 100, // Laravel takes precedence over Node.js
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'laravel',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // Check for composer.json with Laravel
    const composerJsonPath = path.join(fullPath, 'composer.json');
    let composerJson: any = null;
    
    try {
      const content = await fs.readFile(composerJsonPath, 'utf-8');
      composerJson = JSON.parse(content);
      result.evidence.push('Found composer.json');
    } catch {
      // No composer.json, not a Laravel project
      return result;
    }
    
    // Check if Laravel framework is in dependencies
    const hasLaravel = 
      composerJson.require?.['laravel/framework'] ||
      composerJson['require-dev']?.['laravel/framework'];
    
    if (!hasLaravel) {
      // Has composer.json but not Laravel
      return result;
    }
    
    result.evidence.push('Laravel framework detected in composer.json');
    
    // Check for artisan file (strong indicator of Laravel)
    const artisanPath = path.join(fullPath, 'artisan');
    try {
      await fs.access(artisanPath);
      result.evidence.push('Found artisan file');
      result.confidence = 'high';
    } catch {
      result.confidence = 'medium';
    }
    
    // Check for typical Laravel directory structure
    const laravelDirs = ['app', 'routes', 'config', 'database'];
    let foundDirs = 0;
    
    for (const dir of laravelDirs) {
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
      result.evidence.push(`Laravel directory structure detected (${foundDirs}/${laravelDirs.length} dirs)`);
      result.confidence = 'high';
    }
    
    // Check for test directories
    const testDirsToCheck = [
      path.join(fullPath, 'tests', 'Feature'),
      path.join(fullPath, 'tests', 'Unit'),
    ];
    
    for (const testDir of testDirsToCheck) {
      try {
        const stats = await fs.stat(testDir);
        if (stats.isDirectory()) {
          const dirName = path.basename(path.dirname(testDir)) + '/' + path.basename(testDir);
          result.evidence.push(`Found ${dirName} test directory`);
        }
      } catch {
        // Test directory doesn't exist
      }
    }
    
    // Extract Laravel version if available
    if (composerJson.require?.['laravel/framework']) {
      result.version = composerJson.require['laravel/framework'];
    }
    
    result.detected = true;
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generateLaravelConfig(rootDir, relativePath);
  },
};

