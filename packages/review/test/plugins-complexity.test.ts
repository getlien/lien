import { describe, it, expect, vi } from 'vitest';
import { ComplexityPlugin } from '../src/plugins/complexity.js';
import { createTestContext, createTestReport } from '../src/test-helpers.js';
import type { PresentContext } from '../src/plugin-types.js';

describe('ComplexityPlugin', () => {
  const plugin = new ComplexityPlugin();

  it('has correct metadata', () => {
    expect(plugin.id).toBe('complexity');
    expect(plugin.requiresLLM).toBe(false);
  });

  it('does not activate when no violations', () => {
    const context = createTestContext({
      complexityReport: createTestReport([]),
    });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('activates when violations exist', () => {
    const context = createTestContext({
      complexityReport: createTestReport([{ complexity: 20, threshold: 15 }]),
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('produces findings for each violation', async () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
      { filepath: 'b.ts', symbolName: 'fnB', complexity: 25, threshold: 15, severity: 'error' },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings).toHaveLength(2);
    expect(findings[0].pluginId).toBe('complexity');
    const severities = findings.map(f => f.severity).sort();
    expect(severities).toEqual(['error', 'warning']);
  });

  it('uses per-metric messages for cyclomatic violations', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cyclomatic',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings[0].message).toContain('branches');
    expect(findings[0].message).toContain('20 tests');
  });

  it('uses per-metric messages for cognitive violations', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cognitive',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings[0].message).toContain('cognitive complexity 20');
    expect(findings[0].message).toContain('early returns');
  });

  it('uses per-metric messages for halstead_effort violations', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 5000,
        threshold: 1000,
        metricType: 'halstead_effort',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings[0].message).toContain('to understand');
    expect(findings[0].message).toContain('readability');
  });

  it('uses per-metric messages for halstead_bugs violations', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 0.8,
        threshold: 0.35,
        metricType: 'halstead_bugs',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings[0].message).toContain('bug density');
    expect(findings[0].message).toContain('error likelihood');
  });

  it('includes metadata on findings', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cognitive',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings[0].metadata).toEqual({
      pluginType: 'complexity',
      metricType: 'cognitive',
      complexity: 20,
      threshold: 15,
      delta: null,
      symbolType: 'function',
    });
  });

  it('present() adds annotations for complexity findings', async () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15, severity: 'warning' },
      { filepath: 'b.ts', symbolName: 'fnB', complexity: 30, threshold: 15, severity: 'error' },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));

    const addAnnotations = vi.fn();
    const ctx = { addAnnotations, appendSummary: vi.fn() } as unknown as PresentContext;
    await plugin.present(findings, ctx);

    expect(addAnnotations).toHaveBeenCalledTimes(1);
    const annotations = addAnnotations.mock.calls[0][0];
    expect(annotations).toHaveLength(2);

    const warning = annotations.find(
      (a: { annotation_level: string }) => a.annotation_level === 'warning',
    );
    const failure = annotations.find(
      (a: { annotation_level: string }) => a.annotation_level === 'failure',
    );
    expect(warning).toBeDefined();
    expect(failure).toBeDefined();
    expect(warning.path).toBe('a.ts');
    expect(failure.path).toBe('b.ts');
    expect(warning.title).toContain('fnA');
    expect(failure.title).toContain('fnB');
  });

  it('present() emits one annotation per function, keeping the worst metric', async () => {
    // fnA has two metrics: cyclomatic (warning) and halstead_effort (error) — keep error
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cyclomatic',
        severity: 'warning',
      },
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 5000,
        threshold: 1000,
        metricType: 'halstead_effort',
        severity: 'error',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    expect(findings).toHaveLength(2);

    const addAnnotations = vi.fn();
    const ctx = { addAnnotations, appendSummary: vi.fn() } as unknown as PresentContext;
    await plugin.present(findings, ctx);

    const annotations = addAnnotations.mock.calls[0][0];
    expect(annotations).toHaveLength(1);
    expect(annotations[0].annotation_level).toBe('failure');
    expect(annotations[0].title).toContain('fnA');
  });

  it('present() breaks severity ties by overage ratio', async () => {
    // fnA has two warnings: cyclomatic 20/15 (ratio 1.33) and cognitive 30/15 (ratio 2.0) — keep cognitive
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cyclomatic',
        severity: 'warning',
      },
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 30,
        threshold: 15,
        metricType: 'cognitive',
        severity: 'warning',
      },
    ]);

    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    const addAnnotations = vi.fn();
    const ctx = { addAnnotations, appendSummary: vi.fn() } as unknown as PresentContext;
    await plugin.present(findings, ctx);

    const annotations = addAnnotations.mock.calls[0][0];
    expect(annotations).toHaveLength(1);
    expect(annotations[0].message).toContain('cognitive complexity 30');
  });

  it('present() sets check run summary with violations table', async () => {
    const report = createTestReport([
      {
        filepath: 'a.ts',
        symbolName: 'fnA',
        complexity: 20,
        threshold: 15,
        metricType: 'cyclomatic',
        severity: 'warning',
      },
    ]);
    const findings = await plugin.analyze(createTestContext({ complexityReport: report }));
    const appendSummary = vi.fn();
    await plugin.present(findings, {
      addAnnotations: vi.fn(),
      appendSummary,
    } as unknown as PresentContext);

    expect(appendSummary).toHaveBeenCalledTimes(1);
    const summary: string = appendSummary.mock.calls[0][0];
    expect(summary).toContain('fnA');
    expect(summary).toContain('a.ts');
    expect(summary).toContain('1 violation');
  });

  it('present() sets success summary when no complexity findings', async () => {
    const appendSummary = vi.fn();
    const ctx = { addAnnotations: vi.fn(), appendSummary } as unknown as PresentContext;
    await plugin.present([], ctx);
    expect(appendSummary).toHaveBeenCalledWith(expect.stringContaining('No complexity violations'));
  });

  it('present() does not add annotations when given no findings', async () => {
    const addAnnotations = vi.fn();
    const ctx = { addAnnotations, appendSummary: vi.fn() } as unknown as PresentContext;
    await plugin.present([], ctx);
    expect(addAnnotations).not.toHaveBeenCalled();
  });
});
