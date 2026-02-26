import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalAdapter } from '../src/adapters/terminal.js';
import type { AdapterContext, ReviewFinding } from '../src/plugin-types.js';
import { createTestReport, silentLogger } from '../src/test-helpers.js';

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    pluginId: 'test',
    filepath: 'src/foo.ts',
    line: 10,
    severity: 'warning',
    category: 'complexity',
    message: 'Too complex',
    ...overrides,
  };
}

function makeAdapterContext(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    complexityReport: createTestReport(),
    baselineReport: null,
    deltas: null,
    deltaSummary: null,
    logger: silentLogger,
    ...overrides,
  };
}

describe('TerminalAdapter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let output: string[];

  beforeEach(() => {
    output = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns zeroed result for empty findings', async () => {
    const adapter = new TerminalAdapter();
    const result = await adapter.present([], makeAdapterContext());
    expect(result).toEqual({ posted: 0, skipped: 0, filtered: 0 });
  });

  it('prints "No review findings." for empty findings', async () => {
    const adapter = new TerminalAdapter();
    await adapter.present([], makeAdapterContext());
    expect(output.some(line => line.includes('No review findings.'))).toBe(true);
  });

  it('returns posted count matching findings length', async () => {
    const adapter = new TerminalAdapter();
    const findings = [makeFinding(), makeFinding({ filepath: 'src/bar.ts' })];
    const result = await adapter.present(findings, makeAdapterContext());
    expect(result).toEqual({ posted: 2, skipped: 0, filtered: 0 });
  });

  it('groups findings by filepath', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const findings = [
      makeFinding({ filepath: 'src/a.ts', message: 'Issue A' }),
      makeFinding({ filepath: 'src/b.ts', message: 'Issue B' }),
      makeFinding({ filepath: 'src/a.ts', message: 'Issue A2', severity: 'error' }),
    ];
    await adapter.present(findings, makeAdapterContext());

    // Both filepaths should appear as headers
    expect(output.some(line => line.includes('src/a.ts'))).toBe(true);
    expect(output.some(line => line.includes('src/b.ts'))).toBe(true);
  });

  it('sorts findings by severity: error before warning before info', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const findings = [
      makeFinding({ severity: 'info', message: 'Info msg', filepath: 'a.ts' }),
      makeFinding({ severity: 'error', message: 'Error msg', filepath: 'a.ts' }),
      makeFinding({ severity: 'warning', message: 'Warn msg', filepath: 'a.ts' }),
    ];
    await adapter.present(findings, makeAdapterContext());

    const messageLines = output.filter(line => line.includes('msg'));
    const errorIdx = messageLines.findIndex(l => l.includes('Error msg'));
    const warnIdx = messageLines.findIndex(l => l.includes('Warn msg'));
    const infoIdx = messageLines.findIndex(l => l.includes('Info msg'));
    expect(errorIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it('displays severity labels (ERROR, WARN, INFO)', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const findings = [
      makeFinding({ severity: 'error' }),
      makeFinding({ severity: 'warning', filepath: 'b.ts' }),
      makeFinding({ severity: 'info', filepath: 'c.ts' }),
    ];
    await adapter.present(findings, makeAdapterContext());

    const joined = output.join('\n');
    expect(joined).toContain('ERROR');
    expect(joined).toContain('WARN');
    expect(joined).toContain('INFO');
  });

  it('includes line reference when line > 0', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present([makeFinding({ line: 42 })], makeAdapterContext());
    expect(output.some(line => line.includes(':42'))).toBe(true);
  });

  it('omits line reference when line is 0', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present([makeFinding({ line: 0 })], makeAdapterContext());
    // Should not have :0 reference
    expect(output.some(line => line.includes(':0'))).toBe(false);
  });

  it('includes symbol name when present', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present([makeFinding({ symbolName: 'myFunc' })], makeAdapterContext());
    expect(output.some(line => line.includes('(myFunc)'))).toBe(true);
  });

  it('prints suggestion when present', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present(
      [makeFinding({ suggestion: 'Extract into helper' })],
      makeAdapterContext(),
    );
    expect(output.some(line => line.includes('Suggestion: Extract into helper'))).toBe(true);
  });

  it('prints evidence when present', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present(
      [makeFinding({ evidence: 'Cyclomatic complexity 25' })],
      makeAdapterContext(),
    );
    expect(output.some(line => line.includes('Cyclomatic complexity 25'))).toBe(true);
  });

  it('prints LLM usage when totalTokens > 0', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const ctx = makeAdapterContext({
      llmUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.0025 },
      model: 'test-model',
    });
    await adapter.present([makeFinding()], ctx);
    const joined = output.join('\n');
    expect(joined).toContain('LLM:');
    expect(joined).toContain('150');
    expect(joined).toContain('$0.0025');
    expect(joined).toContain('test-model');
  });

  it('omits LLM usage when totalTokens is 0', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const ctx = makeAdapterContext({
      llmUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
    });
    await adapter.present([makeFinding()], ctx);
    expect(output.every(line => !line.includes('LLM:'))).toBe(true);
  });

  it('strips ANSI codes when color is disabled', async () => {
    const adapter = new TerminalAdapter({ color: false });
    await adapter.present([makeFinding()], makeAdapterContext());
    const joined = output.join('\n');
    // ANSI escape codes start with \x1b[
    expect(joined).not.toContain('\x1b[');
  });

  it('includes ANSI codes when color is enabled', async () => {
    const adapter = new TerminalAdapter({ color: true });
    await adapter.present([makeFinding()], makeAdapterContext());
    const joined = output.join('\n');
    expect(joined).toContain('\x1b[');
  });

  it('prints summary with correct counts', async () => {
    const adapter = new TerminalAdapter({ color: false });
    const findings = [
      makeFinding({ severity: 'error' }),
      makeFinding({ severity: 'warning', filepath: 'b.ts' }),
      makeFinding({ severity: 'warning', filepath: 'c.ts' }),
      makeFinding({ severity: 'info', filepath: 'd.ts' }),
    ];
    await adapter.present(findings, makeAdapterContext());
    const joined = output.join('\n');
    expect(joined).toContain('4 findings');
    expect(joined).toContain('1 error');
    expect(joined).toContain('2 warnings');
    expect(joined).toContain('1 info');
  });
});
