import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { emptyAttestation, type ReviewFinding, type ReviewCoreResult } from '@liendev/review';

import { countErrors, writeStepSummary, writeOutputs } from '../src/summary.js';

describe('countErrors', () => {
  it('counts only error-severity findings', () => {
    const findings = [
      { severity: 'error' } as ReviewFinding,
      { severity: 'warning' } as ReviewFinding,
      { severity: 'error' } as ReviewFinding,
    ];
    expect(countErrors(findings)).toBe(2);
  });
});

function makeResult(overrides?: Partial<ReviewCoreResult>): ReviewCoreResult {
  return {
    findings: [],
    conclusion: 'success',
    summaryMarkdown: 'All good.',
    filesAnalyzed: 3,
    usage: { totalTokens: 0, cost: 0 },
    providerFailure: false,
    attestation: emptyAttestation('success', 3, 'normal'),
    ...overrides,
  };
}

describe('attestation rendering', () => {
  let summaryPath: string;
  let outputPath: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lien-summary-test-'));
    summaryPath = join(dir, 'summary.md');
    outputPath = join(dir, 'output.txt');
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_OUTPUT = outputPath;
  });

  afterEach(() => {
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_OUTPUT;
  });

  it('writeStepSummary appends a collapsed <details> block with the full attestation JSON', async () => {
    const result = makeResult({
      attestation: emptyAttestation('failure', 0, 'zero_files_early_exit'),
    });

    await writeStepSummary(result);

    const summary = await readFile(summaryPath, 'utf8');
    expect(summary).toContain('<details>');
    expect(summary).toContain('<summary>Delivery attestation</summary>');
    expect(summary).toContain('</details>');
    expect(summary).toContain('"eligibilityPath": "zero_files_early_exit"');
  });

  it('writeOutputs writes the attestation as a JSON-string output', async () => {
    const attestation = emptyAttestation('success', 3, 'normal');

    await writeOutputs({
      conclusion: 'success',
      findingsCount: 0,
      errorCount: 0,
      attestation,
    });

    const output = await readFile(outputPath, 'utf8');
    expect(output).toContain('attestation<<');
    expect(output).toContain(JSON.stringify(attestation));
  });
});
