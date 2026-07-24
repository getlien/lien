/**
 * Deterministic, zero-LLM gate against one specific hallucination shape:
 * an inline finding whose `message`/`evidence` quotes a code fragment that
 * demonstrably no longer exists in the current file (issue #846).
 *
 * ## The failure mode this closes
 *
 * A finding posted on commit A can be genuinely fixed by commit B. Nothing
 * in the delivery pipeline previously checked a regenerated finding's own
 * premise against the code it's about to be posted against — the marker
 * key (`path::line::category`, see `engine.ts`'s `isDuplicateOfExistingComment`)
 * only recognizes an EXISTING GitHub comment as a duplicate; it was never a
 * mechanism for validating a brand-new finding's content. On PR #845, a
 * fixed finding was followed by a fresh finding at a nearby line asserting
 * a false premise about the now-different code, wasting a full triage
 * round (see the issue for the concrete example).
 *
 * ## The asymmetry — read before touching this file
 *
 * This is a noise reducer, not a suppression system. A finding is gated
 * ONLY when it quotes something specific AND that something is verifiably
 * ABSENT from the current file. Every other case — no quoted citation at
 * all, a citation that still matches, or the current file being
 * unavailable to check — passes the finding through untouched. When in
 * doubt, DELIVER.
 *
 * A false negative here (a stale finding that slips through because it
 * didn't happen to quote anything checkable) just means issue #846's
 * shape recurs occasionally, same as before this gate existed. A false
 * positive (a TRUE finding silently dropped) would be strictly worse: it
 * erodes trust in the tool with no error surfaced anywhere, and nothing
 * downstream would ever know a real bug went unreported. Keep every change
 * to this file biased toward "when unsure, don't gate."
 *
 * ## Scope: `message` + `evidence`, never `suggestion`
 *
 * A `suggestion` proposes a fix — code that does NOT exist yet, by
 * definition. Treating its quoted spans as a "citation of current code"
 * would gate nearly every finding that includes one, for exactly backwards
 * reasons. Only `message` and `evidence` are searched.
 */

/**
 * Minimum length for a quoted span to count as a citation. Shorter spans
 * (single characters, bare short numbers) are too likely to coincidentally
 * appear — or fail to appear — anywhere in a file to carry any signal.
 */
const MIN_CITATION_LENGTH = 4;

/**
 * Extract backtick-quoted spans from finding free text that read as real
 * code citations rather than illustrative examples.
 *
 * A span beginning with `-` is deliberately excluded: rule prompts
 * legitimately quote hypothetical malformed INPUT VALUES in `message`
 * alongside real code citations (e.g. the untrusted-input rule's own
 * worked example quotes `` `--votes foo` `` as an illustrative malformed
 * CLI arg, never expected to appear verbatim in the file). Treating an
 * illustrative value as a citation would gate true findings on that
 * illustration alone — exactly the false-positive this module exists to
 * avoid.
 */
export function extractCitedSpans(...texts: Array<string | undefined>): string[] {
  const spans: string[] = [];
  const pattern = /`([^`\n]+)`/g;
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(pattern)) {
      const span = match[1].trim();
      if (span.length >= MIN_CITATION_LENGTH && !span.startsWith('-')) {
        spans.push(span);
      }
    }
  }
  return spans;
}

export type CitationVerdict = 'no-citation' | 'match' | 'mismatch' | 'unverifiable';

/**
 * Verify extracted citation spans against the current file's full content.
 *
 * `'match'` requires only ONE span to be found, not every span — a finding
 * that legitimately quotes both a removed pattern and a still-present one
 * (or a real citation alongside prose that happens to hit the backtick
 * regex) must not be gated just because not every span matches.
 */
export function verifyCitation(
  spans: string[],
  currentFileContent: string | null,
): CitationVerdict {
  if (spans.length === 0) return 'no-citation';
  if (currentFileContent === null) return 'unverifiable';
  return spans.some(span => currentFileContent.includes(span)) ? 'match' : 'mismatch';
}

/** The subset of a finding's fields this gate reads. */
export interface CitableFinding {
  message: string;
  evidence?: string;
}

/**
 * True only for the fail-CLOSED side of this gate: a finding that quotes
 * code and NONE of what it quotes exists in the current file. Every other
 * outcome (`no-citation`, `match`, `unverifiable`) returns false — see the
 * module doc's asymmetry note.
 */
export function shouldGateFinding(
  finding: CitableFinding,
  currentFileContent: string | null,
): boolean {
  const spans = extractCitedSpans(finding.message, finding.evidence);
  return verifyCitation(spans, currentFileContent) === 'mismatch';
}
