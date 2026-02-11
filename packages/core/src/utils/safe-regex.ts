/**
 * Validate and compile a regex pattern, rejecting ReDoS-prone patterns.
 *
 * Returns null for invalid syntax or patterns with nested quantifiers
 * that could cause catastrophic backtracking.
 */

const REDOS_PATTERN = /\([^)]*(?:[+*?]|\{)\)\s*(?:[+*?]|\{)/;

export function safeRegex(pattern: string): RegExp | null {
  if (REDOS_PATTERN.test(pattern)) {
    return null;
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}
