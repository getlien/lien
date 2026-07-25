/**
 * PR #845 (feat/nudge-docs-refs) — regression fixture for issue #829: the
 * review engine's verdict-derailment flake.
 *
 * This is NOT a rule-finding fixture. It pins a RELIABILITY shape: on this
 * PR's real diff, the main pass's own final ("finish_reason:'stop'") turn
 * repeatedly emitted a long prose investigation instead of the required
 * findings/summary JSON, and BOTH bounded summary-retry attempts (also
 * `response_format:'json_object'`) came back unparseable too — reported
 * honestly as `stopReason:'completed'` + `incomplete:true` (see
 * `describeIncompleteStop` in `agent-client-shared.ts`'s caller,
 * `index.ts`'s `appendIncompleteNotice`: "ended without emitting a
 * parseable JSON verdict while investigating").
 *
 * Real incidents (verbatim, free — GH Actions logs, no LLM spend to
 * reproduce): PR #845 run 30113956762 attempt 2 and run 30114812093
 * attempt 1, both prod Kimi (`moonshotai/kimi-k2.7-code`), both derailed
 * the same way — a ~227K-262K-token Turn 5 of dense "Issue 1: … Issue 21: …"
 * self-review prose, no parseable JSON anywhere in either attempt or its
 * two retries. Neither incident's captured text contains a genuine verdict
 * object anywhere (confirmed by inspecting the untruncated turn output), so
 * a parsing-side fix alone cannot recover THOSE specific runs — the fix
 * that ships with this fixture (`DEFAULT_PROVIDER_ROUTING.require_parameters:
 * true`, `defaults.ts`) targets the mechanism that made even the *forced*
 * JSON retries unreliable: without it, OpenRouter can route
 * `response_format:'json_object'` to a provider that silently ignores the
 * field instead of honoring or rejecting it (OpenRouter's own "Filter
 * Providers by Parameter Support" guidance). The complementary
 * `allBalancedJsonObjects` extractor change (same PR) closes a real but
 * narrower gap: a genuine verdict that isn't the FIRST balanced JSON object
 * in unfenced text is no longer invisible to the scanner.
 *
 * Tagged `characterization`, not `canary`: this is a known model-reliability
 * frontier (the prod model occasionally derails on JSON/regex-dense diffs),
 * not a rule this fixture can force to a 9/10 bar by prompt iteration alone.
 * `config: { docTruthPass: false }` is baked into the captured fixture so a
 * `--votes`/`--calibrate` run only pays for the main pass (the pass this
 * fixture is about), not doc-truth's separate pass on the same diff — same
 * pattern as `crossrepo/pr4172-columndatatype-gel-gap`'s baked-in config.
 *
 * The assertion below is a minimal Tier-1 sanity check (the run engaged the
 * diff at all) — this fixture's real signal is read from the harness's own
 * pass/fail rate across N votes/calibration runs and the per-vote trace
 * files (`--trace <dir>`), not a single finding's content. A rising
 * derailment rate here over time is the regression this fixture exists to
 * catch; a single red vote is expected some fraction of the time and is not
 * itself a regression.
 */
import type { FixtureAssertions } from '../../assertions.js';

const assertions: FixtureAssertions = {
  description:
    'PR #845 — JSON-dense docRefs diff; regression pin for the #829 verdict-derailment flake (main pass reliability, not a single finding)',
  rule: 'incomplete-handling',
  expect: (result, h) => {
    h.expectToolCalled('get_files_context', result);
  },
  votes: 3,
  tags: ['characterization'],
};

export default assertions;
