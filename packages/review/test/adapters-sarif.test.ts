import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SARIFAdapter } from '../src/adapters/sarif.js';
import type { AdapterContext, ReviewFinding } from '../src/plugin-types.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'complexity',
    filepath: 'src/foo.ts',
    line: 10,
    severity: 'warning',
    category: 'cyclomatic',
    message: 'Function too complex',
    ...overrides,
  };
}

function makeAdapterContext(): AdapterContext {
  return {
    complexityReport: createTestReport(),
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
  };
}

interface SARIFOutput {
  $schema: string;
  version: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        rules: Array<{
          id: string;
          shortDescription: { text: string };
          defaultConfiguration: { level: string };
        }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: string;
      message: { text: string };
      locations: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region: { startLine: number; endLine?: number };
        };
      }>;
      fixes?: Array<{ description: { text: string } }>;
    }>;
  }>;
}

describe('SARIFAdapter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let captured: string;

  beforeEach(() => {
    captured = '';
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured += args.map(String).join(' ');
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function parseSARIF(): SARIFOutput {
    return JSON.parse(captured) as SARIFOutput;
  }

  it('produces valid SARIF 2.1.0 structure', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding()], makeAdapterContext());
    const sarif = parseSARIF();

    expect(sarif.$schema).toContain('sarif-schema-2.1.0');
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('lien-review');
    expect(sarif.runs[0].tool.driver.informationUri).toBe('https://lien.dev');
  });

  it('maps error severity to "error"', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ severity: 'error' })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].level).toBe('error');
  });

  it('maps warning severity to "warning"', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ severity: 'warning' })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].level).toBe('warning');
  });

  it('maps info severity to "note"', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ severity: 'info' })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].level).toBe('note');
  });

  it('creates unique rules for each pluginId/category pair', async () => {
    const adapter = new SARIFAdapter();
    const findings = [
      makeFinding({ pluginId: 'complexity', category: 'cyclomatic' }),
      makeFinding({ pluginId: 'complexity', category: 'cognitive', filepath: 'b.ts' }),
      makeFinding({ pluginId: 'logic', category: 'breaking_change', filepath: 'c.ts' }),
      // Duplicate rule — should not create another
      makeFinding({ pluginId: 'complexity', category: 'cyclomatic', filepath: 'd.ts' }),
    ];
    await adapter.present(findings, makeAdapterContext());
    const sarif = parseSARIF();

    expect(sarif.runs[0].tool.driver.rules).toHaveLength(3);
    const ruleIds = sarif.runs[0].tool.driver.rules.map(r => r.id);
    expect(ruleIds).toContain('complexity/cyclomatic');
    expect(ruleIds).toContain('complexity/cognitive');
    expect(ruleIds).toContain('logic/breaking_change');
  });

  it('sets artifact URI from filepath', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ filepath: 'src/utils/helper.ts' })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'src/utils/helper.ts',
    );
  });

  it('sets startLine from finding line', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ line: 42 })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(42);
  });

  it('includes endLine when present on finding', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ endLine: 55 })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.endLine).toBe(55);
  });

  it('includes fix when suggestion is present', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding({ suggestion: 'Reduce nesting' })], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].fixes).toHaveLength(1);
    expect(sarif.runs[0].results[0].fixes![0].description.text).toBe('Reduce nesting');
  });

  it('omits fixes when no suggestion', async () => {
    const adapter = new SARIFAdapter();
    await adapter.present([makeFinding()], makeAdapterContext());
    const sarif = parseSARIF();
    expect(sarif.runs[0].results[0].fixes).toBeUndefined();
  });

  it('returns correct posted/skipped/filtered counts', async () => {
    const adapter = new SARIFAdapter();
    const findings = [makeFinding(), makeFinding({ filepath: 'b.ts' })];
    const result = await adapter.present(findings, makeAdapterContext());
    expect(result).toEqual({ posted: 2, skipped: 0, filtered: 0 });
  });

  it('returns zeroed counts for empty findings', async () => {
    const adapter = new SARIFAdapter();
    const result = await adapter.present([], makeAdapterContext());
    expect(result).toEqual({ posted: 0, skipped: 0, filtered: 0 });
  });
});
