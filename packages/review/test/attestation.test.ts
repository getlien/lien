import { describe, it, expect } from 'vitest';

import {
  assembleAttestation,
  emptyAttestation,
  computeVerdict,
  deriveMainPassAttestation,
  formatAttestationBadgeLine,
  ATTESTATION_VERSION,
  type AttestationInput,
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
  it('is versioned as v1', () => {
    expect(assembleAttestation(baseInput()).attestationVersion).toBe(ATTESTATION_VERSION);
    expect(ATTESTATION_VERSION).toBe(1);
  });

  it('produces verdict "delivered" for a clean, fully-delivered run', () => {
    const attestation = assembleAttestation(baseInput());
    expect(attestation.verdict).toBe('delivered');
    expect(attestation.provider.passes).toEqual([
      { name: 'main', ran: true, stopReason: 'completed', neverRan: false },
    ]);
    expect(attestation.budget).toEqual({
      allocatedTokens: 100_000,
      spentTokens: 12_000,
      starved: false,
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
});

describe('emptyAttestation', () => {
  it('builds a "delivered" v1 attestation for the zero-files early-exit path', () => {
    const attestation = emptyAttestation('success', 0, 'zero_files_early_exit');
    expect(attestation.verdict).toBe('delivered');
    expect(attestation.scope).toEqual({
      eligibilityPath: 'zero_files_early_exit',
      filesAnalyzed: 0,
    });
    expect(attestation.provider.passes).toEqual([]);
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
    });
  });
});

describe('computeVerdict', () => {
  it('pipelineFailed takes precedence over everything else', () => {
    const verdict = computeVerdict({
      pipelineFailed: true,
      providerFailure: true,
      mainPass: { name: 'main', ran: true, stopReason: 'budget', neverRan: false },
      budget: { allocatedTokens: 1, spentTokens: 1, starved: true },
      inlineComments: { attempted: 1, posted: 0, dropped: 1, deduped: 0 },
    });
    expect(verdict).toBe('failed:analysis_error');
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
