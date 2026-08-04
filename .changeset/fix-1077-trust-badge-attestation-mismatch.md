---
'@liendev/review': patch
---

fix: stop the PR trust badge claiming "delivered" on an attestation of `degraded:budget_starved` (#1077)

Lien Review's `Trust: **Delivered** — The review ran to completion within
budget.` line could render on a PR whose own delivery attestation, posted
minutes later in the same body, read `Attested: degraded:budget_starved`
(#1073, #1078). Both `anthropic-client.ts` and `openai-client.ts` run a
forced summary-retry after a pass exhausts its token/turn budget — if that
retry recovers a parseable verdict, the pass's `incomplete` flag clears even
though its `stopReason` stays `'budget'`/`'max_turns'`. For an EXTRA pass
(doc-truth, incomplete-handling-loop), that meant the merge into the main
result's `incomplete` flag never fired, so `derivePresentTimeVerdict`
(`plugins/agent/index.ts`) — which only read that gated flag — saw nothing
and defaulted to `'delivered'`. The attestation's `computeVerdict` was never
fooled: it reads every extra pass's own raw, ungated `stopReason` directly
off `PassOutcome`.

`appendSummaryFinding` now stamps each extra pass's raw `stopReason`
(`extraPassStopReasons`) onto the summary finding unconditionally, and
`derivePresentTimeVerdict` checks it before falling back to `'delivered'` —
the same two-tier read (main pass gated on `mainPassIncomplete`, extra passes
ungated) `computeVerdict` already uses, so the two can no longer disagree on
this axis. `plugins-agent-trust-badge.test.ts` now enumerates all seven
`AttestationVerdict` values against the present-time badge, including the
regression scenario and the three verdicts genuinely not representable at
present-time (documented as deliberate, not silently dropped).
