/**
 * Pure test-run classification and coverage matching for FEATURE 2 (the
 * did-you-run-the-tests verification nudge). Given a raw Bash command string,
 * decides whether it looks like a test invocation and, if so, whether it ran
 * the whole suite/workspace (`broad`) or named specific files (`scoped`,
 * with `scopeTokens`). `computeUnverifiedFiles` then answers "which edited
 * files with associated tests were never covered by an observed run?" —
 * zero I/O, zero LLM, fully unit-testable with synthetic strings.
 *
 * Matching is deliberately generous in both directions — recognizing more
 * commands as test runs, and treating more edits as "covered" — because a
 * false "you didn't test" nag defeats the nudge (see
 * docs/architecture/test-verification-nudge.md, "Conservative by
 * construction").
 */

import path from 'node:path';
import { getSupportedExtensions } from '@liendev/parser';

export interface TestRunClassification {
  isTestRun: boolean;
  /** True when the matched command has no file/scope-narrowing argument — a whole-suite run. */
  broad: boolean;
  /** Path/name-like arguments found after the runner keyword. Empty when `broad`. */
  scopeTokens: string[];
}

// Segment splitters: a shell command is split on these so a runner keyword
// buried after `cd x &&` (or `; `, `|`, `||`) is still recognized — only the
// segment containing the runner keyword is inspected for scope arguments.
const SEGMENT_SPLIT_RE = /&&|\|\||\||;/;

// Flags whose VALUE scopes a whole package/workspace, not a single file —
// `npm test -w @liendev/core` must classify as broad even though
// "@liendev/core" contains a "/". The flag and its value are both skipped
// before scanning for path-like tokens.
const WORKSPACE_SCOPE_FLAGS = new Set(['-w', '--workspace', '--filter']);

// Go's "all packages, recursively" convention. Contains a "/" but names no
// specific file, so it must not count as a scoping argument.
const GLOB_ALL_TOKENS = new Set(['./...', '...']);

// Conservative allow-list (see docs/architecture/test-verification-nudge.md
// section on runner recognition). Each pattern is anchored to the start of a
// (trimmed) command segment; the boundary `(?=\s|$)` stops "npm t" from
// matching inside "npm test".
const RUNNER_PATTERNS: RegExp[] = [
  /^npm\s+run\s+test(?=\s|$)/,
  /^npm\s+test(?=\s|$)/,
  /^npm\s+t(?=\s|$)/,
  /^yarn\s+test(?=\s|$)/,
  /^pnpm\s+--filter\s+\S+\s+test(?=\s|$)/,
  /^pnpm\s+test(?=\s|$)/,
  /^bun\s+test(?=\s|$)/,
  /^npx\s+vitest(?=\s|$)/,
  /^vitest(?=\s|$)/,
  /^jest(?=\s|$)/,
  /^mocha(?=\s|$)/,
  /^python[0-9.]*\s+-m\s+pytest(?=\s|$)/,
  /^pytest(?=\s|$)/,
  /^go\s+test(?=\s|$)/,
  /^cargo\s+nextest(?=\s|$)/,
  /^cargo\s+test(?=\s|$)/,
  /^bundle\s+exec\s+rspec(?=\s|$)/,
  /^rspec(?=\s|$)/,
  /^phpunit(?=\s|$)/,
  /^dotnet\s+test(?=\s|$)/,
  /^deno\s+test(?=\s|$)/,
  /^gradle\s+test(?=\s|$)/,
  /^mvn\s+test(?=\s|$)/,
  /^nx\s+test(?:\s+\S+)?(?=\s|$)/,
];

function matchRunner(segment: string): RegExpMatchArray | null {
  for (const pattern of RUNNER_PATTERNS) {
    const match = segment.match(pattern);
    if (match) return match;
  }
  return null;
}

function sourceExtensions(): ReadonlySet<string> {
  return new Set(getSupportedExtensions().map(ext => `.${ext}`));
}

/** A token names a file/test when it looks like a path or ends in a source extension (test files share their language's extension). */
function isPathLikeToken(token: string, extensions: ReadonlySet<string>): boolean {
  if (GLOB_ALL_TOKENS.has(token)) return false;
  if (token.includes('/')) return true;
  return [...extensions].some(ext => token.endsWith(ext));
}

/**
 * Scan the remainder of a segment after its matched runner keyword for
 * scoping arguments. Skips flags (dash-prefixed) and, for workspace-scope
 * flags specifically, their value too (a manual index loop is required here
 * to look ahead one token — not a tree-sitter AST walk, so the codebase's
 * array-methods-only rule for SyntaxNode iteration doesn't apply).
 */
function extractPathLikeTokens(remainder: string, extensions: ReadonlySet<string>): string[] {
  const tokens = remainder.trim().split(/\s+/).filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (WORKSPACE_SCOPE_FLAGS.has(token)) {
      i++; // also skip the flag's value
      continue;
    }
    if (token.startsWith('-')) continue;
    if (isPathLikeToken(token, extensions)) found.push(token);
  }
  return found;
}

/**
 * Classify a raw Bash command string. `isTestRun` is false (broad/scopeTokens
 * both empty/false) when no segment matches a recognized runner. When at
 * least one matching segment carries no scoping argument, the whole
 * classification is `broad` (a whole-suite run is present) even if another
 * segment in the same command also named specific files.
 */
export function classifyTestCommand(command: string): TestRunClassification {
  const extensions = sourceExtensions();
  const segments = command
    .split(SEGMENT_SPLIT_RE)
    .map(s => s.trim())
    .filter(Boolean);

  let isTestRun = false;
  let broad = false;
  const scopeTokens = new Set<string>();

  for (const segment of segments) {
    const match = matchRunner(segment);
    if (!match) continue;
    isTestRun = true;
    const remainder = segment.slice(match[0].length);
    const pathTokens = extractPathLikeTokens(remainder, extensions);
    if (pathTokens.length === 0) {
      broad = true;
    } else {
      pathTokens.forEach(t => scopeTokens.add(t));
    }
  }

  if (!isTestRun) return { isTestRun: false, broad: false, scopeTokens: [] };
  return { isTestRun: true, broad, scopeTokens: broad ? [] : [...scopeTokens] };
}

/** Case-insensitive basename of a scope token or associated test/file path, for generous substring matching. */
function baseKey(p: string): string {
  return path.basename(p).toLowerCase();
}

/**
 * A pending edited file is covered when any scoped run's token substring-
 * matches (either direction, case-insensitive) the file's own basename or
 * any of its associated tests' basenames. Generous on purpose — see the
 * module doc comment.
 */
function isCoveredByScope(file: string, tests: string[], scopeTokens: string[]): boolean {
  const candidates = [baseKey(file), ...tests.map(baseKey)];
  return scopeTokens.some(token => {
    const t = token.toLowerCase();
    return candidates.some(c => t.includes(c) || c.includes(t));
  });
}

/**
 * Which edited files (with associated tests) were never observed covered by
 * a test run this session. Conservative bias: if ANY observed run is broad,
 * the whole edit set is presumed exercised and this returns empty — a
 * plausible whole-suite/whole-workspace run beats a possibly-incomplete
 * per-file cross-check. Otherwise, a file is unverified unless some scoped
 * run's tokens match its basename or an associated test's basename.
 */
export function computeUnverifiedFiles(
  edits: Map<string, string[]>,
  runs: TestRunClassification[],
): Array<{ file: string; tests: string[] }> {
  if (runs.some(r => r.isTestRun && r.broad)) return [];

  const scopeTokens = runs.filter(r => r.isTestRun && !r.broad).flatMap(r => r.scopeTokens);

  const unverified: Array<{ file: string; tests: string[] }> = [];
  for (const [file, tests] of edits) {
    if (!isCoveredByScope(file, tests, scopeTokens)) unverified.push({ file, tests });
  }
  return unverified;
}
