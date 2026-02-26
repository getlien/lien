import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchitecturalPlugin } from '../src/plugins/architectural.js';
import {
  createTestContext,
  createTestReport,
  createTestChunk,
  createMockLLMClient,
  silentLogger,
} from '../src/test-helpers.js';
import type { ReviewContext } from '../src/plugin-types.js';

function makeArchLLMResponse(notes: Array<Record<string, string>>): string {
  return JSON.stringify({ architectural_notes: notes });
}

function makeValidNote(overrides?: Partial<Record<string, string>>): Record<string, string> {
  return {
    scope: 'src/foo.ts',
    observation: 'DRY violation detected',
    evidence: 'Duplicate logic in files A and B',
    suggestion: 'Extract shared utility',
    ...overrides,
  };
}

describe('ArchitecturalPlugin', () => {
  const plugin = new ArchitecturalPlugin();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  it('has correct metadata', () => {
    expect(plugin.id).toBe('architectural');
    expect(plugin.name).toBe('Architectural Review');
    expect(plugin.requiresLLM).toBe(true);
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.defaultConfig).toEqual({ mode: 'auto' });
  });

  // ---------------------------------------------------------------------------
  // shouldActivate
  // ---------------------------------------------------------------------------

  it('returns false when mode is "off"', () => {
    const context = createTestContext({
      config: { mode: 'off' },
      changedFiles: ['a.ts', 'b.ts', 'c.ts'],
    });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('returns true when mode is "always"', () => {
    const context = createTestContext({
      config: { mode: 'always' },
      changedFiles: [],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('returns true in auto mode with >= 3 changed files', () => {
    const context = createTestContext({
      config: { mode: 'auto' },
      changedFiles: ['a.ts', 'b.ts', 'c.ts'],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('returns false in auto mode with < 3 files, no risk, no export changes', () => {
    const context = createTestContext({
      config: { mode: 'auto' },
      changedFiles: ['a.ts'],
      complexityReport: createTestReport(),
    });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('returns true in auto mode with high-risk files', () => {
    const report = createTestReport([
      { filepath: 'risky.ts', complexity: 50, threshold: 15, severity: 'error' },
    ]);
    // Set riskLevel to high
    report.files['risky.ts'].riskLevel = 'high';

    const context = createTestContext({
      config: { mode: 'auto' },
      changedFiles: ['risky.ts'],
      complexityReport: report,
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('defaults to auto mode when config.mode is undefined', () => {
    const context = createTestContext({
      config: {},
      changedFiles: ['a.ts', 'b.ts', 'c.ts'],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // analyze
  // ---------------------------------------------------------------------------

  it('returns empty when no LLM available', async () => {
    const context = createTestContext({
      chunks: [createTestChunk()],
      changedFiles: ['test.ts'],
    });
    // No llm
    const result = await plugin.analyze(context);
    expect(result).toHaveLength(0);
  });

  it('sends prompt to LLM with code context', async () => {
    const llm = createMockLLMClient([makeArchLLMResponse([])]);
    const chunk = createTestChunk({
      content: 'function foo() { return 1; }',
      metadata: { file: 'src/foo.ts', symbolName: 'foo', type: 'function' },
    });
    const context = createTestContext({
      chunks: [chunk],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    await plugin.analyze(context);

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toContain('src/foo.ts');
    expect(llm.calls[0].prompt).toContain('function foo()');
  });

  it('parses architectural notes from LLM response', async () => {
    const notes = [makeValidNote()];
    const llm = createMockLLMClient([makeArchLLMResponse(notes)]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('DRY violation detected');
  });

  it('maps notes to ReviewFinding with correct metadata', async () => {
    const notes = [makeValidNote({ scope: 'src/foo.ts::myFunc' })];
    const llm = createMockLLMClient([makeArchLLMResponse(notes)]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result[0]).toMatchObject({
      pluginId: 'architectural',
      filepath: 'src/foo.ts',
      line: 0,
      severity: 'info',
      category: 'architectural',
      message: 'DRY violation detected',
      suggestion: 'Extract shared utility',
      evidence: 'Duplicate logic in files A and B',
    });
    expect(result[0].metadata).toEqual({
      pluginType: 'architectural',
      scope: 'src/foo.ts::myFunc',
    });
  });

  it('limits findings based on changed file count', async () => {
    // maxNotes for 1 file = min(3 + floor(1/10), 5) = 3
    const notes = Array.from({ length: 10 }, (_, i) =>
      makeValidNote({ scope: `file${i}.ts`, observation: `Note ${i}` }),
    );
    const llm = createMockLLMClient([makeArchLLMResponse(notes)]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('skips method and unnamed block chunks in context assembly', async () => {
    const llm = createMockLLMClient([makeArchLLMResponse([])]);
    const methodChunk = createTestChunk({
      content: 'method code',
      metadata: { file: 'src/foo.ts', symbolType: 'method', symbolName: 'bar' },
    });
    const blockChunk = createTestChunk({
      content: 'block code',
      metadata: { file: 'src/foo.ts', type: 'block', symbolName: '' },
    });
    const funcChunk = createTestChunk({
      content: 'function included() {}',
      metadata: { file: 'src/foo.ts', type: 'function', symbolName: 'included' },
    });

    const context = createTestContext({
      chunks: [methodChunk, blockChunk, funcChunk],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    await plugin.analyze(context);

    // Only the function chunk should be in the prompt
    expect(llm.calls[0].prompt).toContain('function included()');
    expect(llm.calls[0].prompt).not.toContain('method code');
    expect(llm.calls[0].prompt).not.toContain('block code');
  });

  it('sorts files by dependentCount descending', async () => {
    const report = createTestReport();
    report.files['low.ts'] = {
      violations: [],
      riskLevel: 'low',
      dependentCount: 1,
      dependents: [],
      testAssociations: [],
    };
    report.files['high.ts'] = {
      violations: [],
      riskLevel: 'low',
      dependentCount: 10,
      dependents: [],
      testAssociations: [],
    };

    const llm = createMockLLMClient([makeArchLLMResponse([])]);
    const lowChunk = createTestChunk({
      content: 'function low() {}',
      metadata: { file: 'low.ts', type: 'function', symbolName: 'low' },
    });
    const highChunk = createTestChunk({
      content: 'function high() {}',
      metadata: { file: 'high.ts', type: 'function', symbolName: 'high' },
    });

    const context = createTestContext({
      chunks: [lowChunk, highChunk],
      changedFiles: ['low.ts', 'high.ts'],
      complexityReport: report,
      llm,
    });

    await plugin.analyze(context);

    const prompt = llm.calls[0].prompt;
    const highIdx = prompt.indexOf('high.ts');
    const lowIdx = prompt.indexOf('low.ts');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('returns empty when LLM response is completely unparseable', async () => {
    const llm = createMockLLMClient(['This is not JSON at all, just text.']);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result).toHaveLength(0);
  });

  it('recovers notes with aggressive retry parsing', async () => {
    // Response has JSON embedded in text
    const notes = [makeValidNote()];
    const content = `Here is my analysis:\n${JSON.stringify({ architectural_notes: notes })}\nDone.`;
    const llm = createMockLLMClient([content]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result).toHaveLength(1);
  });

  it('includes PR title in prompt when available', async () => {
    const llm = createMockLLMClient([makeArchLLMResponse([])]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
      pr: {
        owner: 'test',
        repo: 'test',
        pullNumber: 1,
        title: 'feat: add caching layer',
        baseSha: 'abc',
        headSha: 'def',
      },
    });

    await plugin.analyze(context);
    expect(llm.calls[0].prompt).toContain('feat: add caching layer');
  });

  it('filters invalid notes missing required fields', async () => {
    const notes = [
      makeValidNote(), // valid
      { scope: 'a.ts' }, // missing observation, evidence, suggestion
      { observation: 'test' }, // missing scope, evidence, suggestion
    ];
    const llm = createMockLLMClient([makeArchLLMResponse(notes)]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('DRY violation detected');
  });

  it('extracts filepath from scope with :: separator', async () => {
    const notes = [makeValidNote({ scope: 'src/utils.ts::helperFn' })];
    const llm = createMockLLMClient([makeArchLLMResponse(notes)]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/utils.ts' } })],
      changedFiles: ['src/utils.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result[0].filepath).toBe('src/utils.ts');
  });

  it('parses response wrapped in code block', async () => {
    const notes = [makeValidNote()];
    const content = '```json\n' + JSON.stringify({ architectural_notes: notes }) + '\n```';
    const llm = createMockLLMClient([content]);
    const context = createTestContext({
      chunks: [createTestChunk({ metadata: { file: 'src/foo.ts' } })],
      changedFiles: ['src/foo.ts'],
      llm,
    });

    const result = await plugin.analyze(context);
    expect(result).toHaveLength(1);
  });
});
