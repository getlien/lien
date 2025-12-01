import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generatePhpConfig } from './config.js';

/**
 * Generic PHP framework detector
 * Detects any PHP project with composer.json
 */
export const phpDetector: FrameworkDetector = {
  name: 'php',
  priority: 50, // Generic, yields to specific frameworks like Laravel
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'php',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // Check for composer.json
    const composerJsonPath = path.join(fullPath, 'composer.json');
    let composerJson: any = null;
    
    try {
      const content = await fs.readFile(composerJsonPath, 'utf-8');
      composerJson = JSON.parse(content);
      result.evidence.push('Found composer.json');
    } catch {
      // No composer.json, not a PHP project
      return result;
    }
    
    // Check if this is a Laravel project (Laravel detector should handle it)
    const hasLaravel = 
      composerJson.require?.['laravel/framework'] ||
      composerJson['require-dev']?.['laravel/framework'];
    
    if (hasLaravel) {
      // This is a Laravel project - let the Laravel detector handle it
      // Return not detected to avoid redundant "php" + "laravel" detection
      return result;
    }
    
    // At this point, we know it's a generic PHP project (not Laravel)
    result.detected = true;
    result.confidence = 'high';
    
    // Check for common PHP directories
    const phpDirs = ['src', 'lib', 'app', 'tests'];
    let foundDirs = 0;
    
    for (const dir of phpDirs) {
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
    
    if (foundDirs > 0) {
      result.evidence.push(`Found PHP project structure (${foundDirs} directories)`);
    }
    
    // Check for PHP version
    if (composerJson.require?.php) {
      result.version = composerJson.require.php;
      result.evidence.push(`PHP ${composerJson.require.php}`);
    }
    
    // Check for testing frameworks
    const testFrameworks = [
      { name: 'phpunit/phpunit', display: 'PHPUnit' },
      { name: 'pestphp/pest', display: 'Pest' },
      { name: 'codeception/codeception', display: 'Codeception' },
      { name: 'behat/behat', display: 'Behat' },
    ];
    
    for (const framework of testFrameworks) {
      if (
        composerJson.require?.[framework.name] || 
        composerJson['require-dev']?.[framework.name]
      ) {
        result.evidence.push(`${framework.display} test framework detected`);
        break; // Only mention first test framework found
      }
    }
    
    // Check for common PHP tools/frameworks
    const tools = [
      { name: 'symfony/framework-bundle', display: 'Symfony' },
      { name: 'symfony/http-kernel', display: 'Symfony' },
      { name: 'symfony/symfony', display: 'Symfony (legacy)' },
      { name: 'doctrine/orm', display: 'Doctrine ORM' },
      { name: 'guzzlehttp/guzzle', display: 'Guzzle HTTP' },
      { name: 'monolog/monolog', display: 'Monolog' },
    ];
    
    for (const tool of tools) {
      if (composerJson.require?.[tool.name]) {
        result.evidence.push(`${tool.display} detected`);
        break; // Only mention first tool found
      }
    }
    
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generatePhpConfig(rootDir, relativePath);
  },
};

