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
 *  3. the first balanced JSON object in the text (brace-depth scan — recovers
 *     a complete, valid verdict followed by trailing prose, e.g. "Wait, I need
 *     to double-check…" appended after the closing brace, #792's
 *     incomplete-handling canary);
 *  4. a naive first-open-to-last-close slice of the whole text (model ignored
 *     json_object and wrapped the verdict in prose with no other braces).
 *
 * Prefer a candidate carrying a `summary` (the verdict marker) so an
 * `{"findings": [...]}`-only example can't beat the real verdict; fall back to
 * the first findings-only candidate if nothing carries a summary.
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
    {
      value: firstBalancedJsonObject(text),
      recovered: 'balanced-object extraction (trailing content after the closing brace)',
    },
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

/**
 * Scan from the first `{` and track brace depth — respecting string literals
 * and escapes — to find the first *complete, balanced* JSON object, stopping
 * as soon as depth returns to zero and ignoring everything after.
 *
 * Recovers a verdict that is otherwise valid but has trailing content
 * appended after its closing brace — observed on the incomplete-handling
 * canary post-#787 (#792 3-vote screen): the model emits a complete, correct
 * verdict, then appends "Wait, I need to double-check…" prose (which itself
 * contains further `{`/`}` characters). `embeddedJsonObject`'s naive
 * first-open/last-close slice overshoots into that trailing content and
 * produces unparseable JSON; this stops at the first balanced close instead.
 * Returns undefined if the text has no `{` or never balances (e.g. a
 * genuinely truncated response) — never guesses at an unbalanced slice.
 */
/** Matches a double-quoted JSON string literal, escapes included. */
const JSON_STRING_LITERAL = /"(?:\\.|[^"\\])*"/g;

export function firstBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  // Mask string contents with same-length `"` filler so quotes/escapes never
  // have to be tracked char-by-char in the scan below — braces inside a
  // string literal (e.g. prose like "{user, token}") can't skew the depth
  // count, and offsets into `masked` line up 1:1 with `text.slice(start)`.
  const masked = text.slice(start).replace(JSON_STRING_LITERAL, m => '"'.repeat(m.length));

  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) return text.slice(start, start + i + 1);
  }
  return undefined; // never balanced — no complete object found
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
