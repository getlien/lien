import { describe, it, expect } from 'vitest';

import {
  INFERRED_DEPENDENT_MECHANISMS,
  INFERRED_DEPENDENT_MECHANISM_IDS,
  summarizeInferredDependentMechanisms,
  describeInferredDependentRecovery,
  type InferredDependentMechanism,
} from './inferred-dependent-mechanisms.js';

describe('INFERRED_DEPENDENT_MECHANISMS (#1018)', () => {
  it('describes every mechanism id with non-empty prose', () => {
    // The `Record<InferredDependentMechanism, ...>` type already makes a
    // MISSING key a compile error. This catches the other failure mode a type
    // can't see: a key present but its prose left blank or a placeholder.
    for (const id of INFERRED_DEPENDENT_MECHANISM_IDS) {
      const d = INFERRED_DEPENDENT_MECHANISMS[id];
      expect(d.languageLabel.length, `${id} languageLabel`).toBeGreaterThan(0);
      expect(d.importGraphBlindSpot.length, `${id} importGraphBlindSpot`).toBeGreaterThan(20);
      expect(d.recovery.length, `${id} recovery`).toBeGreaterThan(20);
      expect(d.residualRisk.length, `${id} residualRisk`).toBeGreaterThan(20);
    }
  });

  it('derives its id list from the table rather than a hand-written copy', () => {
    expect(INFERRED_DEPENDENT_MECHANISM_IDS.sort()).toEqual(
      Object.keys(INFERRED_DEPENDENT_MECHANISMS).sort(),
    );
  });

  it('gives each mechanism a distinct language label and a distinct mechanism sentence', () => {
    // Two mechanisms describing themselves identically would defeat the whole
    // point — a consumer could not tell from the note which one ran.
    const labels = INFERRED_DEPENDENT_MECHANISM_IDS.map(
      id => INFERRED_DEPENDENT_MECHANISMS[id].languageLabel,
    );
    const recoveries = INFERRED_DEPENDENT_MECHANISM_IDS.map(
      id => INFERRED_DEPENDENT_MECHANISMS[id].recovery,
    );
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(recoveries).size).toBe(recoveries.length);
  });

  it("never describes Go's mechanism in C#'s terms, or vice versa", () => {
    // The exact defect this module exists to prevent: #1039's Go fallback
    // inherited #930's C#-specific prose at five surfaces at once.
    const csharp = INFERRED_DEPENDENT_MECHANISMS['csharp-type-reference'];
    const go = INFERRED_DEPENDENT_MECHANISMS['go-root-package-export'];

    expect(csharp.languageLabel).toBe('C#');
    expect(csharp.importGraphBlindSpot).toContain('global using');
    expect(csharp.recovery).toContain('type name');

    expect(go.languageLabel).toBe('Go');
    expect(go.importGraphBlindSpot).not.toContain('global using');
    expect(go.importGraphBlindSpot).toContain('import path');
    expect(go.recovery).toContain('exports');
    // Go's recovery is an import-anchored export lookup, NOT a source-text scan.
    expect(go.recovery).not.toContain('source text');
  });
});

describe('summarizeInferredDependentMechanisms', () => {
  it('enumerates the languages that have a fallback, joined for prose', () => {
    // Interpolated into the tool description, the server instructions, the
    // caveat-reason text and the docs page — so this is what an agent reads.
    expect(summarizeInferredDependentMechanisms()).toBe('C#, Go and Java/Kotlin');
  });

  it('stays in sync with the table by construction', () => {
    for (const id of INFERRED_DEPENDENT_MECHANISM_IDS) {
      expect(summarizeInferredDependentMechanisms()).toContain(
        INFERRED_DEPENDENT_MECHANISMS[id].languageLabel,
      );
    }
  });
});

describe('describeInferredDependentRecovery', () => {
  it('describes a single mechanism verbatim from the table', () => {
    const out = describeInferredDependentRecovery(['go-root-package-export']);
    const expected = INFERRED_DEPENDENT_MECHANISMS['go-root-package-export'];
    expect(out.languageLabel).toBe('Go');
    expect(out.importGraphBlindSpot).toBe(expected.importGraphBlindSpot);
    expect(out.recovery).toBe(expected.recovery);
    expect(out.residualRisk).toBe(expected.residualRisk);
  });

  it('never leaks the other mechanism into a single-mechanism description', () => {
    const go = describeInferredDependentRecovery(['go-root-package-export']);
    expect(go.languageLabel).not.toContain('C#');
    expect(go.recovery).not.toContain('source text');

    const csharp = describeInferredDependentRecovery(['csharp-type-reference']);
    expect(csharp.languageLabel).not.toContain('Go');
  });

  it('joins multiple mechanisms without duplicating a shared clause', () => {
    const out = describeInferredDependentRecovery([
      'csharp-type-reference',
      'go-root-package-export',
    ]);
    expect(out.languageLabel).toBe('C# and Go');
    expect(out.recovery).toContain('type name');
    expect(out.recovery).toContain('exports');
  });

  it('deduplicates a repeated mechanism (one clause per distinct mechanism)', () => {
    // Callers pass one entry per recovered dependent, so the same mechanism
    // arrives many times over — the prose must not repeat once per edge.
    const repeated: InferredDependentMechanism[] = Array.from(
      { length: 11 },
      () => 'go-root-package-export',
    );
    expect(describeInferredDependentRecovery(repeated)).toEqual(
      describeInferredDependentRecovery(['go-root-package-export']),
    );
  });

  it('returns empty clauses rather than throwing on an empty list', () => {
    // Defensive: a caller that finds no `inferredVia` should degrade to a
    // vaguer sentence, never crash the whole `get_dependents` response.
    expect(describeInferredDependentRecovery([])).toEqual({
      languageLabel: '',
      importGraphBlindSpot: '',
      recovery: '',
      residualRisk: '',
    });
  });
});
