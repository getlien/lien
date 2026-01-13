import { FrameworkDetector } from './types.js';
import { nodejsDetector } from './nodejs/detector.js';
import { phpDetector } from './php/detector.js';
import { pythonDetector } from './python/detector.js';
import { laravelDetector } from './laravel/detector.js';
import { shopifyDetector } from './shopify/detector.js';

/**
 * Registry of all available framework detectors
 * Frameworks will be added as they are implemented
 * 
 * Order doesn't matter for detection as priority system handles conflicts,
 * but listed here in order from generic to specific for clarity:
 * - Generic language detectors (Node.js, PHP, Python)
 * - Specific framework detectors (Laravel, Shopify)
 */
export const frameworkDetectors: FrameworkDetector[] = [
  nodejsDetector,
  phpDetector,
  pythonDetector,
  laravelDetector,
  shopifyDetector,
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

