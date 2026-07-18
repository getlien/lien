import { describe, it, expect } from 'vitest';

import {
  assembleAttestation,
  emptyAttestation,
  computeVerdict,
  deriveMainPassAttestation,
  formatAttestationBadgeLine,
  ATTESTATION_VERSION,
  type AttestationInput,
  type ExtraPassAttestationInput,
  type ReviewFinding,
} from '../src/index.js';

/** A baseline set of inputs representing a clean, fully-delivered run. */
function baseInput(overrides?: Partial<AttestationInput>): AttestationInput {
  return {
    conclusion: 'success',
    filesAnalyzed: 3,
    eligibilityPath: 'normal',
    findings: [],
    agentAttempted: true,
    providerFailure: false,
    allocatedTokens: 100_000,
    spentTokens: 12_000,
    passesSkipped: [],
    annotationsEmitted: 0,
    inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0 },
    descriptionBadgeUpdated: true,
    outOfDiffReviewPosted: null,
    ...overrides,
  };
}

function neverRanFinding(): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'error',
    category: 'summary',
    message: 'Lien Review did not run — every provider request failed.',
    metadata: { incomplete: true, neverRan: true, stopReason: 'error' },
  };
}

function incompleteFinding(stopReason: 'budget' | 'max_turns'): ReviewFinding {
  return {
    pluginId: 'agent-review',
    filepath: '',
    line: 0,
    severity: 'warning',
    category: 'summary',
    message: 'Lien Review did not finish.',
    metadata: { incomplete: true, stopReason },
  };
}

describe('assembleAttestation', () => {
  it('is versioned as v2', () => {
    expect(assembleAttestation(baseInput()).attestationVersion).toBe(ATTESTATION_VERSION);
    expect(ATTESTATION_VERSION).toBe(2);
  });

  it('produces verdict "delivered" for a clean, fully-delivered run', () => {
    const attestation = assembleAttestation(baseInput());
    expect(attestation.verdict).toBe('delivered');
    expect(attestation.provider.passes).toEqual([
      { name: 'main', ran: true, stopReason: 'completed', neverRan: false, candidatesDeferred: 0 },
    ]);
    expect(attestation.budget).toEqual({
      allocatedTokens: 100_000,
      spentTokens: 12_000,
      starved: false,
      passes: [{ name: 'main', allocatedTokens: 100_000, spentTokens: 12_000, starved: false }],
    });
  });

  it('produces verdict "failed:provider_never_ran" when the main pass never ran', () => {
    const attestation = assembleAttestation(
      baseInput({ conclusion: 'failure', findings: [neverRanFinding()], providerFailure: true }),
    );
    expect(attestation.verdict).toBe('failed:provider_never_ran');
    expect(attestation.provider.passes[0]).toEqual({
      name: 'main',
      ran: true,
      stopReason: 'error',
      neverRan: true,
      candidatesDeferred: 0,
    });
  });

  it('produces verdict "degraded:budget_starved" when the main pass stopped on budget', () => {
    const attestation = assembleAttestation(
      baseInput({
        conclusion: 'neutral',
        findings: [incompleteFinding('budget')],
        allocatedTokens: 100_000,
        spentTokens: 99_500,
      }),
    );
    expect(attestation.verdict).toBe('degraded:budget_starved');
    expect(attestation.budget.starved).toBe(true);
  });

  it('produces verdict "degraded:provider_partial" for a non-budget incomplete stop', () => {
    const attestation = assembleAttestation(
      baseInput({ conclusion: 'neutral', findings: [incompleteFinding('max_turns')] }),
    );
    expect(attestation.verdict).toBe('degraded:provider_partial');
    expect(attestation.budget.starved).toBe(false);
  });

  it('produces verdict "degraded:comments_dropped" when comments were dropped on an otherwise clean run', () => {
    const attestation = assembleAttestation(
      baseInput({
        inlineComments: { attempted: 4, posted: 2, dropped: 2, deduped: 0 },
      }),
    );
    expect(attestation.verdict).toBe('degraded:comments_dropped');
  });

  // Regression coverage for the CodeRabbit #768 finding: computeVerdict used
  // to ignore descriptionBadgeUpdated/outOfDiffReviewPosted entirely, so a run
  // where the PR-description update failed (or the out-of-diff summary
  // comment failed to post) was still attested "delivered".
  it('produces verdict "degraded:delivery_incomplete" when the description badge update failed', () => {
    const attestation = assembleAttestation(baseInput({ descriptionBadgeUpdated: false }));
    expect(attestation.verdict).toBe('degraded:delivery_incomplete');
  });

  it('produces verdict "degraded:delivery_incomplete" when the out-of-diff review comment failed', () => {
    const attestation = assembleAttestation(baseInput({ outOfDiffReviewPosted: false }));
    expect(attestation.verdict).toBe('degraded:delivery_incomplete');
  });

  it('stays "delivered" when nothing was attempted (null), not just when it succeeded', () => {
    // null means "no plugin contributed a description this run" / "no plugin
    // attempted an out-of-diff comment" — distinct from false ("attempted and
    // failed"). Only false should degrade the verdict.
    const attestation = assembleAttestation(
      baseInput({ descriptionBadgeUpdated: null, outOfDiffReviewPosted: null }),
    );
    expect(attestation.verdict).toBe('delivered');
  });

  it('produces verdict "failed:analysis_error" when the pipeline failed before the engine ran', () => {
    const attestation = assembleAttestation(
      baseInput({ conclusion: 'failure', agentAttempted: false, pipelineFailed: true }),
    );
    expect(attestation.verdict).toBe('failed:analysis_error');
    expect(attestation.provider.passes).toEqual([]);
  });

  it('never_ran outranks a starved budget or dropped comments (precedence)', () => {
    const attestation = assembleAttestation(
      baseInput({
        conclusion: 'failure',
        findings: [neverRanFinding()],
        providerFailure: true,
        inlineComments: { attempted: 4, posted: 0, dropped: 4, deduped: 0 },
      }),
    );
    expect(attestation.verdict).toBe('failed:provider_never_ran');
  });

  it('reports an empty passes array when the agent-review plugin never ran', () => {
    const attestation = assembleAttestation(
      baseInput({
        agentAttempted: false,
        passesSkipped: [{ plugin: 'agent-review', reason: 'requires LLM but none configured' }],
      }),
    );
    expect(attestation.provider.passes).toEqual([]);
    expect(attestation.passesSkipped).toEqual([
      { plugin: 'agent-review', reason: 'requires LLM but none configured' },
    ]);
    expect(attestation.verdict).toBe('delivered');
  });

  // ---------------------------------------------------------------------------
  // Two-pass attestation (the per-rule-loops generalization this file's
  // ATTESTATION_VERSION bump to 2 is for): a clean run where the doc-truth
  // second pass also fired must get its OWN provider.passes[] entry and its
  // OWN budget.passes[] breakdown — not folded into the main pass's numbers.
  // ---------------------------------------------------------------------------
  describe('two-pass attestation (main + doc-truth)', () => {
    function docTruthPass(
      overrides?: Partial<ExtraPassAttestationInput>,
    ): ExtraPassAttestationInput {
      return {
        name: 'doc-truth',
        stopReason: 'completed',
        neverRan: false,
        allocatedTokens: 40_000,
        spentTokens: 8_000,
        candidatesDeferred: 0,
        ...overrides,
      };
    }

    it('reports a SEPARATE provider.passes[] entry for the extra pass, not just main', () => {
      const attestation = assembleAttestation(baseInput({ extraPasses: [docTruthPass()] }));
      expect(attestation.provider.passes).toEqual([
        {
          name: 'main',
          ran: true,
          stopReason: 'completed',
          neverRan: false,
          candidatesDeferred: 0,
        },
        {
          name: 'doc-truth',
          ran: true,
          stopReason: 'completed',
          neverRan: false,
          candidatesDeferred: 0,
          deferredCandidateIds: undefined,
        },
      ]);
    });

    it('aggregates budget.allocatedTokens/spentTokens across BOTH passes, with a per-pass breakdown', () => {
      // Main: 100K allocated / 12K spent (baseInput's defaults). Doc-truth:
      // 40K allocated / 8K spent. Before this generalization, allocatedTokens
      // was main-only (100K) while spentTokens already summed both passes
      // (20K) — an inconsistent, understated ceiling. Both now aggregate.
      const attestation = assembleAttestation(baseInput({ extraPasses: [docTruthPass()] }));
      expect(attestation.budget).toEqual({
        allocatedTokens: 140_000,
        spentTokens: 20_000,
        starved: false,
        passes: [
          { name: 'main', allocatedTokens: 100_000, spentTokens: 12_000, starved: false },
          { name: 'doc-truth', allocatedTokens: 40_000, spentTokens: 8_000, starved: false },
        ],
      });
    });

    it('attributes a doc-truth-only budget starvation to doc-truth, not main (the bug this fixes)', () => {
      // Main pass finished cleanly (stopReason 'completed', no incomplete
      // finding); ONLY the doc-truth pass ran out of budget. Before this
      // generalization, the doc pass's incomplete state got folded into the
      // MAIN pass's own stopReason upstream (mergeDocPassIntoResult), so this
      // scenario was indistinguishable from the main pass itself starving.
      const attestation = assembleAttestation(
        baseInput({
          extraPasses: [
            docTruthPass({ stopReason: 'budget', allocatedTokens: 40_000, spentTokens: 40_000 }),
          ],
        }),
      );
      expect(attestation.verdict).toBe('degraded:budget_starved');
      expect(attestation.provider.passes).toEqual([
        {
          name: 'main',
          ran: true,
          stopReason: 'completed',
          neverRan: false,
          candidatesDeferred: 0,
        },
        {
          name: 'doc-truth',
          ran: true,
          stopReason: 'budget',
          neverRan: false,
          candidatesDeferred: 0,
          deferredCandidateIds: undefined,
        },
      ]);
      // Aggregate flags starved...
      expect(attestation.budget.starved).toBe(true);
      // ...and the per-pass breakdown shows exactly WHICH pass starved.
      const [mainBudget, docTruthBudget] = attestation.budget.passes;
      expect(mainBudget.starved).toBe(false);
      expect(docTruthBudget.starved).toBe(true);
    });

    it('does not include extra passes at all when the agent-review plugin never ran', () => {
      const attestation = assembleAttestation(
        baseInput({ agentAttempted: false, extraPasses: [docTruthPass()] }),
      );
      expect(attestation.provider.passes).toEqual([]);
      expect(attestation.budget.passes).toEqual([]);
      expect(attestation.budget).toEqual({
        allocatedTokens: 0,
        spentTokens: 0,
        starved: false,
        passes: [],
      });
    });
  });
});

describe('emptyAttestation', () => {
  it('builds a "delivered" attestation for the zero-files early-exit path', () => {
    const attestation = emptyAttestation('success', 0, 'zero_files_early_exit');
    expect(attestation.verdict).toBe('delivered');
    expect(attestation.scope).toEqual({
      eligibilityPath: 'zero_files_early_exit',
      filesAnalyzed: 0,
    });
    expect(attestation.provider.passes).toEqual([]);
    // Nothing was attempted on this early-exit path — null ("not attempted"),
    // not false ("attempted and failed"), so it must not read as degraded.
    expect(attestation.delivery.descriptionBadge.updated).toBeNull();
  });

  it('builds a "failed:analysis_error" attestation for the pre-engine pipeline failure path', () => {
    const attestation = emptyAttestation('failure', 5, 'normal', true);
    expect(attestation.verdict).toBe('failed:analysis_error');
  });
});

describe('deriveMainPassAttestation', () => {
  it('returns ran:false, stopReason:not_run when the agent-review plugin was never attempted', () => {
    expect(deriveMainPassAttestation([], false, false)).toEqual({
      name: 'main',
      ran: false,
      stopReason: 'not_run',
      neverRan: false,
      candidatesDeferred: 0,
    });
  });

  it('defaults an unlabeled incomplete finding to stopReason "error" rather than throwing', () => {
    const malformed: ReviewFinding = {
      pluginId: 'agent-review',
      filepath: '',
      line: 0,
      severity: 'warning',
      category: 'summary',
      message: 'incomplete, no stopReason',
      metadata: { incomplete: true },
    };
    expect(deriveMainPassAttestation([malformed], true, false)).toEqual({
      name: 'main',
      ran: true,
      stopReason: 'error',
      neverRan: false,
      candidatesDeferred: 0,
    });
  });
});

describe('computeVerdict', () => {
  it('pipelineFailed takes precedence over everything else', () => {
    const verdict = computeVerdict({
      pipelineFailed: true,
      providerFailure: true,
      passes: [{ name: 'main', ran: true, stopReason: 'budget', neverRan: false }],
      inlineComments: { attempted: 1, posted: 0, dropped: 1, deduped: 0 },
    });
    expect(verdict).toBe('failed:analysis_error');
  });

  it('attributes budget_starved to whichever pass actually stopped on budget, not just passes[0]', () => {
    // main completed cleanly; a LATER pass (e.g. doc-truth) is the one that
    // starved — the verdict must still resolve to degraded:budget_starved,
    // driven by that pass, not by main's own (clean) stopReason.
    const verdict = computeVerdict({
      pipelineFailed: false,
      providerFailure: false,
      passes: [
        { name: 'main', ran: true, stopReason: 'completed', neverRan: false },
        { name: 'doc-truth', ran: true, stopReason: 'budget', neverRan: false },
      ],
      inlineComments: { attempted: 0, posted: 0, dropped: 0, deduped: 0 },
    });
    expect(verdict).toBe('degraded:budget_starved');
  });
});

describe('formatAttestationBadgeLine', () => {
  it('renders verdict, comment counts, and token usage in one compact line', () => {
    const attestation = assembleAttestation(
      baseInput({
        inlineComments: { attempted: 6, posted: 4, dropped: 2, deduped: 0 },
        allocatedTokens: 250_000,
        spentTokens: 238_000,
      }),
    );
    const line = formatAttestationBadgeLine(attestation);
    expect(line).toContain(`Attested: ${attestation.verdict}`);
    expect(line).toContain('4/6 comments posted');
    expect(line).toContain('238K/250K tokens');
  });
});
