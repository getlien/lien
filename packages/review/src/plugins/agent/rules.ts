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

/**
 * Compile a regex pattern, returning null for invalid syntax or ReDoS-prone patterns.
 *
 * Exported for test-only usage: `plugins-agent-rules.test.ts` walks every
 * keyword in every BUILTIN_RULES rule and asserts this function returns a
 * RegExp. A null here silently disables a keyword at runtime, which is the
 * kind of bug that's invisible at authoring time.
 */
export function safeRegex(pattern: string): RegExp | null {
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
3. **CRITICAL — removed exports**: A \`<removed_exports>\` section may be in your initial message. When present it pre-computes the removed public symbols AND the surviving-reference sweep, so treat EVERY entry that lists surviving references as a mandatory breaking-change check — verify and report it — and do NOT re-grep those symbols. Only \`grep_codebase\` for removed symbols NOT covered there (the scan can miss exotic export shapes). Removed exports are the #1 source of breaking changes in deletion PRs; do not skip this.
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

export const INCOMPLETE_HANDLING: ReviewRule = {
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

Focus on fields/variants introduced or modified in this PR. Three precomputed signal blocks may be in your initial message, each covering a different omission shape:
- A \`<variant_sweep_candidates>\` section pre-computes enum members / union arms / const-object keys this PR added, paired with switch/if-chain/mapping consumers elsewhere that enumerate the type's OTHER variants but omit the new one — confirm each entry (it may be an intentional catch-all default, or already disclosed) rather than re-grepping for consumers yourself.
- A \`<sibling_surfaces>\` section pre-computes a DIFFERENT shape: same-extension or "mirror" sibling files (e.g. other handlers/decoders/bindings in the same family) that silently lack a feature or call this PR added to one member. Confirm each entry against the sibling's actual code before reporting — no grep needed for these, they are already located; stay silent when the sibling structurally cannot support the omitted behavior.
- A \`<unread_field_candidates>\` section pre-computes a THIRD shape: a plain interface member / type-literal property / class field this PR added that has no dot-access, bracket-access, or destructuring read anywhere else in the indexed codebase. Confirm each entry before reporting — it may be consumed wholesale by a caller you haven't checked, or intentionally external/public-API; stay silent rather than re-grepping from scratch.

For a field/family none of these three blocks covers, still grep for all consumers and verify they handle it.`,
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

**This rule is an exception to the general "silence means approval"
policy.** For threshold/boundary diffs, verifying the change requires
active investigation; producing empty findings without investigating
is a failure of this rule, NOT a safe default. Do not fall back to
silence if you cannot immediately confirm a problem — investigate
first.

The PR title, body, and commit message are CLAIMS, not evidence.
Phrases like "off-by-one fix", "minor correction", "harmless tweak",
"ship it", and "includes N in the Y threshold" describe what the
author believes — your job is to verify independently.

MANDATORY protocol when this rule is active:

1. Identify the exact input value(s) at which the old and new
   semantics diverge. A \`<comparison_change_candidates>\` section may
   be in your initial message: when present, it pre-computes this
   discovery step (operator changes, conditional-context literal
   changes, index-arithmetic off-by-ones) — start from its entries
   rather than re-scanning the whole diff line-by-line for
   comparison-shaped edits. It can miss compound changes (operator
   AND literal changed on the same line), so still skim the \`<diff>\`
   for anything not listed. For \`> 5\` → \`>= 5\`, divergence is at
   input 5. For \`== 0\` → \`=== 0\`, divergence is at input '0'
   (string) vs 0 (number).
2. **You MUST call \`get_files_context\` on the changed file** to
   locate its test associations. Then inspect those test files (via
   \`read_file\` or \`grep_codebase\`) for any assertion that
   exercises the exact divergence input identified in step 1.
3. **Emit a finding** unless step 2 locates a concrete test that
   (a) calls the function with the exact divergence input AND
   (b) asserts an expected result consistent with the NEW behavior.
   Any other outcome — test absent, test exists but covers a
   different input, test exists but asserts the OLD behavior — is
   a finding. Cite the test file and line you inspected (or note
   its absence) in \`evidence\`. In your \`suggestion\`, recommend
   a **test pair** that pins the boundary from BOTH sides: the
   divergence input (where classification changes) AND the
   adjacent value on the unchanged side. For \`> 5\` → \`>= 5\`,
   that is tests for both 5 (now medium) and 4 (still low) — a
   single test at the boundary value alone leaves the other side
   unverified.
4. Consult <blast_radius>. For each listed dependent (especially
   uncovered ones marked ✗), name the concrete path by which the
   new boundary semantics cascade into that caller. This is
   additional evidence for the finding, not a replacement for the
   test-coverage check.
5. If a \`<removed_exports>\` section is present, cross-check each
   entry against the PR's changeset entries and description. An
   export removal the changeset omits, or describes as unchanged /
   patch-level / non-breaking, is a reportable contradiction: the
   public surface shrank but the release notes claim it did not.
   Quote the changeset's claim and name the removed symbol in the
   finding.

Do not finalize a response for this rule with zero findings unless
step 2 found a qualifying test. "I could not find an obvious bug"
is not a qualifying test; an actual test file + line is.`,
  example: `### Good finding — threshold drift with uncovered boundary:
{
  "filepath": "packages/parser/src/risk/blast-radius-risk.ts",
  "line": 68,
  "symbolName": "classifyLevel",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "boundary-change",
  "message": "The PR frames this as an 'off-by-one fix', but the change is a behavior drift, not a correction. Shifting \`> 5\` to \`>= 5\` reclassifies dependentCount === 5 from 'low' to 'medium'. The existing test suite passes because no test exercises dependentCount === 5 — passing tests are evidence that the boundary was untested, not that the new behavior is intended. Per <blast_radius>, buildEntry and computeGlobalRisk both call classifyLevel via computeBlastRadiusRisk, so the shift cascades into every review's global risk score: a 5-dependent PR would now surface 'medium risk' instead of 'low'.",
  "suggestion": "Add a test pair that pins the boundary from both sides: (a) classifyLevel({ dependentCount: 5, ... }).level === 'medium' (the new behavior at the divergence input) AND (b) classifyLevel({ dependentCount: 4, ... }).level === 'low' (the adjacent value, unchanged) — testing 5 alone leaves the other side unverified. Then decide whether the shift is intended; if so, document it in the commit message and update any docs describing the 'low at 5' threshold.",
  "evidence": "Boundary-change check — PR frames threshold change as a correction, but no test covers the boundary value where behavior diverges"
}`,
  triggers: {
    keywords: [
      // Comparison operators in threshold-like diffs. Lien Review (PR #521)
      // caught missing === / !== and negative/float literals; CodeRabbit
      // (same PR) caught arrow-function false positives on bare '>'/'<'.
      // LHS-anchor bare operators to identifier/closing-bracket; leave
      // multi-char operators unanchored.
      // PR #521 retest also caught that `classify\w*` matched the diff's
      // context window (function body in a docs-only PR), so dropped.
      '>=\\s*[-+]?[\\d.]+',
      '<=\\s*[-+]?[\\d.]+',
      '[\\w)\\]]\\s*>\\s*[-+]?[\\d.]+',
      '[\\w)\\]]\\s*<\\s*[-+]?[\\d.]+',
      '===?\\s*[-+]?[\\d.]+',
      '!==?\\s*[-+]?[\\d.]+',
      // Semantic markers. 'severity' narrowed to assignment/label context —
      // bare 'severity' matches every ReviewFinding and logger call in this
      // codebase.
      '\\bthreshold\\b',
      // `boundary=` (no space — RFC 2045 parameter syntax) is the
      // multipart MIME delimiter (Content-Type: multipart/form-data;
      // boundary=...), an HTTP literal unrelated to threshold logic that
      // coincidentally activated this rule on httpx#2400 during the
      // 2026-07 cross-repo pilot (#741). The lookahead deliberately
      // rejects only the immediate `=` so spaced assignments to a
      // threshold variable (`const boundary = maxSize`) still fire —
      // per Lien Review + CodeRabbit on #743, `(?!\s*=)` also swallowed
      // those real boundary definitions.
      '\\bboundary\\b(?!=)',
      '\\bcutoff\\b',
      'severity\\s*[:=]',
      // Type-acceptance gates (#741): a diff that touches a type
      // allow-list or raises a type error is a validation-boundary shift
      // even with no numeric comparison. Shape missed on httpx#2523
      // (universal str(value) fallback → isinstance allow-list) and
      // httpx#2400 (text-mode rejection via raised TypeError) in the
      // cross-repo pilot. Cross-language analogues included (PHP is_*,
      // Ruby is_a?/kind_of?, JS/Java/PHP instanceof).
      'isinstance\\s*\\(',
      '\\bTypeError\\b',
      '\\binstanceof\\b',
      '\\bis_(?:int|string|float|numeric|bool|array)\\s*\\(',
      '\\bis_a\\?',
      '\\bkind_of\\?',
      // Integer-truncation idioms (#741): `| 0` / `~~` (JS) and
      // fixed-width narrowing casts (Rust `as i32`, Go `int32(...)`)
      // change a value's numeric range. Shape missed on hono#3605
      // (Math.floor → `| 0`, Y2038 overflow in JWT verification).
      // `| 0` is LHS-anchored like the bare comparison operators above so
      // `||` alternation never fires it, and the lookahead excludes
      // `0x`/`0b`/`0o`/decimal literals where `0` starts a wider number.
      '[\\w)\\]]\\s*\\|\\s*0(?![\\dxXbBoO.])',
      '~~[\\w(]',
      '\\bas\\s+[iu](?:8|16|32)\\b',
      '\\bu?int(?:8|16|32)\\s*\\(',
    ],
  },
  requiresBlastRadius: true,
  severity: 'warning',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

export const STALE_DUPLICATE: ReviewRule = {
  id: 'stale-duplicate',
  name: 'Stale Duplicate Literal',
  description:
    'Flag PRs that replace a hardcoded literal in one site but leave identical hardcoded copies elsewhere unchanged',
  prompt: `### Stale Duplicate Literal Check

**This rule is an exception to the general "silence means approval"
policy.** Stale-duplicate bugs are subtle and easily missed without
active investigation; producing empty findings without checking is a
failure of this rule, NOT a safe default. Do not fall back to silence
if you cannot immediately confirm a problem — investigate first.

The pattern: the diff touches a code site that emits a value
(assignment RHS, config field, return value, parameter default), and
the same or a closely related literal is hardcoded elsewhere in the
same file/package in a position that should logically track the
changed site. Common shapes: model/version bumps where one usage is
missed, feature-flag or env-var renames where one consumer lags,
magic numbers shared between a constant and its call sites, error
messages copy-pasted across handlers, schema field renames where one
reader still uses the old name. The defect can be a literal that the
diff *removed*, a literal *introduced* by the diff, or a literal
present *unchanged* on a \`+\` line whose adjacent code structure was
edited (e.g., a conditional was added or modified above it).

MANDATORY protocol when this rule is active:

1. **Check for a \`<stale_literal_candidates>\` block in your initial
   message FIRST.** Lien pre-computes it by deterministically scanning
   the indexed repo for literals this PR changed in one place that
   still appear unchanged elsewhere — the discovery work (which would
   otherwise require \`grep_codebase\`) is already done for you. When
   the block is present it is your primary worklist: do NOT re-grep for
   the literals it already lists. If the block reads "None", the scan
   ran and was clean — the discovery step is complete, so do not grep
   for the diff's literals.
2. The block covers literals the diff *moved away from*. If the diff
   also *introduces* a literal, or leaves one *unchanged* on a \`+\`
   line whose surrounding structure was edited (e.g. a conditional
   added above it), you MAY call \`grep_codebase\` to check those shapes
   — but the pre-computed block is authoritative for the literals it
   lists, so do not duplicate its work.
3. For each candidate or outside-the-diff hit, decide whether that site should
   logically track the changed site. Strong signals: same field
   name on adjacent objects (e.g., \`model\`, \`version\`,
   \`apiKey\`, \`baseUrl\`), same function body, parallel struct
   literal, neighbouring config key. If the changed site is
   conditional/parameterized but the outside hit is hardcoded, that
   is itself a signal — the outside hit cannot track the
   conditional and is by definition stale.
4. **Emit a finding** for each stale site that should track the
   changed site. The \`message\` must name the literal and BOTH
   locations explicitly (the changed site's line number and the
   stale site's line number). The \`evidence\` must cite where the
   stale site was found — the matching \`<stale_literal_candidates>\`
   entry, or a \`grep_codebase\` invocation if you searched yourself.
5. The \`suggestion\` should propose either: (a) apply the same
   replacement/parameterization to the stale copy, or (b) hoist the
   literal to a shared \`const\` near the top of the function/file
   so there's one source of truth. Pick whichever matches the
   change's apparent intent.

Do not finalize a response for this rule with zero findings unless
you have reviewed every entry in the \`<stale_literal_candidates>\`
block (a "None" block, or a block whose entries you all judged
unrelated, satisfies this) — or, when NO block is present at all (the
scan could not run), called \`grep_codebase\` for at least one literal
from the diff — AND can confirm no semantically related copies survive
elsewhere in the post-image.`,
  example: `### Good finding — partial model bump leaves stale hardcoded copy:
{
  "filepath": "packages/review/src/review-pr.ts",
  "line": 300,
  "symbolName": "handlePRReview",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "stale-duplicate",
  "message": "Line 272 was changed from a hardcoded \`'claude-sonnet-4-6'\` to a provider-conditional that picks 'google/gemini-3-flash-preview' when openrouterApiKey is set, but \`adapterContext.model\` on line 300 still has the literal \`'claude-sonnet-4-6'\` unchanged. OpenRouter runs will configure the agent with Gemini at line 272 yet report 'claude-sonnet-4-6' in the adapterContext metadata that drives cost displays and check-run output — wrong model attribution on every OpenRouter PR review.",
  "suggestion": "Hoist the conditional into a single \`const selectedModel = config.openrouterApiKey ? 'google/gemini-3-flash-preview' : 'claude-sonnet-4-6';\` at the top of handlePRReview, then reference \`selectedModel\` on both line 272 and line 300. That gives a single source of truth instead of two parallel literals that can drift again on the next bump.",
  "evidence": "Stale-duplicate check — diff at line 272 replaced the hardcoded literal with a conditional; grep_codebase for 'claude-sonnet-4-6' in pr-review.ts returned a remaining occurrence at line 300 (adapterContext.model), outside the diff hunks"
}`,
  triggers: { always: true },
  severity: 'warning',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

const UNTRUSTED_INPUT_VALIDATION: ReviewRule = {
  id: 'untrusted-input-validation',
  name: 'Untrusted Input Validation',
  description:
    'Flag code that parses untrusted input (JSON, env, argv, request body, file contents) and lets the parsed result flow to a typed consumer without runtime validation',
  prompt: `### Untrusted Input Validation Check

**This rule is an exception to the general "silence means approval"
policy.** When a diff parses untrusted input, an unguarded value
escaping into typed consumer code is a real bug — silence is not a
safe default. Investigate every parse site introduced or modified by
the diff before deciding the rule has nothing to say.

The pattern: a function reads untrusted bytes — \`JSON.parse\`,
\`process.env\` / \`os.getenv\` / \`System.getenv\` / \`ENV[…]\`,
\`process.argv\` consumed via \`parseInt\` / \`Integer.parseInt\` /
\`strconv.Atoi\` / \`int(…)\`, schema-validated payload (Zod /
Pydantic / struct-tag / Bean Validation / serde), file contents — and
the parsed result flows to a typed consumer without runtime
validation. \`as Type\`, \`Partial<T>\`, \`@ts-expect-error\`,
defensive defaults, and TypeScript narrowing alone are NOT validation.

MANDATORY protocol when this rule is active:

1. **Check for a \`<untrusted_input_sites>\` block in your initial
   message FIRST.** Lien pre-computes the parse sites this PR
   introduced/modified (the discovery step is done for you), so it is
   your worklist — inspect every site it lists, skip none. If no block
   is present, walk the diff yourself, using the keyword set above as a
   hint (if the diff contains one, there's at least one site to inspect).
2. **For each site, you MUST call \`get_files_context\` (or
   \`read_file\`)** on the function and on each consumer of the parsed
   value. Trace the parsed value to its uses. Look for one of these
   four unguarded shapes:
   - **Cast-without-validate**: \`JSON.parse(raw) as MyType\`,
     \`Partial<T>\` casts, raw \`json.loads(s)\` consumed via attribute
     access, \`json.Unmarshal(b, &v)\` whose \`err\` is dropped.
   - **Schema gaps**: a Zod / Pydantic / struct-tag schema that omits
     a field the consumer reads. The consumer compiles fine because
     of the type narrowing the schema produces, but a real-world
     payload missing the field surfaces as a runtime crash deeper in.
   - **NaN-on-parse**: \`parseInt\` / \`int(s)\` / \`strconv.Atoi\` /
     \`Integer.parseInt\` whose failure return (NaN, exception,
     \`(0, err)\`) is not checked before the value is used numerically.
   - **Blank-keyword / truthy-coerce**: empty-string, zero, or null
     slipping past a truthiness check (\`if (x)\`, \`if x:\`) that
     should have been a typed check (\`x !== undefined\`,
     \`isinstance(x, int)\`).
3. Emit a finding for each unguarded path. The \`message\` must name
   the parse site by line, the consumer by line, and the exact
   malformed input (e.g. \`{"findings": {}}\`,
   \`--votes foo\`, missing \`complexityReport\` field) that survives
   the cast and crashes the consumer.
4. The \`evidence\` must cite the consumer code that reads the
   unvalidated value — quote the access pattern (e.g.
   \`.findings.length\`, \`config.x\` numeric ops). Don't just say
   "the cast is the only validation" without naming a specific
   downstream read.
5. The \`suggestion\` should propose a concrete fix:
   parse-as-unknown-then-validate (\`Array.isArray\`, \`typeof === 'number'\`),
   schema completion (add the missing fields), \`Number.isFinite\` /
   \`Number.isInteger\` guard, or \`x !== ''\` / \`isinstance(x, T)\`
   typed check.

Do not finalize a response for this rule with zero findings unless
you have inspected every site in the \`<untrusted_input_sites>\` block
(or, when no block is present, every parse site you found in the diff),
called \`get_files_context\` on each parse-site function AND its
downstream consumers, AND confirmed none of the four unguarded shapes
matches.`,
  example: `### Good finding — cast-without-validate (CodeRabbit on PR #541):
{
  "filepath": "packages/review/test/harness/assert-cli.ts",
  "line": 38,
  "symbolName": "loadResult",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "untrusted-input-validation",
  "message": "loadResult parses an arbitrary JSON file via JSON.parse and casts the result to Partial<HarnessResult>. A malformed file like {\\"findings\\": {}} (object instead of array) will pass the cast but later fail inside the assertion runner with a misleading 'findings.length is not a function' rather than a clean exit-3 loader error. The downstream code at lines 65–94 reads .findings.length, .toolCalls.some, and .turns numerically — none are guarded.",
  "suggestion": "Parse as unknown, then validate: type-check parsed.findings (Array.isArray), parsed.toolCalls (Array.isArray), and parsed.turns (typeof === 'number') before constructing the HarnessResult. Throw a descriptive error that the caller can surface as exit 3.",
  "evidence": "Inspected loadResult and its callers in main(); the cast is the only validation layer. Consumer at line 67 calls parsed.findings.some(...) which crashes on a non-array."
}

### Good finding — NaN-on-parse:
{
  "filepath": "packages/review/test/harness/run.ts",
  "line": 49,
  "symbolName": "parseFlags",
  "severity": "warning",
  "category": "logic_error",
  "ruleId": "untrusted-input-validation",
  "message": "parseFlags accepts --votes and --calibrate via parseInt(argv[++i], 10) without checking for NaN. \`--votes foo\` produces NaN and silently propagates: vote() then runs Promise.all(new Array(NaN)) which is an empty array, the calibration shows 0/0 passed, and the user gets no error indication that their flag was malformed.",
  "suggestion": "Use a Number.isInteger guard: const n = Number(argv[++i]); if (!Number.isInteger(n) || n <= 0) { console.error('--votes requires a positive integer'); process.exit(2); }. Same for --calibrate.",
  "evidence": "Phase 2 untrusted-input check — parseInt return value flows directly into flags.votes / flags.calibrate, then into vote() and calibrate() at run.ts:218–227 which use the value as an array length."
}`,
  triggers: {
    keywords: [
      // JS / TS
      '\\bJSON\\.parse\\b',
      '\\bprocess\\.env\\b',
      '\\bprocess\\.argv\\b',
      '\\bparseInt\\b',
      // Python
      '\\bjson\\.loads\\b',
      '\\bos\\.environ\\b',
      '\\bos\\.getenv\\b',
      // Go
      '\\bjson\\.Unmarshal\\b',
      '\\bos\\.Getenv\\b',
      '\\bstrconv\\.Atoi\\b',
      // Java
      '\\breadValue\\b',
      '\\bSystem\\.getenv\\b',
      '\\bInteger\\.parseInt\\b',
      // PHP
      '\\bjson_decode\\b',
      '\\bgetenv\\b',
      // Rust
      '\\bserde_json::from',
      '\\benv::var\\b',
      // Ruby
      '\\bENV\\[',
    ],
  },
  severity: 'warning',
  category: 'logic_error',
  enabled: true,
  source: 'builtin',
};

/**
 * The documentation-truthfulness rule. Exported so the dedicated doc-truth
 * second pass (issue #732) can build a single-rule ResolvedRules set without
 * re-deriving it from BUILTIN_RULES.
 */
export const DOC_TRUTH: ReviewRule = {
  id: 'doc-truth',
  name: 'Documentation / Guidance Truthfulness',
  description:
    'Flag doc comments, docstrings, tool descriptions, and agent-guidance prose whose behavioral claims are contradicted by the code the diff touches',
  prompt: `### Documentation / Guidance Truthfulness Check

**This rule is a deliberate exception to the general "do NOT report
documentation" policy.** A doc comment, docstring, tool description, or
agent-guidance file (CLAUDE.md, a plugin hook, a \`.mdc\` rule) that makes a
FALSE behavioral claim is a real bug, not a style nit — especially for a
tool whose product IS agent guidance, where wrong guidance actively
misroutes the agents that read it. Silence is not a safe default here: if
the diff touches prose making a behavioral claim, verify the claim before
staying quiet.

Scope: only prose the diff TOUCHED — comments, docstrings, string/Markdown
descriptions, or shell \`echo\`/comment text on \`+\` (or removed \`-\`)
lines — INCLUDING any \`<guidance_surface_changes>\` block in your initial
message (those files are not code-analyzed, so their prose is reviewed only
here). Ignore prose the diff did not touch, and ignore pure wording/style
preferences.

Concrete claim shapes to check — report ONLY when the code contradicts the
claim (or the diff itself just changed the described behavior and left the
prose describing the OLD behavior):
- **State claim** — "X is disabled/enabled/inactive/inert when Y",
  "reports as disabled without Z". Falsified when the code path shows the
  opposite (e.g. the feature still runs / still reports as active).
- **Mechanism claim** — "X is meaning-based / semantic / embedding-based"
  when the implementation is lexical/keyword/substring (or the reverse).
- **Requirement claim** — "X requires Z", "X never does Z", "always
  returns …". Falsified when the code imposes no such requirement or does
  the forbidden thing.
- **Default claim** — "default: true", "defaults to N". Falsified when the
  schema / constructor / config default in the code is a different value.

MANDATORY protocol when this rule is active:

1. **Check for a \`<doc_claims>\` block in your initial message FIRST.** Lien
   pre-computes it by deterministically scanning the ADDED lines of the
   touched guidance/doc surfaces for claim-shaped prose — the inventory step
   is done for you, so treat every entry as a MANDATORY worklist item, not an
   optional one. The scan can miss claims and can list merely-descriptive
   prose, so also skim the touched \`<diff>\` and \`<guidance_surface_changes>\`
   hunks for any claim-bearing line not listed. If there is no \`<doc_claims>\`
   block AND no claim-bearing line in the touched prose, the rule has nothing
   to do — that is the only clean way to finish with zero findings.
   Also check for a \`<rename_sweep>\` block: when present, it pre-computes a
   MECHANICAL identifier rename swept across many files, with the
   prose-touched lines and any surviving old-name references already located
   — treat each as a claim-verification item the same way, rather than
   needing to notice the rename pattern yourself inside a large, uniform diff.
2. For EACH claim, locate the code it describes using material ALREADY in
   your prompt: the diff hunks, \`<changed_functions>\`, and — for symbols in
   changed code — \`get_files_context\` (it reads the indexed chunks). Do
   NOT depend on \`grep_codebase\` / \`read_file\` alone to confirm a claim:
   in some review modes those tools return no content, so a claim you cannot
   otherwise check is "unverified", not "fine".
3. Emit a finding when the claim is CONTRADICTED by the code you can see, OR
   when the diff changed the described behavior and left the prose describing
   the old behavior (a mechanical rename/refactor that made a neighbouring
   comment stale is the canonical case). The \`message\` must QUOTE the
   stale/false claim and state the actual behavior; the \`evidence\` must
   cite the code fact that falsifies it (file:line, signature, return value,
   or the specific diff hunk) — not "the comment looks wrong".
4. Stay silent on a claim only after locating the code and confirming it
   still matches. A claim you genuinely could not locate is reported as a
   \`warning\` "unverifiable behavioral claim in touched prose" — do not
   silently pass it.`,
  example: `### Good finding — mechanical rename left a doc comment describing removed behavior:
{
  "filepath": "packages/core/src/config/schema.ts",
  "line": 42,
  "symbolName": "embeddingsConfig",
  "severity": "warning",
  "category": "bug",
  "ruleId": "doc-truth",
  "message": "The touched doc comment claims code search \\"reports as disabled\\" when embeddings are absent, but the code no longer disables it: without embeddings, search falls back to lexical BM25 and still reports as active. The comment describes pre-refactor behavior the code path no longer has.",
  "suggestion": "Reword to: without embeddings, search falls back to lexical BM25 (it does not report as disabled).",
  "evidence": "Doc-truth check — comment at line 42 says 'reports as disabled'; the resolver in the same file returns 'lexical', never 'disabled', so the claim is falsified by the code."
}

### Good finding — guidance-surface hook mislabels a lexical tool as semantic:
{
  "filepath": "plugins/claude/hooks/augment-explore-task.sh",
  "line": 12,
  "severity": "warning",
  "category": "bug",
  "ruleId": "doc-truth",
  "message": "The hook's guidance text calls search_code \\"meaning-based discovery\\", but the tool now performs lexical keyword (BM25) search. Agents reading this hook will expect semantic ranking and mis-use the tool.",
  "suggestion": "Reword to 'keyword-based code search (BM25)' to match the tool's actual behavior.",
  "evidence": "Doc-truth check — the <guidance_surface_changes> hunk describes 'meaning-based'; the tool is lexical per this PR's rename and the search implementation."
}`,
  triggers: {
    // Guidance surfaces (matched against allChangedFiles, so the invisible
    // .sh/.mdc/CLAUDE.md cases still activate the rule), plus the project
    // documentation surfaces the <guidance_surface_changes> section passes
    // through: architecture/design docs and ADRs, the user-guide site, and
    // changeset entries whose public-API claims must match the diff. Kept in
    // lockstep with GUIDANCE_SURFACE_MATCHERS in guidance-surface-signals.ts.
    filePatterns: [
      '**/CLAUDE.md',
      'plugins/**',
      '.cursor/**',
      '**/*.mdc',
      'docs/**',
      'packages/site/docs/**',
      '.changeset/**',
    ],
    // ...OR claim-shaped prose anywhere in the diff (doc comments/docstrings in
    // otherwise-analyzable code, e.g. the schema.ts miss on PR #658).
    keywords: [
      'reports?\\s+as\\s+(disabled|enabled|inactive|unavailable)',
      '(disabled|enabled|inactive|inert|no-?op|ignored)\\s+(when|unless|if|without)',
      'meaning-based',
      'semantic(ally)?\\s+(search|match|matching|similar|discovery)',
      'default:\\s*(true|false|\\d)',
      '(always|never)\\s+(returns?|throws?|requires?|uses?|does|disables?|enables?)',
    ],
  },
  severity: 'warning',
  category: 'bug',
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
  STALE_DUPLICATE,
  UNTRUSTED_INPUT_VALIDATION,
  DOC_TRUTH,
];
