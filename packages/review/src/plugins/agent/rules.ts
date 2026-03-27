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
    changedFiles: context.changedFiles,
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
    .replace(/\*\*\/?/g, '\0GLOBSTAR\0') // ** (with optional /) → placeholder
    .replace(/\*/g, '\0STAR\0') // * → placeholder
    .replace(/\?/g, '\0QUESTION\0') // ? → placeholder
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials
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
    for (const kw of t.keywords) {
      try {
        if (new RegExp(kw, 'i').test(ctx.diffText)) return true;
      } catch {
        // Invalid regex pattern — skip (relevant for custom rules)
      }
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

/** All built-in review rules. */
export const BUILTIN_RULES: ReviewRule[] = [
  STRUCTURAL_ANALYSIS,
  EDGE_CASE_SWEEP,
  CONCURRENCY_RACE,
  INCOMPLETE_HANDLING,
];
