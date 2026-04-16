import { describe, it, expect } from 'vitest';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';
import { createTestContext } from '../src/test-helpers.js';
import type { BlastRadiusReport } from '../src/blast-radius.js';

function sampleReport(): BlastRadiusReport {
  return {
    entries: [
      {
        seed: {
          filepath: 'src/auth/validate.ts',
          symbolName: 'validateToken',
          symbolType: 'function',
          complexity: 8,
        },
        dependents: [
          {
            filepath: 'src/middleware/auth.ts',
            symbolName: 'requireAuth',
            hops: 1,
            callSiteLine: 42,
            complexity: 6,
            hasTestCoverage: true,
          },
          {
            filepath: 'src/routes/oauth.ts',
            symbolName: 'oauthHandler',
            hops: 2,
            callSiteLine: 18,
            complexity: 18,
            hasTestCoverage: false,
          },
        ],
        risk: { level: 'medium', reasoning: ['2 callers', '1 untested'] },
        truncated: false,
      },
    ],
    totalDistinctDependents: 2,
    globalRisk: { level: 'medium', reasoning: ['2 callers', '1 untested'] },
    truncated: false,
  };
}

describe('buildInitialMessage with blast-radius injection', () => {
  it('includes a <blast_radius> block when a report is provided', () => {
    const context = createTestContext({ changedFiles: ['src/auth/validate.ts'] });
    const message = buildInitialMessage(context, { blastRadius: sampleReport() });

    expect(message).toContain('<blast_radius>');
    expect(message).toContain('</blast_radius>');
    expect(message).toContain('Global risk: MEDIUM');
    expect(message).toContain('src/middleware/auth.ts:requireAuth');
    expect(message).toContain('src/routes/oauth.ts:oauthHandler');
  });

  it('omits the <blast_radius> block when no report is provided', () => {
    const context = createTestContext({ changedFiles: ['src/auth/validate.ts'] });
    const noOpts = buildInitialMessage(context);
    const nullReport = buildInitialMessage(context, { blastRadius: null });

    expect(noOpts).not.toContain('<blast_radius>');
    expect(nullReport).not.toContain('<blast_radius>');
  });

  it('omits the <blast_radius> block when the report has no entries', () => {
    const context = createTestContext({ changedFiles: ['src/auth/validate.ts'] });
    const message = buildInitialMessage(context, {
      blastRadius: {
        entries: [],
        totalDistinctDependents: 0,
        globalRisk: { level: 'low', reasoning: [] },
        truncated: false,
      },
    });

    expect(message).not.toContain('<blast_radius>');
  });

  it('places <blast_radius> after <changed_files> and before <deleted_exports>', () => {
    const context = createTestContext({
      changedFiles: ['src/auth/validate.ts'],
      pr: {
        title: 'Refactor auth',
        body: '',
        number: 1,
        baseSha: 'base',
        headSha: 'head',
        patches: new Map([['src/auth/validate.ts', '-export { something } from "./x";']]),
      } as unknown as ReturnType<typeof createTestContext>['pr'],
    });
    const message = buildInitialMessage(context, { blastRadius: sampleReport() });

    const changedFilesIdx = message.indexOf('<changed_files>');
    const blastIdx = message.indexOf('<blast_radius>');
    const deletedIdx = message.indexOf('<deleted_exports>');

    expect(changedFilesIdx).toBeGreaterThan(-1);
    expect(blastIdx).toBeGreaterThan(changedFilesIdx);
    if (deletedIdx > -1) {
      expect(blastIdx).toBeLessThan(deletedIdx);
    }
  });
});
