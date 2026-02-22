import { describe, it, expect } from 'vitest';
import { ComplexityPlugin } from '../src/plugins/complexity.js';
import {
  createTestContext,
  createTestReport,
  createTestChunk,
  createMockLLMClient,
} from '../src/test-helpers.js';

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

  it('produces findings for each violation (no LLM)', async () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
      { filepath: 'b.ts', symbolName: 'fnB', complexity: 25, threshold: 15, severity: 'error' },
    ]);

    const context = createTestContext({
      complexityReport: report,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(2);
    expect(findings[0].pluginId).toBe('complexity');
    // Prioritized: errors first
    const severities = findings.map(f => f.severity).sort();
    expect(severities).toEqual(['error', 'warning']);
  });

  it('uses LLM suggestions when available', async () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
    ]);

    const llm = createMockLLMClient([
      JSON.stringify({ 'a.ts::fnA': 'Extract helper function to reduce complexity.' }),
    ]);

    const chunks = [
      createTestChunk({
        content: 'function fnA() { /* complex */ }',
        metadata: {
          file: 'a.ts',
          startLine: 1,
          endLine: 10,
          type: 'function',
          symbolName: 'fnA',
          language: 'typescript',
        },
      }),
    ];

    const context = createTestContext({
      complexityReport: report,
      chunks,
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('Extract helper function to reduce complexity.');
    expect(llm.calls).toHaveLength(1);
  });

  it('falls back to default message when LLM fails', async () => {
    const report = createTestReport([
      { filepath: 'a.ts', symbolName: 'fnA', complexity: 20, threshold: 15 },
    ]);

    const llm = createMockLLMClient(['not valid json at all']);

    const context = createTestContext({
      complexityReport: report,
      chunks: [
        createTestChunk({
          metadata: {
            file: 'a.ts',
            startLine: 1,
            endLine: 10,
            type: 'function',
            symbolName: 'fnA',
            language: 'typescript',
          },
        }),
      ],
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(1);
    // Should have a fallback message, not the LLM response
    expect(findings[0].message).toContain('test paths');
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

    const context = createTestContext({ complexityReport: report });
    const findings = await plugin.analyze(context);

    expect(findings[0].metadata).toEqual({
      pluginType: 'complexity',
      metricType: 'cognitive',
      complexity: 20,
      threshold: 15,
      delta: null,
      symbolType: 'function',
    });
  });
});
