/**
 * Run lien complexity analysis via CLI
 */
import type { ComplexityReport } from './types.js';
/**
 * Run lien complexity command on specified files
 */
export declare function runComplexityAnalysis(files: string[], threshold: string): Promise<ComplexityReport | null>;
/**
 * Filter files to only include those that can be analyzed
 * (excludes non-code files, vendor, node_modules, etc.)
 */
export declare function filterAnalyzableFiles(files: string[]): string[];
