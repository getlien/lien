import { describe, it, expect, vi } from 'vitest';
import { AgentReviewPlugin, derivePresentTimeVerdict } from '../src/plugins/agent/index.js';
import { computeVerdict } from '../src/attestation.js';
import type { ProviderPassAttestation } from '../src/attestation.js';
import { silentLogger } from '../src/test-helpers.js';
import type { PresentContext, ReviewFinding } from '../src/plugin-types.js';
import type { PRContext } from '../src/types.js';

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

/** A normal, completed-run summary finding — `appendSummaryFinding`'s shape. */
function summaryFinding(overrides?: {
  riskLevel?: string;
  overview?: string;
  keyChanges?: string[];
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
    },
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
  const mainPass = (overrides?: Partial<ProviderPassAttestation>): ProviderPassAttestation => ({
    name: 'main',
    ran: true,
    stopReason: 'completed',
    neverRan: false,
    candidatesDeferred: 0,
    ...overrides,
  });

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
