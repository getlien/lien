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
 *     Walks the `ret` AST (already a transitive dependency of safe-regex2,
 *     which uses it internally for its own star-height check) instead of
 *     pattern-matching the source string. That fixes two real bugs a
 *     string-based check can't: it sees through any number of
 *     non-quantified wrapper groups around the alternation — `((a|a))+`
 *     is exploitable exactly like `(a|a)+` — and it compares real
 *     alternation branches instead of `|`-delimited substrings, so a `|`
 *     inside a character class (`[a|b]`) or escaped (`\|`) can't be
 *     mistaken for a branch boundary.
 *
 * Returns null for invalid syntax, oversized patterns, or patterns
 * rejected by either ReDoS check.
 */

import safeRegex2 from 'safe-regex2';
import tokenizer, { types, reconstruct } from 'ret';
import type { Token } from 'ret';

/** Hard cap on pattern length, enforced before any analysis runs. */
const MAX_PATTERN_LENGTH = 256;

/** Renders an alternation branch (a token sequence) back to source text so
 * branches can be compared case-insensitively (patterns here always
 * compile with the `i` flag). */
function renderBranch(branch: Token[]): string {
  return reconstruct({ type: types.ROOT, stack: branch }).toLowerCase();
}

/**
 * True if `token`'s subtree contains a group with two alternation branches
 * that render to the same text, e.g. `(a|a)` or `(a|A)` — but only once
 * `insideRepetition` is true, since a duplicate branch is only exploitable
 * once something repeats it. Recurses through groups and repetitions (the
 * only token kinds that hold nested tokens) so a duplicate stays "in
 * danger" through any depth of plain wrapper groups, e.g. `((a|a))+`.
 */
function hasDangerousDuplicateBranch(token: Token, insideRepetition: boolean): boolean {
  if (token.type === types.GROUP) {
    if (token.options) {
      if (insideRepetition) {
        const branches = token.options.map(renderBranch);
        if (new Set(branches).size !== branches.length) {
          return true;
        }
      }
      return token.options.some(branch =>
        branch.some(t => hasDangerousDuplicateBranch(t, insideRepetition)),
      );
    }
    return (token.stack ?? []).some(t => hasDangerousDuplicateBranch(t, insideRepetition));
  }
  if (token.type === types.REPETITION) {
    return hasDangerousDuplicateBranch(token.value, true);
  }
  return false;
}

function hasDuplicateAlternationBranch(pattern: string): boolean {
  try {
    const root = tokenizer(pattern);
    const tokens = root.stack ?? root.options?.flat() ?? [];
    return tokens.some(token => hasDangerousDuplicateBranch(token, false));
  } catch {
    // Invalid syntax is handled by the `new RegExp` call below.
    return false;
  }
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
