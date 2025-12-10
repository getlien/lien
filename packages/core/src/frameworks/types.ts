import { FrameworkConfig } from '../config/schema.js';

/**
 * Result of framework detection
 */
export interface DetectionResult {
  detected: boolean;
  name: string;          // 'nodejs', 'laravel'
  path: string;          // Relative path from root: '.', 'packages/cli', 'cognito-backend'
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];    // Human-readable evidence (e.g., "Found package.json with jest")
  version?: string;      // Framework/language version if detectable
}

/**
 * Interface for framework detectors
 */
export interface FrameworkDetector {
  name: string;          // Unique framework identifier
  
  /**
   * Priority for conflict resolution (higher = takes precedence)
   * - 100: Specific frameworks (Laravel, Rails, Django)
   * - 50: Generic frameworks (Node.js, Python)
   * - 0: Fallback/generic
   */
  priority?: number;
  
  /**
   * Detect if this framework exists at the given path
   * @param rootDir - Absolute path to project root
   * @param relativePath - Relative path from root to check (e.g., '.' or 'packages/cli')
   * @returns Detection result with evidence
   */
  detect(rootDir: string, relativePath: string): Promise<DetectionResult>;
  
  /**
   * Generate default configuration for this framework
   * @param rootDir - Absolute path to project root
   * @param relativePath - Relative path where framework was detected
   * @returns Framework-specific configuration
   */
  generateConfig(rootDir: string, relativePath: string): Promise<FrameworkConfig>;
}

/**
 * Options for framework detection
 */
export interface DetectionOptions {
  maxDepth: number;      // Maximum directory depth to scan
  skipDirs: string[];    // Directories to skip (node_modules, vendor, etc.)
}

/**
 * Default detection options
 */
export const defaultDetectionOptions: DetectionOptions = {
  maxDepth: 3,
  skipDirs: [
    'node_modules',
    'vendor',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.git',
    '.idea',
    '.vscode',
    'tmp',
    'temp',
  ],
};

