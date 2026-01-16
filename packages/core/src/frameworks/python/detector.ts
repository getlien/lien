import fs from 'fs/promises';
import path from 'path';
import { FrameworkDetector, DetectionResult } from '../types.js';
import { generatePythonConfig } from './config.js';

/**
 * Python framework detector
 * Detects Python projects via requirements.txt, pyproject.toml, setup.py, or Pipfile
 */
export const pythonDetector: FrameworkDetector = {
  name: 'python',
  priority: 50, // Generic, yields to specific frameworks like Django
  
  async detect(rootDir: string, relativePath: string): Promise<DetectionResult> {
    const fullPath = path.join(rootDir, relativePath);
    const result: DetectionResult = {
      detected: false,
      name: 'python',
      path: relativePath,
      confidence: 'low',
      evidence: [],
    };
    
    // Check for Python project indicators
    const indicators = [
      { file: 'requirements.txt', display: 'requirements.txt' },
      { file: 'pyproject.toml', display: 'pyproject.toml' },
      { file: 'setup.py', display: 'setup.py' },
      { file: 'Pipfile', display: 'Pipfile' },
      { file: 'setup.cfg', display: 'setup.cfg' },
    ];
    
    let foundIndicator = false;
    
    // Check all indicators to provide complete evidence
    for (const indicator of indicators) {
      try {
        const filePath = path.join(fullPath, indicator.file);
        await fs.access(filePath);
        result.evidence.push(`Found ${indicator.display}`);
        foundIndicator = true;
      } catch {
        // File doesn't exist, continue checking
      }
    }
    
    if (!foundIndicator) {
      // No Python project indicators found
      return result;
    }
    
    // At this point, we know it's a Python project
    result.detected = true;
    result.confidence = 'high';
    
    // Check for Django (manage.py is a strong indicator)
    const managePyPath = path.join(fullPath, 'manage.py');
    try {
      const content = await fs.readFile(managePyPath, 'utf-8');
      if (content.includes('django.core.management') || content.includes('DJANGO_SETTINGS_MODULE')) {
        result.evidence.push('Django project detected (manage.py)');
      }
    } catch {
      // No manage.py
    }
    
    // Check for common Python directories
    const pythonDirs = ['src', 'lib', 'app', 'tests', 'test'];
    let foundDirs = 0;
    
    for (const dir of pythonDirs) {
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
      result.evidence.push(`Found Python project structure (${foundDirs} directories)`);
    }
    
    // Try to detect Python version from pyproject.toml
    try {
      const pyprojectPath = path.join(fullPath, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      
      // Look for python version requirement
      const versionMatch = content.match(/python\s*[>=<]+\s*["']?(\d+\.\d+)/i);
      if (versionMatch) {
        result.version = versionMatch[1];
        result.evidence.push(`Python ${versionMatch[1]}+`);
      }
    } catch {
      // No pyproject.toml or couldn't parse
    }
    
    // Check for testing frameworks in requirements.txt
    try {
      const requirementsPath = path.join(fullPath, 'requirements.txt');
      const content = await fs.readFile(requirementsPath, 'utf-8');
      
      const testFrameworks = [
        { pattern: /pytest/i, display: 'pytest' },
        { pattern: /unittest/i, display: 'unittest' },
        { pattern: /nose/i, display: 'nose' },
      ];
      
      for (const framework of testFrameworks) {
        if (framework.pattern.test(content)) {
          result.evidence.push(`${framework.display} test framework detected`);
          break;
        }
      }
      
      // Check for common frameworks - collect all detected frameworks
      const frameworks = [
        { pattern: /django/i, display: 'Django' },
        { pattern: /flask/i, display: 'Flask' },
        { pattern: /fastapi/i, display: 'FastAPI' },
        { pattern: /tornado/i, display: 'Tornado' },
        { pattern: /celery/i, display: 'Celery' },
      ];
      
      for (const framework of frameworks) {
        if (framework.pattern.test(content)) {
          result.evidence.push(`${framework.display} detected`);
        }
      }
    } catch {
      // No requirements.txt
    }
    
    return result;
  },
  
  async generateConfig(rootDir: string, relativePath: string) {
    return generatePythonConfig(rootDir, relativePath);
  },
};

