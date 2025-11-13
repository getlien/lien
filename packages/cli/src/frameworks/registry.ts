import { FrameworkDetector } from './types.js';
import { nodejsDetector } from './nodejs/detector.js';
import { laravelDetector } from './laravel/detector.js';

/**
 * Registry of all available framework detectors
 * Frameworks will be added as they are implemented
 */
export const frameworkDetectors: FrameworkDetector[] = [
  nodejsDetector,
  laravelDetector,
];

/**
 * Register a framework detector
 */
export function registerFramework(detector: FrameworkDetector): void {
  // Check if already registered
  const existing = frameworkDetectors.find(d => d.name === detector.name);
  if (existing) {
    console.warn(`Framework detector '${detector.name}' is already registered, skipping`);
    return;
  }
  
  frameworkDetectors.push(detector);
}

/**
 * Get a framework detector by name
 */
export function getFrameworkDetector(name: string): FrameworkDetector | undefined {
  return frameworkDetectors.find(d => d.name === name);
}

