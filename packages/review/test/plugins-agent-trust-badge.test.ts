import { describe, it, expect, vi } from 'vitest';
import {
  AgentReviewPlugin,
  derivePresentTimeVerdict,
  appendSummaryFinding,
} from '../src/plugins/agent/index.js';
import { computeVerdict } from '../src/attestation.js';
import type { AttestationVerdict, ProviderPassAttestation } from '../src/attestation.js';
import { silentLogger } from '../src/test-helpers.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';
import type { PRContext } from '../src/types.js';
import type { PassOutcome } from '../src/plugins/agent/review-pass.js';

/** A clean delivery — no dropped comments, no write failures — so `computeVerdict`'s
 * verdict is driven purely by `passes`, the one dimension `derivePresentTimeVerdict`
 * can also see. */
function cleanDelivery() {
  return {
    inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0, citationGated: 0 },
    descriptionBadgeUpdated: null,
    outOfDiffReviewPosted: null,
  };
}

// ---------------------------------------------------------------------------
// Fixtures — mirror the exact shapes appendSummaryFinding/appendIncompleteNotice/
// appendNeverRanNotice produce (plugins/agent/index.ts), so these tests exercise
// the same metadata contract the real pipeline stamps.
// ---------------------------------------------------------------------------

/**
 * A normal, completed-run summary finding — `appendSummaryFinding`'s shape.
 * `extraPassStopReasons` defaults to `[]` (no extra pass ran), matching that
 * function's own unconditional stamp (issue #1077 — see its doc comment).
 */
function summaryFinding(overrides?: {
  riskLevel?: string;
  overview?: string;
  keyChanges?: string[];
  extraPassStopReasons?: { name: string; stopReason: string }[];
}): ReviewFinding {
  const overview = overrides?.overview ?? 'This PR looks fine overall.';
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'info',
    category: 'summary',
    message: overview,
    metadata: {
      riskLevel: overrides?.riskLevel ?? 'low',
      overview,
      keyChanges: overrides?.keyChanges ?? [],
      extraPassStopReasons: overrides?.extraPassStopReasons ?? [],
    },
  };
}

/** One extra pass's outcome, as reported by `review-pass.ts`'s `buildPassOutcome` —
 *  the minimal shape `appendSummaryFinding` needs from a `PassOutcome[]`. */
function passOutcome(name: string, stopReason: PassOutcome['stopReason']): PassOutcome {
  return {
    name,
    stopReason,
    neverRan: false,
    allocatedTokens: 20_000,
    spentTokens: 20_000,
    candidatesDeferred: 0,
  };
}

/** One pass's `computeVerdict`-facing attestation entry — module-scoped (not
 *  nested in a single `describe`) since several describe blocks below all
 *  need to build a `passes[]` array. */
function mainPass(overrides?: Partial<ProviderPassAttestation>): ProviderPassAttestation {
  return {
    name: 'main',
    ran: true,
    stopReason: 'completed',
    neverRan: false,
    candidatesDeferred: 0,
    ...overrides,
  };
}

/** The main-pass incomplete notice — `appendIncompleteNotice`'s main-pass branch. */
function incompleteMainFinding(stopReason: 'budget' | 'max_turns' | 'completed'): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'warning',
    category: 'summary',
    message: 'Lien Review did not finish.',
    metadata: { incomplete: true, stopReason, overview: 'partial', mainPassIncomplete: true },
  };
}

/** An extra-pass-only incomplete notice (e.g. doc-truth) — main is unaffected. */
function incompleteExtraPassFinding(stopReason: 'budget' | 'max_turns'): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'warning',
    category: 'summary',
    message: 'The documentation-truthfulness pass did not finish.',
    metadata: { incomplete: true, stopReason, overview: 'doc-truth partial' },
  };
}

/** The never-ran notice — `appendNeverRanNotice`'s shape. */
function neverRanFinding(): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'error',
    category: 'summary',
    message: 'Lien Review did not run.',
    metadata: { incomplete: true, neverRan: true, stopReason: 'error', overview: 'never ran' },
  };
}

/** A PresentContext recording appendDescription for assertions. */
function recordingContext(): { ctx: PresentContext; appendDescription: ReturnType<typeof vi.fn> } {
  const appendDescription = vi.fn();
  const pr = {
    owner: 'o',
    repo: 'r',
    pullNumber: 1,
    title: 't',
    baseSha: 'base',
    headSha: 'head',
  } as PRContext;

  const ctx = {
    complexityReport: { files: {}, summary: {} },
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    pr,
    logger: silentLogger,
    addAnnotations: vi.fn(),
    appendSummary: vi.fn(),
    appendDescription,
  } as unknown as PresentContext;

  return { ctx, appendDescription };
}

// ---------------------------------------------------------------------------
// Trust verdict line — rendered inside the agent plugin's PR-description
// contribution (the "lien-stats" block), independent of the model's own
// overview prose (the #954 shape this closes).
// ---------------------------------------------------------------------------

describe('AgentReviewPlugin.present — trust verdict line', () => {
  const plugin = new AgentReviewPlugin();

  it('renders a quiet, non-callout line for a clean, completed run', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([summaryFinding()], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('Trust: **Delivered**');
    expect(description).toContain('completion within budget');
    // Not a GitHub alert callout — this is the quiet path.
    expect(description).not.toMatch(/> \[!(WARNING|CAUTION)\]\n> ✅/);
  });

  it('renders even when the model overview prose contradicts it (the #954 shape)', async () => {
    // The exact motivating bug: the completed-run summary's own free-form
    // overview claims a budget problem that the ground-truth metadata (no
    // incomplete/neverRan notice at all) does not corroborate.
    const { ctx, appendDescription } = recordingContext();
    const misleadingSummary = summaryFinding({
      overview: 'I was unable to complete a full review before budget exhaustion.',
    });

    await plugin.present([misleadingSummary], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain(
      'I was unable to complete a full review before budget exhaustion.',
    );
    // The deterministic line still asserts Delivered — a reader can check
    // the prose above against it instead of trusting the prose alone.
    expect(description).toContain('Trust: **Delivered**');
  });

  it('renders a CAUTION callout when every provider request failed', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([neverRanFinding()], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('> [!CAUTION]');
    expect(description).toContain('Trust: Failed — provider never ran');
    expect(description).toContain('No code was analyzed this run.');
  });

  it('renders a WARNING callout naming budget-starved when the main pass ran out of budget', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([incompleteMainFinding('budget')], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('> [!WARNING]');
    expect(description).toContain('Trust: Degraded — budget-starved');
    expect(description).toContain('exhausting its token budget');
  });

  it('renders a WARNING callout naming a generic partial stop for a non-budget incomplete', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([incompleteMainFinding('max_turns')], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('> [!WARNING]');
    expect(description).toContain('Trust: Degraded — partial');
    expect(description).not.toContain('budget-starved');
  });

  it('degrades the trust line even when only an extra pass (not main) stalled', async () => {
    // Matches computeVerdict's own precedent (attestation.test.ts): a
    // doc-truth-only budget starvation still degrades the run's overall
    // health, even though the main pass's bug-finding coverage is intact.
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([summaryFinding(), incompleteExtraPassFinding('budget')], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('Trust: Degraded — budget-starved');
    // The main-pass-completion signal is untouched: no "did not complete" headline.
    expect(description).not.toContain('Review did not complete');
  });

  it('degrades the trust line when an extra pass hit budget but a forced retry rescued a summary (#1077)', async () => {
    // The exact bug #1077 reports: doc-truth (or incomplete-handling-loop)
    // ran out of budget mid-investigation, but the client's forced
    // summary-retry (anthropic-client.ts/openai-client.ts's
    // `runSummaryRetry`) still recovered a parseable verdict, so NOTHING got
    // marked `incomplete` anywhere — the only trace left is the raw
    // `stopReason` `appendSummaryFinding` now stamps unconditionally.
    const { ctx, appendDescription } = recordingContext();
    const summaryWithStarvedExtra = summaryFinding({
      extraPassStopReasons: [{ name: 'doc-truth', stopReason: 'budget' }],
    });

    await plugin.present([summaryWithStarvedExtra], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).toContain('Trust: Degraded — budget-starved');
    expect(description).not.toContain('Trust: **Delivered**');
  });

  it('renders nothing when the agent-review plugin did not run this review at all', async () => {
    const { ctx, appendDescription } = recordingContext();

    await plugin.present([], ctx);

    const description = appendDescription.mock.calls[0][0] as string;
    expect(description).not.toContain('Trust:');
  });
});

// ---------------------------------------------------------------------------
// derivePresentTimeVerdict — consistency with computeVerdict
//
// Two independent derivations of "is this run trustworthy" now exist:
// computeVerdict (post-hoc, attestation.ts, 7 verdicts) and
// derivePresentTimeVerdict (render-time, this file, a reduced 4). Nothing
// structurally stops them from drifting apart — a future change to one
// taxonomy could silently leave the other behind, which is exactly the kind
// of gap this PR exists to close, one level up. These tests pin every input
// state both functions can see: either they must agree, or the mismatch is
// asserted and explained (never a silent, unpinned divergence).
// ---------------------------------------------------------------------------

describe('derivePresentTimeVerdict — consistency with computeVerdict', () => {
  it('agree on a clean, completed run: delivered', () => {
    const present = derivePresentTimeVerdict([summaryFinding()]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass()],
      ...cleanDelivery(),
    });
    expect(present).toBe('delivered');
    expect(full).toBe('delivered');
    expect(present).toBe(full);
  });

  it('agree when every provider request failed: failed:provider_never_ran', () => {
    const present = derivePresentTimeVerdict([neverRanFinding()]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: true,
      passes: [mainPass({ stopReason: 'error', neverRan: true })],
      ...cleanDelivery(),
    });
    expect(present).toBe('failed:provider_never_ran');
    expect(full).toBe('failed:provider_never_ran');
    expect(present).toBe(full);
  });

  it('agree when the main pass stopped on budget: degraded:budget_starved', () => {
    const present = derivePresentTimeVerdict([incompleteMainFinding('budget')]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass({ stopReason: 'budget' })],
      ...cleanDelivery(),
    });
    expect(present).toBe('degraded:budget_starved');
    expect(full).toBe('degraded:budget_starved');
    expect(present).toBe(full);
  });

  it('agree when the main pass stopped for a non-budget reason: degraded:provider_partial', () => {
    const present = derivePresentTimeVerdict([incompleteMainFinding('max_turns')]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass({ stopReason: 'max_turns' })],
      ...cleanDelivery(),
    });
    expect(present).toBe('degraded:provider_partial');
    expect(full).toBe('degraded:provider_partial');
    expect(present).toBe(full);
  });

  it('agree when only an extra pass (not main) stalled on budget: degraded:budget_starved', () => {
    // Mirrors attestation.test.ts's own computeVerdict case for this shape
    // (a doc-truth-only budget starvation folded into the overall verdict).
    const present = derivePresentTimeVerdict([
      summaryFinding(),
      incompleteExtraPassFinding('budget'),
    ]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass(), { ...mainPass({ stopReason: 'budget' }), name: 'doc-truth' }],
      ...cleanDelivery(),
    });
    expect(present).toBe('degraded:budget_starved');
    expect(full).toBe('degraded:budget_starved');
    expect(present).toBe(full);
  });

  it('agree when an extra pass hit budget but a forced retry rescued a summary: degraded:budget_starved (#1077)', () => {
    // The actual regression: nothing is marked `incomplete` anywhere (the
    // pass's own client-level retry recovered a parseable verdict), so the
    // OLD `incomplete`-only check would have found nothing and returned
    // `'delivered'` here while `computeVerdict` — fed the pass's raw,
    // ungated `stopReason` via `PassOutcome`, exactly as `buildPassOutcome`
    // (review-pass.ts) reports it regardless of `incomplete` — correctly
    // read `degraded:budget_starved`. This is PR #1073/#1078 verbatim.
    const present = derivePresentTimeVerdict([
      summaryFinding({ extraPassStopReasons: [{ name: 'doc-truth', stopReason: 'budget' }] }),
    ]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass(), { ...mainPass({ stopReason: 'budget' }), name: 'doc-truth' }],
      ...cleanDelivery(),
    });
    expect(present).toBe('degraded:budget_starved');
    expect(full).toBe('degraded:budget_starved');
    expect(present).toBe(full);
  });

  it('agree when a retry-rescued extra pass hit a non-budget stop: degraded:provider_partial (#1077)', () => {
    const present = derivePresentTimeVerdict([
      summaryFinding({
        extraPassStopReasons: [{ name: 'incomplete-handling-loop', stopReason: 'max_turns' }],
      }),
    ]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [
        mainPass(),
        { ...mainPass({ stopReason: 'max_turns' }), name: 'incomplete-handling-loop' },
      ],
      ...cleanDelivery(),
    });
    expect(present).toBe('degraded:provider_partial');
    expect(full).toBe('degraded:provider_partial');
    expect(present).toBe(full);
  });

  it('DIVERGES (documented) when the plugin never ran: present is null, full is delivered', () => {
    // The one pinned, deliberate mismatch — see derivePresentTimeVerdict's own
    // doc comment. `computeVerdict` fed `agentAttempted: false` calls a no-op
    // review "delivered" (nothing could have gone wrong). Rendering that same
    // label here would falsely claim a review happened, so this function
    // returns `null` (buildTrustSection renders nothing) instead. If a future
    // change makes `computeVerdict` stop mapping this case to `'delivered'`,
    // this assertion — not just the PR description — is what should catch it.
    const present = derivePresentTimeVerdict([]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [], // buildPassesAndBudget's agentAttempted: false shape
      ...cleanDelivery(),
    });
    expect(present).toBeNull();
    expect(full).toBe('delivered');
    expect(present).not.toBe(full);
  });
});

// ---------------------------------------------------------------------------
// appendSummaryFinding — the real stamping function, not a hand-built fixture
//
// The tests above all construct `ReviewFinding` fixtures by hand to pin
// `derivePresentTimeVerdict`'s own contract. This block instead calls the
// REAL `appendSummaryFinding` (plugins/agent/index.ts) with a `PassOutcome[]`
// shaped exactly like `runExtraPasses` (review-pass.ts) produces, closing the
// loop between "the pipeline stamps this metadata" and "derivePresentTimeVerdict
// reads it correctly" — #1077's bug was exactly a mismatch between what one
// function stamped and what the other read.
// ---------------------------------------------------------------------------

describe('appendSummaryFinding — extraPassStopReasons stamping (#1077)', () => {
  it('stamps every extra pass outcome unconditionally, even when every pass is clean', () => {
    const findings: ReviewFinding[] = [];
    appendSummaryFinding(
      findings,
      'agent-review',
      { riskLevel: 'low', overview: 'fine', keyChanges: [] },
      [passOutcome('doc-truth', 'completed')],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].metadata).toMatchObject({
      extraPassStopReasons: [{ name: 'doc-truth', stopReason: 'completed' }],
    });
    expect(derivePresentTimeVerdict(findings)).toBe('delivered');
  });

  it('stamps a starved extra pass raw stopReason with no `incomplete` flag anywhere', () => {
    // The exact real-pipeline shape behind #1073/#1078: the client's
    // summary-retry recovered a verdict for doc-truth (so nothing upstream
    // ever calls this an `incomplete` pass), but its `PassOutcome.stopReason`
    // still truthfully reports `'budget'`.
    const findings: ReviewFinding[] = [];
    appendSummaryFinding(
      findings,
      'agent-review',
      { riskLevel: 'low', overview: 'fine', keyChanges: [] },
      [passOutcome('doc-truth', 'budget')],
    );

    expect(findings[0].metadata).not.toHaveProperty('incomplete');
    expect(derivePresentTimeVerdict(findings)).toBe('degraded:budget_starved');
  });

  it('is a no-op when the main pass produced no summary (budget exhausted before wrap-up)', () => {
    const findings: ReviewFinding[] = [];
    appendSummaryFinding(findings, 'agent-review', undefined, [passOutcome('doc-truth', 'budget')]);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Every AttestationVerdict the engine can produce, exhaustively
//
// #1077 requires enumerating every verdict `computeVerdict` can return and
// asserting the present-time badge for each — not just the happy path. Four
// of the seven are representable at present() time and MUST agree with
// `computeVerdict` bit-for-bit (enforced above and re-asserted here as a
// single table so the enumeration itself is visible in one place). The
// other three are deliberately NOT representable yet — `PresentTimeVerdict`'s
// own doc comment explains why for each — and this block pins that they are
// still never a FALSE claim: `derivePresentTimeVerdict` degrades to
// `'delivered'`/`null` for them, never to a wrong non-'delivered' verdict,
// and the separate post-hoc `Attested: …` line (`formatAttestationBadgeLine`,
// unconditionally posted by `syncAttestationBadge` whenever verdict !==
// 'delivered') still carries the accurate, complete verdict alongside it.
// ---------------------------------------------------------------------------

describe('every AttestationVerdict — present-time badge coverage', () => {
  const ALL_VERDICTS: AttestationVerdict[] = [
    'delivered',
    'degraded:provider_partial',
    'degraded:budget_starved',
    'degraded:comments_dropped',
    'degraded:delivery_incomplete',
    'failed:provider_never_ran',
    'failed:analysis_error',
  ];

  // Every verdict `computeVerdict` can emit, TypeScript-enforced (adding a
  // new AttestationVerdict member without adding it here is a type error on
  // the array literal above, not a silently-passing gap).
  it('this suite enumerates all seven verdicts computeVerdict can produce', () => {
    expect(ALL_VERDICTS).toHaveLength(7);
  });

  it.each([
    ['delivered' as const, [summaryFinding()], 'delivered'],
    [
      'degraded:provider_partial (main)' as const,
      [incompleteMainFinding('max_turns')],
      'degraded:provider_partial',
    ],
    [
      'degraded:budget_starved (main)' as const,
      [incompleteMainFinding('budget')],
      'degraded:budget_starved',
    ],
    [
      'degraded:budget_starved (extra, retry-rescued)' as const,
      [summaryFinding({ extraPassStopReasons: [{ name: 'doc-truth', stopReason: 'budget' }] })],
      'degraded:budget_starved',
    ],
    ['failed:provider_never_ran' as const, [neverRanFinding()], 'failed:provider_never_ran'],
  ])('%s: present-time badge matches the representable verdict', (_label, findings, expected) => {
    expect(derivePresentTimeVerdict(findings)).toBe(expected);
  });

  it('degraded:comments_dropped is not representable at present() time — badge stays delivered, never false', () => {
    // Comment delivery happens AFTER present() returns (see PresentTimeVerdict's
    // doc comment) — findings look identical to a clean run at present() time.
    const present = derivePresentTimeVerdict([summaryFinding()]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass()],
      inlineComments: { attempted: 3, posted: 2, dropped: 1, deduped: 0, citationGated: 0 },
      descriptionBadgeUpdated: null,
      outOfDiffReviewPosted: null,
    });
    expect(full).toBe('degraded:comments_dropped');
    // Not a false claim: the review DID complete within budget. The separate
    // `Attested: degraded:comments_dropped …` line (formatAttestationBadgeLine)
    // still surfaces the real verdict post-hoc.
    expect(present).toBe('delivered');
  });

  it('degraded:delivery_incomplete is not representable at present() time — badge stays delivered, never false', () => {
    const present = derivePresentTimeVerdict([summaryFinding()]);
    const full = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [mainPass()],
      ...cleanDelivery(),
      descriptionBadgeUpdated: false,
    });
    expect(full).toBe('degraded:delivery_incomplete');
    expect(present).toBe('delivered');
  });

  it('failed:analysis_error means the agent plugin never ran at all — badge renders nothing, never false', () => {
    // A pre-engine pipeline failure (the complexity report itself couldn't be
    // built) never registers the agent-review plugin, so present() sees `[]`
    // for it — same shape as the already-pinned agentAttempted:false case.
    const present = derivePresentTimeVerdict([]);
    const full = computeVerdict({
      pipelineFailed: true,
      providerFailure: false,
      passes: [],
      ...cleanDelivery(),
    });
    expect(full).toBe('failed:analysis_error');
    expect(present).toBeNull();
  });
});
