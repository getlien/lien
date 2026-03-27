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
    for (const [, patch] of context.pr.patches) {
      diffText += patch + '\n';
    }
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

/** Check if a rule's triggers match the given context. */
function ruleMatchesTriggers(rule: ReviewRule, ctx: TriggerContext): boolean {
  if (!rule.enabled) return false;

  const t = rule.triggers;
  if (t.always) return true;
  if (t.languages?.some(lang => ctx.languages.has(lang))) return true;
  if (t.keywords?.some(kw => new RegExp(kw, 'i').test(ctx.diffText))) return true;

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

/** All built-in review rules. */
export const BUILTIN_RULES: ReviewRule[] = [STRUCTURAL_ANALYSIS, EDGE_CASE_SWEEP, CONCURRENCY_RACE];
