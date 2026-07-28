/**
 * Shared helpers for the review agent's provider clients.
 *
 * The Anthropic (`anthropic-client.ts`) and OpenAI-compatible
 * (`openai-client.ts`) clients run structurally identical loops over two
 * different wire formats. This module holds the byte-identical, provider-
 * agnostic pieces both depend on — output caps, the boolean-ish env-disable
 * parser, per-turn trace logging, and the verdict-extraction pipeline
 * (fence-priority JSON recovery + finding/summary validation). Extracting them
 * here means a fix lands once, not twice.
 *
 * Everything that touches a provider's API shape (message formatting,
 * tool-call encoding, the turn loop itself) deliberately stays in the
 * per-client files — those are NOT interchangeable and must not be unified
 * without a behavior-preserving driver + adapter (see the PR body for the
 * turn-loop follow-up plan).
 */

import type { Logger } from '../../logger.js';
import type { AgentFinding, AgentSummary, TurnTrace } from './types.js';

/** Cap a single tool's recorded output so traces stay readable. */
export const TRACE_TOOL_OUTPUT_MAX = 4096;

/** Cap per-turn reasoning/output printed to CI logs. */
export const AGENT_LOG_MAX = 4000;

/**
 * Cap a single tool result fed back to the model. A large file read or
 * batched get_files_context can otherwise return tens of thousands of tokens
 * in one turn, blowing the whole budget before the wrap-up nudge can fire.
 * ~16K chars ≈ 4K tokens — enough context for a review, bounded per call.
 */
export const TOOL_RESULT_MAX_CHARS = 16_000;

/**
 * Soft nudge appended once the run nears its budget (or on the last turn):
 * stop investigating and emit the findings JSON now. Identical wording on both
 * clients so the model sees the same instruction regardless of provider.
 */
export const WRAP_UP_NUDGE =
  'You are running low on budget. Stop investigating and output your findings JSON now. Do not make any more tool calls. If you found no issues, output an empty findings array.';

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

// ---------------------------------------------------------------------------
// Wrap-up decision (issue #839 — multi-turn budget accumulation)
// ---------------------------------------------------------------------------

/**
 * Fraction of the whole budget at which an ordinary investigative turn is
 * nudged to wrap up (drop tools, emit a verdict next turn) — kept below the
 * hard cap with headroom so a single capped tool result can't skip past the
 * wrap-up window straight into the hard stop. Pre-#839 behavior; unchanged by
 * this fix (see `computeWrapUpReason`'s doc comment for what #839 adds).
 */
export const NEAR_BUDGET_FRACTION = 0.6;

/** Inputs to `computeWrapUpReason` — the turn-loop locals both clients already track, passed by
 *  name so the function itself stays provider-agnostic and testable without either client's
 *  HTTP/SDK transport. */
export interface WrapUpCheckInput {
  /** Cumulative spend (input+output across every turn so far, including the turn just completed). */
  totalTokens: number;
  /** THIS turn's own input/prompt token cost (`usage.prompt_tokens` / `usage.input_tokens`). */
  turnInputTokens: number;
  maxTokenBudget: number;
  /** 1-indexed number of the turn just completed. */
  turn: number;
  maxTurns: number;
}

/**
 * Why (if at all) the NEXT turn should be forced to drop tools and emit its
 * verdict now, instead of continuing to investigate. `near-budget`/
 * `last-turn` are the pre-existing coarse checks (issue #836); `input-growth`
 * is issue #839's own addition — see `computeWrapUpReason`.
 */
export type WrapUpReason = 'input-growth' | 'near-budget' | 'last-turn' | null;

/**
 * Decide whether an ordinary investigative turn should hand off to a forced,
 * no-tools verdict turn next — and, when so, WHY (surfaced so a client can log
 * the more surprising `input-growth` case for diagnosability).
 *
 * ISSUE #839: conversation history — system prompt + every prior turn's own
 * response + every tool result — is re-sent in full on every request and is
 * NEVER bounded by `max_tokens` (only a turn's OUTPUT is; see
 * `turnMaxTokens`/`requestMaxTokens`). The pre-existing `near-budget` check
 * only fires once CUMULATIVE spend crosses `NEAR_BUDGET_FRACTION` of the
 * WHOLE budget — by which point the single forced-finish turn that follows
 * can still re-send an arbitrarily large accumulated history as its own
 * (budget-blind) input. That is exactly the mechanism behind the real
 * doc-truth receipt this closes: 20,869 allocated / 56,430 spent (2.7x, PR
 * #837's dogfood run) — two ordinary tool-calling turns stayed comfortably
 * under 60%, then the forced-finish turn's OWN input cost (the now much
 * larger history) alone blew the budget (see the `plugins-agent-budget.test.ts`
 * / `plugins-agent-anthropic.test.ts` regression tests reproducing this exact
 * shape).
 *
 * `input-growth` catches this earlier and is data-driven, not a retuned
 * constant: conversation history only grows turn over turn (nothing is ever
 * trimmed in this codebase — see `TOOL_RESULT_MAX_CHARS`'s per-call cap, but
 * no whole-history trim), so THIS turn's own input cost is a conservative
 * FLOOR on what the next turn's input will cost. If what's left of the budget
 * can't even cover a repeat of this turn's own input, one more investigative
 * round-trip cannot possibly complete inside it — force the wrap-up now,
 * while the conversation is as small as it will ever again be, rather than
 * let it grow through one or more further turns before the coarser
 * `near-budget` fraction catches up. This bounds — but, because the
 * forced-finish turn's own input is still real and still unbounded by
 * `max_tokens`, cannot fully eliminate — the residual overshoot; see
 * `turnMaxTokens`'s doc comment for the complementary output-side bound and
 * `EXTRA_PASS_MIN_BUDGET_TOKENS`'s for the allocation-sizing complement.
 * Verified NOT to change behavior on any pre-#839 budget test: every existing
 * fixture crosses `near-budget` or `input-growth` at the same turn boundary
 * (see the two clients' own test suites) — this is a strict, additive
 * improvement, not a retuning of the existing thresholds.
 *
 * Checked before `near-budget`/`last-turn` so a fast, single-turn spike (a
 * large pre-rendered worklist on turn 1, or one oversized tool result) is
 * named precisely rather than folded into the generic near-budget bucket.
 */
export function computeWrapUpReason(input: WrapUpCheckInput): WrapUpReason {
  const { totalTokens, turnInputTokens, maxTokenBudget, turn, maxTurns } = input;
  const remaining = maxTokenBudget - totalTokens;
  if (turnInputTokens >= remaining) return 'input-growth';
  if (totalTokens >= maxTokenBudget * NEAR_BUDGET_FRACTION) return 'near-budget';
  if (turn >= maxTurns - 1) return 'last-turn';
  return null;
}

/**
 * Log `computeWrapUpReason`'s new `input-growth` case for CI diagnosability —
 * a no-op for `near-budget`/`last-turn`/`null` (the pre-#839 cases stay
 * exactly as silent as before this fix). Called unconditionally by both
 * clients right after computing the reason, so neither of their already-
 * over-complexity-budget `run()` methods gains an inline branch just to
 * decide whether to log (see `computeWrapUpReason`'s own call sites).
 */
export function logWrapUpReason(
  logger: Logger,
  reason: WrapUpReason,
  turn: number,
  turnInputTokens: number,
  remainingBudget: number,
): void {
  if (reason !== 'input-growth') return;
  logger.info(
    `[agent] Turn ${turn}: this turn's own input (${turnInputTokens}) already meets/exceeds ` +
      `the ${remainingBudget} tokens left of budget — forcing wrap-up now rather than risking ` +
      'a further turn (issue #839 input-growth check)',
  );
}

/**
 * Parse a boolean-ish env *disable* flag. Per-turn agent logging is ON by
 * default (so every review is diagnosable); only an explicit '0'/'false'
 * (case-insensitive) disables it. Parsed precisely so an unrelated value
 * doesn't accidentally silence the trace.
 */
export function envDisabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '0' || v === 'false';
}

/**
 * Print a turn's reasoning + output to the logger so CI logs show what the
 * agent was actually thinking. Truncated so a verbose reasoning model (Kimi)
 * doesn't flood the log.
 */
export function logTurn(logger: Logger, turn: TurnTrace | undefined, label?: string): void {
  if (!turn) return;
  const tag = label ? ` (${label})` : '';
  // Guard on trimmed content: on tool-call turns the model emits tool calls
  // (logged separately) and often a whitespace-only `content`, which would
  // otherwise print a blank, confusing "output:" line.
  if (turn.reasoning?.trim()) {
    logger.info(
      `[agent] Turn ${turn.turnNumber} reasoning${tag}:\n${truncate(turn.reasoning.trim(), AGENT_LOG_MAX)}`,
    );
  }
  if (turn.responseText?.trim()) {
    logger.info(
      `[agent] Turn ${turn.turnNumber} output${tag}:\n${truncate(turn.responseText.trim(), AGENT_LOG_MAX)}`,
    );
  }
}

/**
 * Extract findings + summary from the model's final response *text*.
 *
 * Each provider client renders its response to a plain string first (the
 * Anthropic client joins its text blocks, the OpenAI client passes
 * `message.content`) and then hands it here, so the recovery logic is a single
 * shared implementation. Candidate JSON strings are tried in priority order:
 *  1. each ```json fence, LAST first — the model emits its verdict last, so a
 *     few-shot/example fence earlier in the prose must not win;
 *  2. the raw body (a response_format:json_object / forced-verdict turn);
 *  3. every top-level balanced JSON object in the text, in the order they
 *     appear (brace-depth scan — recovers a complete, valid verdict followed
 *     by trailing prose, e.g. "Wait, I need to double-check…" appended after
 *     the closing brace, #792's incomplete-handling canary; also recovers a
 *     verdict that isn't the first such object, e.g. an incidental
 *     JSON-shaped fragment quoted earlier while investigating a JSON-dense
 *     diff, #829);
 *  4. a naive first-open-to-last-close slice of the whole text (model ignored
 *     json_object and wrapped the verdict in prose with no other braces).
 *
 * Prefer a candidate carrying a `summary` (the verdict marker) so an
 * `{"findings": [...]}`-only example can't beat the real verdict; fall back to
 * the first findings-only candidate if nothing carries a summary. This holds
 * both ACROSS strategies (a fence beats a balanced object) and WITHIN the
 * balanced-object strategy (the first object carrying `summary` wins over a
 * later one) — see `allBalancedJsonObjects`'s doc comment for why that keeps
 * #792's "trust the original verdict, not a later self-revision" behavior
 * unchanged while still recovering a verdict an earlier non-verdict object
 * previously hid.
 */
export function extractFindingsFromText(
  text: string,
  logger?: Logger,
): {
  findings: AgentFinding[];
  summary?: AgentSummary;
} {
  const fences = [...text.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)].map(m => m[1]).reverse();
  // Each candidate carries an optional `recovered` label so a candidate that
  // needed active recovery (vs. a plain fence/raw-body parse) logs a warning
  // naming it — mirroring #775's corrupted-key recovery logging.
  const candidates: Array<{ value: string | undefined; recovered?: string }> = [
    ...fences.map(value => ({ value })),
    { value: text.trim() },
    ...allBalancedJsonObjects(text).map(value => ({
      value,
      recovered: 'balanced-object extraction (trailing content after the closing brace)',
    })),
    { value: embeddedJsonObject(text) },
  ];

  let fallback: { findings: AgentFinding[] } | undefined;
  for (const { value: candidate, recovered } of candidates) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue; // not parseable — try the next candidate
    }
    const { findings, summary } = readVerdict(parsed, logger);
    if (summary) {
      logRecovery(logger, recovered, 'a verdict');
      return { findings, summary };
    }
    if (findings.length > 0 && !fallback) {
      logRecovery(logger, recovered, 'findings');
      fallback = { findings };
    }
  }
  return fallback ?? { findings: [] };
}

/** Logs a named-candidate recovery — mirroring #775's corrupted-key style. No-op when `recovered` is unset. */
function logRecovery(
  logger: Logger | undefined,
  recovered: string | undefined,
  what: 'a verdict' | 'findings',
): void {
  if (recovered) logger?.warning(`[agent] Recovered ${what} via ${recovered}`);
}

/**
 * Extract a verdict from a turn's content, falling back to its reasoning
 * channel when content yields nothing. Kimi (via OpenRouter) sometimes emits
 * the entire verdict JSON into `message.reasoning` with empty content —
 * observed twice on PR #668 (run 28705034445, attempts 1 and 2): the full
 * verdict was visible in the turn log under "Turn 5 reasoning:" while
 * content-only extraction found nothing, so the review bailed as incomplete
 * and discarded real findings, surviving even the summary-retry (which hit
 * the same channel mismatch).
 *
 * Content always wins when it carries a summary or findings; reasoning is
 * consulted only when content produced neither. Both channels go through the
 * same fence-priority pipeline, so the summary-preference guard against
 * few-shot example JSON applies to reasoning too.
 */
export function extractFindingsWithReasoningFallback(
  content: string | null | undefined,
  reasoning: string | null | undefined,
  logger?: Logger,
): { findings: AgentFinding[]; summary?: AgentSummary } {
  const fromContent = content
    ? extractFindingsFromText(content, logger)
    : { findings: [] as AgentFinding[], summary: undefined };
  if (fromContent.summary || fromContent.findings.length > 0) return fromContent;

  const fromReasoning = reasoning
    ? extractFindingsFromText(reasoning, logger)
    : { findings: [] as AgentFinding[], summary: undefined };
  if (fromReasoning.summary || fromReasoning.findings.length > 0) {
    logger?.info('[agent] Verdict recovered from the reasoning channel (content had none)');
    return fromReasoning;
  }

  return { findings: [] };
}

/** Pull validated findings + summary out of one parsed JSON verdict (array or object). */
export function readVerdict(
  parsed: unknown,
  logger?: Logger,
): { findings: AgentFinding[]; summary?: AgentSummary } {
  const obj = (parsed ?? {}) as { findings?: unknown; summary?: unknown };
  let rawFindings = Array.isArray(parsed) ? parsed : obj.findings;
  if (!Array.isArray(rawFindings) && typeof parsed === 'object' && parsed !== null) {
    rawFindings = findingsUnderCorruptedKey(parsed as Record<string, unknown>);
  }
  const findings = (Array.isArray(rawFindings) ? rawFindings : []).filter(isValidFinding);
  let summary = isValidSummary(obj.summary) ? obj.summary : undefined;
  if (!summary && typeof parsed === 'object' && parsed !== null) {
    summary = summaryUnderCorruptedKey(parsed as Record<string, unknown>, logger);
  }
  return { findings, summary };
}

/**
 * Recover a findings array whose key got mangled. Kimi has been observed
 * emitting an otherwise-valid verdict as `{":  ": [...], "summary": {...}}` —
 * the findings intact but the key corrupted — which previously read as a
 * clean zero-finding review: the valid summary satisfied the summary-retry
 * and incomplete checks, so real findings were silently discarded. When no
 * `findings` array is present, accept another property only if it holds a
 * non-empty array in which EVERY element is a valid finding; anything less
 * stays unrecovered rather than guessed at.
 */
function findingsUnderCorruptedKey(obj: Record<string, unknown>): AgentFinding[] | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'findings' || key === 'summary') continue;
    if (Array.isArray(value) && value.length > 0 && value.every(isValidFinding)) {
      return value as AgentFinding[];
    }
  }
  return undefined;
}

/**
 * Recover a summary object whose key got mangled — the mirror image of
 * `findingsUnderCorruptedKey` above. Observed on the PR #772 Lien Review run
 * (2026-07-15, prod Kimi model): a leaked chat-template fragment landed as a
 * key —
 *   {"findings":[],":<parameter name=":{"riskLevel":"low","overview":"...","keyChanges":[...]}}
 * — findings were a VALID empty array (a genuine clean review), but the
 * summary lived under the corrupted key. `obj.summary` read as missing, so
 * the run was reported as incomplete ("did not finish, re-run") even though
 * it had actually completed clean.
 *
 * When no `summary` value validates, accept another property only if its
 * value is itself summary-shaped (`isValidSummary` — object carrying
 * riskLevel/overview/keyChanges). If more than one other key qualifies,
 * recover NONE: ambiguity between candidates must never be guessed at, so
 * the run stays "incomplete" rather than risk attaching the wrong summary.
 */
function summaryUnderCorruptedKey(
  obj: Record<string, unknown>,
  logger?: Logger,
): AgentSummary | undefined {
  const candidates = Object.entries(obj).filter(
    ([key, value]) => key !== 'findings' && key !== 'summary' && isValidSummary(value),
  );
  if (candidates.length !== 1) return undefined;
  const [key, value] = candidates[0];
  logger?.warning(`[agent] Recovered summary from corrupted key ${JSON.stringify(key)}`);
  return value as AgentSummary;
}

/** First `{`…last `}` slice — recovers a JSON object wrapped in prose. */
export function embeddedJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start !== -1 && end > start ? content.slice(start, end + 1) : undefined;
}

/** Matches a double-quoted JSON string literal, escapes included. */
const JSON_STRING_LITERAL = /"(?:\\.|[^"\\])*"/g;

/**
 * Safety valve on `allBalancedJsonObjects`'s scan: a hard ceiling on how many
 * top-level objects it will ever return, bounding worst-case work/return size
 * on a pathological "{}{}{}…" essay (this function processes untrusted LLM
 * output). Raised from the original 25 — issue #829's residual gap: a
 * genuine verdict positioned 26th+ in JSON-dense prose was invisible to the
 * scan (the regression test below pins the 26th-position shape).
 *
 * CORRECTNESS OVER THROUGHPUT (adversarial review of the first cut of this
 * fix — HISTORICAL paragraph below: the design it describes was reverted
 * and is NOT what the code in this file does today; see
 * `nextBalancedObjectRange`'s own doc comment for the current, correct
 * behavior): an earlier, since-reverted version of this change hoisted
 * `maskStringLiterals` so every candidate object's scan shared ONE
 * pre-computed masked copy of the whole text — genuinely O(text length)
 * instead of the per-object O(objects × text length) this comment used to
 * justify a stingy 25. That hoist was NOT behavior-preserving: sharing that
 * whole-text mask across every candidate lets an odd number of
 * stray/unescaped double-quote characters ANYWHERE earlier
 * in the text shift the regex's global quote-pairing, potentially masking
 * over the real verdict's own opening brace and losing it entirely — proven
 * by the reviewer on both a synthetic stray-quote-in-prose case and the
 * #829 26th-object decoy shape with one added stray quote (a 1-of-3
 * stray-quote parity sweep: odd counts lost the verdict, even counts didn't).
 * A truncated `finishReason:'length'` turn — the exact shape this whole fix
 * targets — naturally ends mid-string-literal, i.e. with an odd, unterminated
 * quote: this is the TARGET failure class, not an edge case. So
 * `nextBalancedObjectRange` (below) re-masks fresh from each candidate's own
 * `{`, per the ORIGINAL design — correctness beats the throughput win on
 * this path. See `nextBalancedObjectRange`'s own doc comment for the
 * mechanics and the `stray quote` regression tests
 * (`plugins-agent-client-shared.test.ts`) pinning both failure cases plus a
 * 0-4 stray-quote parity sweep that must all recover.
 *
 * Re-measured with per-object re-masking restored, at the 200 cap:
 *  - 200 tiny objects spread through ~500K chars of realistic filler: ~26ms.
 *  - the TRUE worst case for this algorithm — 200 tiny objects clustered up
 *    front, followed by a huge brace-free tail (every one of the 200 calls
 *    re-masks nearly that whole tail) — at a ~900K-char tail (roughly the
 *    size of the largest real derailed-turn text observed on this issue):
 *    ~70ms. Even doubled to ~2.3M chars: ~160ms.
 * A single turn's own output text is bounded well under these sizes by the
 * per-request `max_tokens` ceiling both clients already enforce (at most
 * `RETRY_MAX_MAX_TOKENS`/`MAX_TOKENS` tokens per completion — see
 * `openai-client.ts`/`anthropic-client.ts`), so even the TRUE worst-case
 * shape stays in double-digit milliseconds for any text this function will
 * realistically ever see. The O(objects × text length) revisit is real, but
 * at this cap it stays trivial in absolute terms, so 200 stays the cap (not
 * reverted to 25). See `plugins-agent-client-shared.test.ts`'s perf tests for
 * the exact benchmarked shapes.
 */
export const MAX_BALANCED_OBJECTS_SCANNED = 200;

/**
 * Mask every double-quoted string literal in `text` with same-length `"`
 * filler so brace-depth scanning never has to track quotes/escapes
 * char-by-char — braces inside a string literal (e.g. prose like "{user,
 * token}") can't skew the depth count, and offsets into the result line up
 * 1:1 with `text`. Called on each candidate's own remaining SUFFIX (see
 * `nextBalancedObjectRange`) — every candidate gets its OWN fresh mask; the
 * whole text is never masked as a single shared unit — see
 * `MAX_BALANCED_OBJECTS_SCANNED`'s doc comment for why that would be unsafe
 * (stray-quote parity can shift and hide a real verdict).
 */
function maskStringLiterals(text: string): string {
  return text.replace(JSON_STRING_LITERAL, m => '"'.repeat(m.length));
}

/**
 * Find the single balanced JSON object starting at `text`'s first `{` at or
 * after `searchFrom`, tracking brace depth (respecting string literals and
 * escapes) until it returns to zero. Returns its `[start, end]` (inclusive)
 * indices, or `undefined` if there's no more `{` or it never balances (e.g. a
 * genuinely truncated response) — never guesses at an unbalanced slice.
 *
 * Re-masks `text.slice(start)` FRESH on every call, rather than sharing one
 * whole-text masked copy across every candidate — deliberately, not an
 * oversight (an earlier, since-reverted cut of this fix shared one mask
 * across the whole text; see `MAX_BALANCED_OBJECTS_SCANNED`'s doc comment
 * for that history and the adversarial-review proof of why it was wrong).
 * Sharing a mask across the whole text lets an odd number of stray,
 * unescaped double-quote characters anywhere BEFORE `start` shift the global
 * quote-pairing the regex produces, which can mask straight over THIS
 * candidate's own opening `{` (if it lands between two quotes the regex
 * wrongly paired as a string literal) and make a real verdict invisible.
 * Re-anchoring the mask at each candidate's own `{` makes recovering THAT
 * object immune to whatever quote parity came before it, at the cost of
 * re-scanning the remaining suffix per candidate (bounded by
 * `MAX_BALANCED_OBJECTS_SCANNED`). Pulled out of `allBalancedJsonObjects` so
 * that function's own loop stays under the complexity budget.
 */
function nextBalancedObjectRange(
  text: string,
  searchFrom: number,
): { start: number; end: number } | undefined {
  const start = text.indexOf('{', searchFrom);
  if (start === -1) return undefined;

  const masked = maskStringLiterals(text.slice(start));
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return { start, end: start + i };
  }
  return undefined; // never balanced — no complete object found
}

/**
 * Scan the whole text for every top-level *complete, balanced* JSON object,
 * in the order they appear, resuming right after each one's closing brace to
 * look for the next. Stops (without emitting a partial entry) the moment a
 * `{` never balances, since a genuinely truncated response can't be guessed
 * at.
 *
 * Recovers, in one pass:
 *  - a verdict that is otherwise valid but has trailing content appended
 *    after its closing brace — observed on the incomplete-handling canary
 *    post-#787 (#792's 3-vote screen): the model emits a complete, correct
 *    verdict, then appends "Wait, I need to double-check…" prose (which
 *    itself contains further `{`/`}` characters). `embeddedJsonObject`'s
 *    naive first-open/last-close slice overshoots into that trailing
 *    content and produces unparseable JSON; stopping at each balanced close
 *    instead means the first object is recovered cleanly and any later ones
 *    are visible as separate candidates rather than corrupting the slice.
 *  - a verdict that isn't the FIRST top-level object in the text — e.g. an
 *    incidental JSON-shaped fragment the model quoted while investigating a
 *    JSON-dense diff (issue #829) sits before the real, later verdict.
 *    `extractFindingsFromText` tries every object this returns and still
 *    prefers the first one carrying `summary`, so a genuine verdict
 *    followed by the model second-guessing itself into a "revised" verdict
 *    (also #792) is unaffected — only a real verdict that was previously
 *    invisible because an earlier, non-verdict object ate the single-object
 *    scan's only attempt is newly recovered.
 */
export function allBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let searchFrom = 0;
  while (objects.length < MAX_BALANCED_OBJECTS_SCANNED) {
    const range = nextBalancedObjectRange(text, searchFrom);
    if (!range) break;
    objects.push(text.slice(range.start, range.end + 1));
    searchFrom = range.end + 1;
  }
  return objects;
}

/**
 * The first top-level balanced JSON object in the text — see
 * `allBalancedJsonObjects` for the full scan this delegates to and why a
 * caller may prefer the complete list instead.
 */
export function firstBalancedJsonObject(text: string): string | undefined {
  return allBalancedJsonObjects(text)[0];
}

// ---------------------------------------------------------------------------
// Summary-retry slim context (issue #829 — truncation-under-token-cap remainder)
// ---------------------------------------------------------------------------

/**
 * Bound on how much of the last investigative turn's own text feeds the
 * summary-retry's slim prompt (`buildSlimRetryPrompt`, below). That text can
 * itself be enormous — both of #829's real incidents had their derailed turn
 * emit ~227K-262K tokens of "Issue 1: … Issue 21: …" self-review prose — so
 * even a "slim" retry built only from it still needs its own bound to stay
 * meaningfully smaller than replaying the whole tool-calling history. ~20K
 * chars ≈ 5K tokens: enough room for several concrete findings, small next
 * to a multi-turn investigation's accumulated tool-call/tool-result history.
 */
export const SLIM_RETRY_CONTEXT_MAX_CHARS = 20_000;

/**
 * Pick the text carrying the model's actual investigative decisions for the
 * summary-retry. Walks the turn history NEWEST FIRST, taking each turn's own
 * response content — falling back to its reasoning channel when content is
 * empty, mirroring `extractFindingsWithReasoningFallback`'s channel
 * preference (applied here to what the retry SENDS instead of what it reads
 * back) — and concatenating non-empty turns until
 * `SLIM_RETRY_CONTEXT_MAX_CHARS` is reached or history is exhausted.
 *
 * FLOOR AGAINST FALSE-CLEAN (adversarial-review finding on the first cut of
 * this fix): the very LAST loop turn alone can be a pure tool_calls turn
 * with EMPTY content and no reasoning — e.g. the loop hit `max_turns`/budget
 * right after a turn whose only output was tool calls, with no closing
 * prose. Reading only that one turn returned `''`, so the retry became a
 * BARE instruction ("output the verdict now") with zero real context to
 * summarize. A model asked that with nothing to go on can fabricate a
 * plausible-looking, entirely synthetic clean/empty verdict instead of
 * honestly failing — a FALSE-CLEAN result, the worst failure class this
 * codebase tracks (see `readVerdict`'s corrupted-key recovery for the same
 * "never guess, but never go silent either" tension). Walking backward for
 * the most recent turn that actually said something closes that gap without
 * unbounding the retry's input: `SLIM_RETRY_CONTEXT_MAX_CHARS` still caps the
 * concatenation as a whole, not per turn.
 */
export function lastTurnFindingsText(
  turns: ReadonlyArray<{ responseText?: string; reasoning?: string }>,
): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0 && total < SLIM_RETRY_CONTEXT_MAX_CHARS; i--) {
    const text = turns[i].responseText?.trim() || turns[i].reasoning?.trim() || '';
    if (!text) continue;
    parts.push(text);
    total += text.length;
  }
  return parts.join('\n\n---\n\n');
}

/** Labels the replayed findings text so the model knows what it's looking at. */
const SLIM_RETRY_CONTEXT_PREFIX =
  'Your own analysis from the investigation so far (the rest of the conversation is omitted to keep this request small):';

/**
 * Build the summary-retry's SLIM prompt text: the recent investigative
 * turns' own analysis (see `lastTurnFindingsText`, bounded overall — below —
 * to `SLIM_RETRY_CONTEXT_MAX_CHARS`) plus the hard instruction to emit the
 * verdict now. Falls back to the bare instruction when there's no findings
 * text to replay at all (e.g. every turn in history was genuinely empty).
 *
 * ISSUE #829 (truncation remainder, post-#895's `require_parameters` fix):
 * the pre-fix retry appended its instruction directly onto the FULL
 * accumulated conversation — system prompt, initial message, and every prior
 * turn's own tool calls/tool results — and resent that whole history as the
 * retry's own input. On a JSON-dense diff that history is itself large
 * enough that even a genuinely `require_parameters:true`-routed, forced-
 * JSON-compliant provider still truncated the retry's OUTPUT before it
 * contained a complete verdict object (`finishReason:'length'`, both real
 * incidents named on the issue). A verdict retry doesn't need the tool-
 * calling history at all — everything the model needs to decide the verdict
 * already lives in its own recent turns' text (that prose IS the findings,
 * just not yet JSON) — so both clients now build a FRESH, minimal message
 * list for the retry instead of appending to the accumulated one (see
 * `openai-client.ts` / `anthropic-client.ts`'s `runSummaryRetry`), dropping
 * every earlier tool call/tool result regardless of how large the
 * investigation's own history grew.
 *
 * KNOWN LIMITATION — HEAD-KEEPING TRUNCATION CAN MAKE A RECOVERED VERDICT
 * PARTIAL (documented per adversarial-review finding, not silently accepted):
 * `truncate` keeps the HEAD of `findingsText` and drops the tail. On the
 * exact "Issue 1: … Issue 21: …" enumerated-findings shape this whole fix
 * targets, that means only the FIRST couple of issues (roughly the first
 * ~20K chars' worth, often just 1-2 of 21 on a real derailed turn) survive
 * into the retry — the rest of the enumeration and any trailing "in
 * conclusion…" synthesis are silently dropped. This is a genuine, real
 * limitation: the slim retry can recover A verdict instead of none, not
 * necessarily the FULL set of findings the model had actually found. HEAD is
 * kept deliberately rather than the TAIL: the early items in an enumerated
 * list are where the CONCRETE, schema-fillable specifics live (a claimed
 * file/line/behavior an `AgentFinding` needs `filepath`/`line`/`message`
 * for), while a trailing wrap-up tends to be generic synthesis prose with
 * little of that concrete substance — keeping the head trades completeness
 * for a higher chance the retry can still build at least one valid,
 * concrete finding rather than none at all.
 */
export function buildSlimRetryPrompt(findingsText: string, instruction: string): string {
  const truncated = truncate(findingsText.trim(), SLIM_RETRY_CONTEXT_MAX_CHARS);
  return truncated ? `${SLIM_RETRY_CONTEXT_PREFIX}\n\n${truncated}\n\n${instruction}` : instruction;
}

/** Type guard to validate a summary object. */
export function isValidSummary(value: unknown): value is AgentSummary {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.riskLevel === 'string' &&
    typeof obj.overview === 'string' &&
    Array.isArray(obj.keyChanges)
  );
}

/** Type guard to validate an agent finding has required fields. */
export function isValidFinding(value: unknown): value is AgentFinding {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.filepath === 'string' &&
    typeof obj.line === 'number' &&
    (obj.severity === 'error' || obj.severity === 'warning') &&
    typeof obj.category === 'string' &&
    typeof obj.message === 'string'
  );
}
