/**
 * Rules engine for the agent review plugin.
 *
 * Built-in rules are extracted from the former monolithic system prompt.
 * Each rule carries its prompt fragment and trigger conditions so the
 * system prompt can be assembled dynamically per-PR.
 */

import type { ReviewContext } from '../../plugin-types.js';
import type { ReviewRule, ResolvedRules } from './types.js';

// ---------------------------------------------------------------------------
// Regex Safety
// ---------------------------------------------------------------------------

/** Reject patterns with nested quantifiers that cause catastrophic backtracking. */
const REDOS_PATTERN = /\([^)]*(?:[+*?]|\{)\)\s*(?:[+*?]|\{)/;

/** Compile a regex pattern, returning null for invalid syntax or ReDoS-prone patterns. */
function safeRegex(pattern: string): RegExp | null {
  if (REDOS_PATTERN.test(pattern)) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trigger Context
// ---------------------------------------------------------------------------

/** PR-derived context used to evaluate rule triggers. */
export interface TriggerContext {
  /** Unique languages detected across all changed file chunks. */
  languages: Set<string>;
  /** Changed file paths. */
  changedFiles: string[];
  /** Combined diff text for keyword matching. */
  diffText: string;
}

/** Extract trigger context from the review context. */
export function buildTriggerContext(context: ReviewContext): TriggerContext {
  const languages = new Set<string>();
  for (const chunk of context.chunks) {
    if (chunk.metadata.language) {
      languages.add(chunk.metadata.language);
    }
  }

  let diffText = '';
  if (context.pr?.patches) {
    diffText = [...context.pr.patches.values()].join('\n');
  }

  return {
    languages,
    changedFiles: context.allChangedFiles ?? context.changedFiles,
    diffText,
  };
}

// ---------------------------------------------------------------------------
// Rule Selection
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (any non-separator), `**` (any path), and `?` (single char).
 */
export function globToRegex(pattern: string): RegExp {
  // Protect glob chars with placeholders, escape the rest, then expand
  const re = pattern
    .replace(/\*\*\//g, '\0GLOBSTAR_SEP\0') // **/ → zero or more dirs (with separator)
    .replace(/\*\*/g, '\0GLOBSTAR\0') // ** alone → any path
    .replace(/\*/g, '\0STAR\0') // * → placeholder
    .replace(/\?/g, '\0QUESTION\0') // ? → placeholder
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials
    .replace(/\0GLOBSTAR_SEP\0/g, '(?:.*/)?') // **/ = zero or more dirs ending with /
    .replace(/\0GLOBSTAR\0/g, '.*') // ** = any path
    .replace(/\0STAR\0/g, '[^/]*') // * = non-separator wildcard
    .replace(/\0QUESTION\0/g, '[^/]'); // ? = single non-separator char
  return new RegExp(`^${re}$`);
}

/** Check if a rule's triggers match the given context. */
function ruleMatchesTriggers(rule: ReviewRule, ctx: TriggerContext): boolean {
  if (!rule.enabled) return false;

  const t = rule.triggers;
  if (t.always) return true;
  if (t.languages?.some(lang => ctx.languages.has(lang))) return true;
  if (
    t.filePatterns?.some(pat => {
      const re = globToRegex(pat);
      return ctx.changedFiles.some(f => re.test(f));
    })
  )
    return true;
  if (t.keywords) {
    // If diff text is unavailable, fail-open: include keyword rules
    // rather than silently skipping them (e.g., CLI mode without patches)
    if (!ctx.diffText) return true;
    for (const kw of t.keywords) {
      if (safeRegex(kw)?.test(ctx.diffText)) return true;
    }
  }

  return false;
}

/** Select which rules are active for this PR based on trigger conditions. */
export function selectRules(rules: ReviewRule[], ctx: TriggerContext): ResolvedRules {
  const active: ReviewRule[] = [];
  const skipped: string[] = [];

  for (const rule of rules) {
    if (ruleMatchesTriggers(rule, ctx)) {
      active.push(rule);
    } else {
      skipped.push(rule.id);
    }
  }

  return { active, skipped };
}

// ---------------------------------------------------------------------------
// Built-in Rules
// ---------------------------------------------------------------------------

const STRUCTURAL_ANALYSIS: ReviewRule = {
  id: 'structural-analysis',
  name: 'Structural Caller Impact',
  description: 'Check if changed exports break callers or remove symbols still imported elsewhere',
  prompt: `### Structural Analysis
Use tools to understand impact:
1. Use get_files_context on changed files to understand imports/exports
2. Use get_dependents on every changed/exported symbol to find callers
3. **CRITICAL**: If the diff removes exports from a barrel/index file, you MUST use grep_codebase for EACH removed symbol name to check if any file still imports it. This is the #1 source of breaking changes in deletion PRs. Do not skip this step.
4. Check if callers handle new behavior correctly
5. Use read_file to get the FULL body of every changed function (not just the diff)`,
  example: `### Good finding — structural, caller broken:
{
  "filepath": "src/api.ts",
  "line": 28,
  "symbolName": "fetchUser",
  "severity": "error",
  "category": "breaking_change",
  "ruleId": "structural-analysis",
  "message": "fetchUser now returns undefined instead of throwing on 404. The 3 callers in UserService (lines 45, 67, 89) use try/catch and will silently receive undefined, treating missing users as successful empty responses.",
  "suggestion": "Either restore the throw behavior, or update all 3 callers to check for undefined.",
  "evidence": "Phase 1 structural analysis — get_dependents found 3 callers"
}`,
  triggers: { always: true },
  severity: 'error',
  category: 'breaking_change',
  enabled: true,
  source: 'builtin',
};

const EDGE_CASE_SWEEP: ReviewRule = {
  id: 'edge-case-sweep',
  name: 'Edge Case Sweep',
  description:
    'Mentally execute changed functions with zero, negative, NaN, null, empty, and boundary inputs',
  prompt: `### Edge Case Sweep
For EACH changed or new function, read its full body and mentally execute it with these inputs:
- Zero (0, both args 0)
- Negative numbers (are signs handled correctly?)
- NaN, Infinity, -Infinity (do they silently produce wrong output?)
- null/undefined (in JS/TS, what if a caller passes undefined?)
- Empty inputs (empty string, empty array, empty object)
- Boundary values (very large numbers, MAX_SAFE_INTEGER)
- Asymmetry (does positive vs negative behave consistently when it should?)

For each input: trace through the code step by step, determine what it returns, and decide if that's correct.`,
  example: `### Good finding — specific input, traced through code:
{
  "filepath": "src/math.ts",
  "line": 15,
  "symbolName": "percentChange",
  "severity": "error",
  "category": "logic_error",
  "ruleId": "edge-case-sweep",
  "message": "percentChange(-100, -50) returns '-50% ↓' but the value improved (moved toward zero). The division by negative 'before' inverts the sign: (-50 - -100) / -100 = -0.5, so pct = -50, triggering the '↓' branch. Callers using this for complexity deltas will see 'worse' when the metric actually improved.",
  "suggestion": "Normalize the denominator: Math.abs(before). Change to: const pct = Math.round(((after - before) / Math.abs(before)) * 100);",
  "evidence": "Phase 2 edge case sweep — negative input check"
}

### Good finding — NaN propagation:
{
  "filepath": "src/utils.ts",
  "line": 42,
  "symbolName": "formatRatio",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "edge-case-sweep",
  "message": "formatRatio(NaN, 5) returns '0%' instead of indicating an error. NaN !== 0 passes the guard, then pct = Math.round(NaN) = NaN, which is neither > 0 nor < 0, so the function falls through to return '0%'. Silent wrong output.",
  "suggestion": "Add guard: if (!isFinite(a) || !isFinite(b)) return 'N/A';",
  "evidence": "Phase 2 edge case sweep — NaN check"
}

### Good finding — sign computed before rounding:
{
  "filepath": "src/logger.ts",
  "line": 12,
  "symbolName": "logDelta",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "edge-case-sweep",
  "message": "logDelta(-0.4) displays '+0'. The sign is derived from the raw value (sign = delta >= 0 ? '+' : ''), then Math.round is applied separately. For delta = -0.4: sign = '' (since -0.4 < 0... wait, -0.4 IS < 0, so sign = ''). Then Math.round(-0.4) = 0. Output: '0'. But this loses the fact that the delta was negative. More critically: if sign logic uses >= 0 instead of > 0, then delta = -0.0 would get sign = '+', producing '+0' for a zero-crossing negative value.",
  "suggestion": "Round first, then derive sign from the rounded value: const rounded = Math.round(delta); const sign = rounded > 0 ? '+' : '';",
  "evidence": "Phase 2 edge case sweep — rounding near zero"
}`,
  triggers: { always: true },
  severity: 'warning',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

const CONCURRENCY_RACE: ReviewRule = {
  id: 'concurrency-race',
  name: 'Concurrency & Race Conditions',
  description:
    'Check for TOCTOU, lock ordering, and unprotected check-then-act patterns in concurrent code',
  prompt: `### Concurrency Check
For code with DB transactions, locks, or shared state:
- **TOCTOU**: Is there a check (exists(), find(), count()) that runs BEFORE a lock is acquired? If so, two concurrent callers can both pass the check before either acquires the lock → duplicates or corruption.
- **Lock ordering**: Does lockForUpdate/mutex come BEFORE or AFTER the condition it protects? The lock must come first.
- **Check-then-act inside transactions**: If a transaction does "if (exists()) return" then "lockForUpdate()", the exists() check is unprotected. The lock must wrap the check.`,
  example: `### Good finding — TOCTOU race condition:
{
  "filepath": "src/services/credit.ts",
  "line": 45,
  "symbolName": "refundCredit",
  "severity": "error",
  "category": "logic_error",
  "ruleId": "concurrency-race",
  "message": "TOCTOU race condition: the idempotency check CreditTransaction::where(...)->exists() on line 45 runs before lockForUpdate() on line 50. Two concurrent refund requests can both pass the exists() check (neither has locked yet), then both acquire the lock sequentially and create duplicate refund transactions.",
  "suggestion": "Move lockForUpdate() before the exists() check, or use a unique constraint + INSERT ON CONFLICT to make the operation atomic.",
  "evidence": "Phase 2 concurrency check — check-then-act without lock protection"
}`,
  triggers: {
    keywords: [
      'transaction',
      'lockForUpdate',
      'mutex',
      'lock\\(',
      'synchronized',
      'atomic',
      'Lock\\(',
      'RLock\\(',
      'select.*for update',
      'advisory_lock',
      'LOCK TABLES',
      'DB::transaction',
      'beginTransaction',
      'Mutex::',
      'sync\\.Mutex',
      'ReentrantLock',
    ],
  },
  severity: 'error',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

const INCOMPLETE_HANDLING: ReviewRule = {
  id: 'incomplete-handling',
  name: 'Incomplete Interface/Type Handling',
  description:
    'Check for interface fields, enum variants, or union members declared but silently ignored by consuming code',
  prompt: `### Incomplete Handling Check
When a function consumes a typed object (interface, type, config, options), check that ALL declared fields are actually handled:
- **Unread fields**: An interface declares field X, but the function that processes it never reads X. Callers who set X will get silent no-ops.
- **Missing cases**: A switch/if-else chain over a union or enum doesn't cover all variants. New variants fall through silently.
- **Partial iteration**: A function iterates over some properties of a config/options object but skips others that affect behavior.
- **Declared but unimplemented**: A type defines a contract (e.g., trigger conditions, handler map, feature flags), but the implementation only handles a subset. This is especially dangerous when the type is part of a public API or config schema — users will set the field expecting it to work.

Focus on fields/variants introduced or modified in this PR. If a new field is added to a type, grep for all consumers and verify they handle it.`,
  example: `### Good finding — interface field declared but never consumed:
{
  "filepath": "src/rules.ts",
  "line": 54,
  "symbolName": "ruleMatchesTriggers",
  "severity": "error",
  "category": "logic_error",
  "ruleId": "incomplete-handling",
  "message": "RuleTriggers.filePatterns is declared in the interface (types.ts:53) but ruleMatchesTriggers never reads it. Rules with only filePatterns triggers will silently fail to activate, since the function checks 'always', 'languages', and 'keywords' but skips 'filePatterns'.",
  "suggestion": "Add a filePatterns check: if (t.filePatterns?.some(pat => ctx.changedFiles.some(f => matchGlob(f, pat)))) return true;",
  "evidence": "Incomplete handling check — interface field declared but not consumed by processing function"
}`,
  triggers: { languages: ['typescript', 'java', 'csharp', 'go', 'rust', 'php'] },
  severity: 'error',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

const ERROR_SWALLOWING: ReviewRule = {
  id: 'error-swallowing',
  name: 'Silent Error Swallowing',
  description:
    'Check for catch/except/rescue blocks that discard errors silently, hiding failures from callers',
  prompt: `### Silent Error Swallowing Check
For EACH error-handling block introduced or modified in this PR, check whether the error is actually handled or silently discarded:
- **Empty catch/except**: A catch block with no body, or only a comment. The error vanishes — callers believe the operation succeeded.
- **Log-only catch**: A catch that logs but doesn't rethrow, return an error, or set a failure state. Callers still receive a "success" result built from undefined/null/zero-value state.
- **Blanket catch**: Catching a broad exception type (Exception, Error, object, BaseException) when only a specific error was expected. Masks unrelated failures like OOM or type errors.
- **Discarded error return**: In Go, \`_ = err\` or \`if err != nil { return nil }\` without propagating the error. The caller has no way to know the operation failed.
- **Promise swallowing**: \`.catch(() => {})\` or \`.catch(() => undefined)\` — the rejection is consumed and the chain continues with undefined as if it succeeded.

The key question: if this operation fails, will the caller know? If the answer is no, that's a bug.`,
  example: `### Good finding — catch block swallows error, caller sees stale data:
{
  "filepath": "src/services/config.ts",
  "line": 82,
  "symbolName": "loadConfig",
  "severity": "error",
  "category": "error_handling",
  "ruleId": "error-swallowing",
  "message": "The catch block on line 82 logs the error but returns the default config object instead of propagating the failure. Callers of loadConfig() will silently receive defaults when the config file is corrupt or permissions are wrong, with no indication that the loaded config is not the user's actual config.",
  "suggestion": "Either rethrow the error, or return a result type that distinguishes 'loaded defaults' from 'loaded user config' so callers can react appropriately.",
  "evidence": "Error swallowing check — catch logs but returns success value"
}`,
  triggers: {
    keywords: [
      'catch\\s*\\(',
      'catch\\s*\\{',
      '\\.catch\\(',
      'except\\s*:',
      'except\\s+\\w',
      'rescue\\b',
      'if err != nil',
      'recover\\(',
    ],
  },
  severity: 'warning',
  category: 'error_handling',
  enabled: true,
  source: 'builtin',
};

const BOUNDARY_CHANGE: ReviewRule = {
  id: 'boundary-change',
  name: 'Threshold / Boundary Condition Change',
  description:
    'Flag diffs that shift comparison boundaries, threshold constants, or classification cutoffs without caller impact analysis',
  prompt: `### Threshold / Boundary Change Check
When the diff modifies a comparison operator (>, <, >=, <=, ===, !==),
a numeric threshold, or a classification cutoff in an exported function:

1. Do NOT accept the author's framing at face value. "Off-by-one fix"
   and "minor correction" are claims to verify, not conclusions.
2. Consult the <blast_radius> section — every listed dependent is a
   caller whose behavior now shifts at the new boundary value.
3. Check whether any test covers the new boundary value. If no test
   exercises the exact input at which behavior now differs, flag it:
   a passing test suite after a threshold change means the boundary
   was untested, not that the change is safe.
4. For each uncovered dependent (✗ in the blast_radius table), name
   the specific input where old and new semantics diverge and the
   downstream cascade into that dependent.`,
  example: `### Good finding — threshold drift with uncovered boundary:
{
  "filepath": "packages/parser/src/risk/blast-radius-risk.ts",
  "line": 68,
  "symbolName": "classifyLevel",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "boundary-change",
  "message": "Changing \`> 5\` to \`>= 5\` silently reclassifies dependentCount === 5 from 'low' to 'medium'. No existing test covers the boundary value 5, so the passing suite does not validate the new behavior. Per <blast_radius>, both buildEntry and computeGlobalRisk call classifyLevel via computeBlastRadiusRisk, and both cascade into the agent's global risk score — a 5-dependent PR now surfaces 'medium risk' instead of 'low'.",
  "suggestion": "Add a test case for dependentCount === 5 covering the intended behavior, then decide whether the shift is actually desired. If it is, note the behavior change in the commit and update any call-site thresholds that depend on 'low at 5'.",
  "evidence": "Boundary-change check — operator shift with no test at the new boundary value"
}`,
  triggers: {
    keywords: [
      // Comparison operators in threshold-like diffs. Cover negative and
      // float literals and include the equality operators the rule prompt
      // explicitly mentions. Lien Review (PR #521) caught the earlier
      // version missing === / !== and negatives.
      //
      // Note: character class [\d.]+ is a trigger heuristic — not a strict
      // numeric parser — because nested-quantifier groups like \d+(\.\d+)?
      // trip the local REDOS_PATTERN in safeRegex (rules.ts:16) and would
      // be silently dropped.
      '>=\\s*[-+]?[\\d.]+',
      '<=\\s*[-+]?[\\d.]+',
      '>\\s*[-+]?[\\d.]+',
      '<\\s*[-+]?[\\d.]+',
      '===\\s*[-+]?[\\d.]+',
      '!==\\s*[-+]?[\\d.]+',
      // Semantic markers common in threshold/classification code
      '\\bthreshold\\b',
      '\\bboundary\\b',
      '\\bcutoff\\b',
      'classify\\w*',
      'severity',
    ],
  },
  requiresBlastRadius: true,
  severity: 'warning',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

/** All built-in review rules. */
export const BUILTIN_RULES: ReviewRule[] = [
  STRUCTURAL_ANALYSIS,
  EDGE_CASE_SWEEP,
  CONCURRENCY_RACE,
  INCOMPLETE_HANDLING,
  ERROR_SWALLOWING,
  BOUNDARY_CHANGE,
];
