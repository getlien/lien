/**
 * Which changed files a signal pass can say anything about.
 *
 * Lifted from the review engine alongside the signal modules — it is the gate
 * they run their inputs through, and it depends on nothing but the parser's own
 * supported-extension set.
 */

import { getSupportedExtensions } from '../ast/languages/registry.js';

/**
 * Files that carry an extension the parser understands but whose contents are
 * not authored source: vendored trees, build output, bundles, lockfiles.
 * Reporting a candidate inside one of these is always noise.
 */
const EXCLUDE_PATTERNS = [
  /node_modules\//,
  /vendor\//,
  /dist\//,
  /build\//,
  /\.min\./,
  /\.bundle\./,
  /\.generated\./,
  /package-lock\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
];

/**
 * Filter files to those the parser can analyze — a supported extension, and
 * not vendored, generated, or build output.
 */
export function filterAnalyzableFiles(files: string[]): string[] {
  const codeExtensions = new Set(getSupportedExtensions().map(ext => `.${ext}`));

  return files.filter(file => {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!codeExtensions.has(ext)) {
      return false;
    }

    return !EXCLUDE_PATTERNS.some(pattern => pattern.test(file));
  });
}
