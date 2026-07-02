/**
 * Validate and compile a regex pattern, rejecting ReDoS-prone patterns.
 *
 * Reachable from external input (e.g. the `list_functions` MCP tool's
 * `pattern` arg), so a pattern that slips through and hangs `.test()` is a
 * denial-of-service against the (single-threaded) `lien serve` process.
 *
 * Defense in depth, cheapest check first:
 *  1. Reject patterns over MAX_PATTERN_LENGTH before any analysis runs.
 *  2. `safe-regex2` rejects nested-quantifier ("evil regex") patterns like
 *     `(a+)+` via star-height analysis. Maintained, pure JS, single small
 *     dependency (`ret`), no native code or install scripts.
 *  3. `hasDuplicateAlternationBranch` closes a blind spot shared by every
 *     star-height checker (safe-regex2 included): they only look at
 *     repetition *nesting*, not ambiguity *within* a single repeated
 *     alternation, so `(a|a)+` sails through as "safe". A repeated group
 *     with two branches that match the same text lets the engine explore
 *     exponentially many ways to split that text between the branches —
 *     confirmed via live repro: `(a|a)+$`.test() against a 26-char string
 *     took ~3.5s, growing exponentially per added character.
 *
 * Returns null for invalid syntax, oversized patterns, or patterns
 * rejected by either ReDoS check.
 */

import safeRegex2 from 'safe-regex2';

/** Hard cap on pattern length, enforced before any analysis runs. */
const MAX_PATTERN_LENGTH = 256;

/**
 * Matches a parenthesized group immediately followed by a quantifier
 * (`+`, `*`, `?`, or `{m,n}`) — e.g. the `(a|a)+` in `(a|a)+$`.
 *
 * Only matches non-nested groups. Nested-quantifier ReDoS (`(a+)+`) is
 * caught separately by `safe-regex2`, and this regex itself has no
 * quantifier-of-quantifier or ambiguous-alternation shape, so it can't
 * exhibit the same catastrophic backtracking it's built to detect.
 */
const QUANTIFIED_GROUP = /\(([^()]*)\)\s*(?:[+*?]|\{\d*,?\d*\})/g;

/** Strips a leading non-capturing/named/lookaround group marker (e.g.
 * `?:`, `?<name>`, `?=`, `?!`, `?<=`, `?<!`) so the remainder can be split
 * on top-level `|` branches. */
function stripGroupMarker(groupBody: string): string {
  return groupBody.replace(/^\?(?:[:=!]|<[=!]?[^>]*>)/, '');
}

/**
 * True if any quantified group contains two alternation branches that are
 * identical once case is normalized (patterns here always compile with the
 * `i` flag), e.g. `(a|a)+` or `(a|A)+`.
 */
function hasDuplicateAlternationBranch(pattern: string): boolean {
  return [...pattern.matchAll(QUANTIFIED_GROUP)].some(match => {
    const branches = stripGroupMarker(match[1])
      .split('|')
      .map(branch => branch.toLowerCase());
    return new Set(branches).size !== branches.length;
  });
}

export function safeRegex(pattern: string): RegExp | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return null;
  }
  if (!safeRegex2(pattern) || hasDuplicateAlternationBranch(pattern)) {
    return null;
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}
