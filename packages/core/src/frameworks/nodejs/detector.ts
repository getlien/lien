import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generateNodeJsConfig } from './config.js';

/**
 * Node.js/TypeScript/JavaScript framework detector
 */
export const nodejsDetector: FrameworkDetector = {
  name: 'nodejs',
  priority: 50, // Generic, yields to specific frameworks like Laravel
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'nodejs',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // Check for package.json
    const packageJsonPath = path.join(fullPath, 'package.json');
    let packageJson: any = null;
    
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(content);
      result.evidence.push('Found package.json');
    } catch {
      // No package.json, not a Node.js project
      return result;
    }
    
    // At this point, we know it's a Node.js project
    result.detected = true;
    result.confidence = 'high';
    
    // Check for TypeScript
    if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
      result.evidence.push('TypeScript detected');
    }
    
    // Check for testing frameworks
    const testFrameworks = [
      { name: 'jest', display: 'Jest' },
      { name: 'vitest', display: 'Vitest' },
      { name: 'mocha', display: 'Mocha' },
      { name: 'ava', display: 'AVA' },
      { name: '@playwright/test', display: 'Playwright' },
    ];
    
    for (const framework of testFrameworks) {
      if (
        packageJson.devDependencies?.[framework.name] || 
        packageJson.dependencies?.[framework.name]
      ) {
        result.evidence.push(`${framework.display} test framework detected`);
        break; // Only mention first test framework found
      }
    }
    
    // Check for common frameworks/libraries
    const frameworks = [
      { name: 'next', display: 'Next.js' },
      { name: 'react', display: 'React' },
      { name: 'vue', display: 'Vue' },
      { name: 'express', display: 'Express' },
      { name: '@nestjs/core', display: 'NestJS' },
    ];
    
    for (const fw of frameworks) {
      if (packageJson.dependencies?.[fw.name]) {
        result.evidence.push(`${fw.display} detected`);
        break; // Only mention first framework found
      }
    }
    
    // Try to detect version from package.json engines or node version
    if (packageJson.engines?.node) {
      result.version = packageJson.engines.node;
    }
    
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generateNodeJsConfig(rootDir, relativePath);
  },
};

