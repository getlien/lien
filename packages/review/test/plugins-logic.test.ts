import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LogicFinding } from '../src/types.js';
import {
  createTestContext,
  createTestReport,
  createTestChunk,
  createMockLLMClient,
  silentLogger,
} from '../src/test-helpers.js';

// Mock dependencies before importing the plugin
vi.mock('../src/logic-review.js', () => ({
  detectLogicFindings: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/suppression.js', () => ({
  isFindingSuppressed: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/logic-prompt.js', () => ({
  buildLogicReviewPrompt: vi.fn().mockReturnValue('mock prompt'),
}));

vi.mock('../src/logic-response.js', () => ({
  parseLogicReviewResponse: vi.fn().mockReturnValue(null),
}));

vi.mock('../src/chunk-utils.js', () => ({
  buildChunkSnippetsMap: vi.fn().mockReturnValue(new Map()),
}));

import { LogicPlugin } from '../src/plugins/logic.js';
import { detectLogicFindings } from '../src/logic-review.js';
import { isFindingSuppressed } from '../src/suppression.js';
import { parseLogicReviewResponse } from '../src/logic-response.js';
import { buildChunkSnippetsMap } from '../src/chunk-utils.js';

function makeLogicFinding(overrides?: Partial<LogicFinding>): LogicFinding {
  return {
    filepath: 'src/foo.ts',
    symbolName: 'doSomething',
    line: 10,
    category: 'breaking_change',
    severity: 'warning',
    message: 'Exported function signature changed',
    evidence: 'Parameter count changed from 2 to 3',
    ...overrides,
  };
}

describe('LogicPlugin', () => {
  const plugin = new LogicPlugin();

  beforeEach(() => {
    // Reset all mocks to their factory defaults — vi.clearAllMocks() does not
    // reset implementations set via mockReturnValue/mockImplementation, so we
    // explicitly restore defaults to prevent state leaking between tests.
    vi.mocked(detectLogicFindings).mockReturnValue([]);
    vi.mocked(isFindingSuppressed).mockReturnValue(false);
    vi.mocked(buildChunkSnippetsMap).mockReturnValue(new Map());
    vi.mocked(parseLogicReviewResponse).mockReturnValue(null);
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  it('has correct metadata', () => {
    expect(plugin.id).toBe('logic');
    expect(plugin.name).toBe('Logic Review');
    expect(plugin.requiresLLM).toBe(true);
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.defaultConfig).toEqual({
      categories: ['breaking_change', 'unchecked_return', 'missing_tests'],
    });
  });

  // ---------------------------------------------------------------------------
  // shouldActivate
  // ---------------------------------------------------------------------------

  it('shouldActivate returns true when chunks exist', () => {
    const context = createTestContext({ chunks: [createTestChunk()] });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('shouldActivate returns false when no chunks', () => {
    const context = createTestContext({ chunks: [] });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // analyze
  // ---------------------------------------------------------------------------

  it('returns empty when no findings detected', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([]);
    const context = createTestContext({ chunks: [createTestChunk()] });
    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(0);
  });

  it('converts LogicFinding[] to ReviewFinding[]', async () => {
    const logicFinding = makeLogicFinding();
    vi.mocked(detectLogicFindings).mockReturnValue([logicFinding]);

    const context = createTestContext({ chunks: [createTestChunk()] });
    const findings = await plugin.analyze(context);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      pluginId: 'logic',
      filepath: 'src/foo.ts',
      line: 10,
      severity: 'warning',
      category: 'breaking_change',
      message: 'Exported function signature changed',
    });
  });

  it('includes LogicFindingMetadata with evidence', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);

    const context = createTestContext({ chunks: [createTestChunk()] });
    const findings = await plugin.analyze(context);

    expect(findings[0].metadata).toEqual({
      pluginType: 'logic',
      evidence: 'Parameter count changed from 2 to 3',
    });
  });

  it('filters suppressed findings', async () => {
    const findings = [
      makeLogicFinding({ symbolName: 'fnA' }),
      makeLogicFinding({ symbolName: 'fnB' }),
    ];
    vi.mocked(detectLogicFindings).mockReturnValue(findings);

    const snippetsMap = new Map([
      ['src/foo.ts::fnA', '// lien-ignore: all\nfunction fnA() {}'],
      ['src/foo.ts::fnB', 'function fnB() {}'],
    ]);
    vi.mocked(buildChunkSnippetsMap).mockReturnValue(snippetsMap);
    vi.mocked(isFindingSuppressed).mockImplementation((finding: LogicFinding) => {
      return finding.symbolName === 'fnA';
    });

    const context = createTestContext({ chunks: [createTestChunk()] });
    const result = await plugin.analyze(context);

    expect(result).toHaveLength(1);
    expect(result[0].filepath).toBe('src/foo.ts');
  });

  it('logs suppressed findings', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);
    vi.mocked(buildChunkSnippetsMap).mockReturnValue(
      new Map([['src/foo.ts::doSomething', 'code']]),
    );
    vi.mocked(isFindingSuppressed).mockReturnValue(true);

    const infos: string[] = [];
    const logger = { ...silentLogger, info: (msg: string) => infos.push(msg) };
    const context = createTestContext({ chunks: [createTestChunk()], logger });
    await plugin.analyze(context);

    expect(infos.some(m => m.includes('Suppressed finding'))).toBe(true);
  });

  it('returns empty when all findings are suppressed', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);
    vi.mocked(buildChunkSnippetsMap).mockReturnValue(
      new Map([['src/foo.ts::doSomething', 'code']]),
    );
    vi.mocked(isFindingSuppressed).mockReturnValue(true);

    const context = createTestContext({ chunks: [createTestChunk()] });
    const result = await plugin.analyze(context);
    expect(result).toHaveLength(0);
  });

  it('validates findings via LLM when available', async () => {
    const logicFindings = [makeLogicFinding()];
    vi.mocked(detectLogicFindings).mockReturnValue(logicFindings);
    vi.mocked(parseLogicReviewResponse).mockReturnValue({
      'src/foo.ts::doSomething': { valid: true, reason: 'real issue' },
    });

    const llm = createMockLLMClient(['{"src/foo.ts::doSomething": {"valid": true}}']);
    const context = createTestContext({ chunks: [createTestChunk()], llm });
    const result = await plugin.analyze(context);

    expect(llm.calls).toHaveLength(1);
    expect(result).toHaveLength(1);
  });

  it('filters false positives marked by LLM', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([
      makeLogicFinding({ symbolName: 'fnA' }),
      makeLogicFinding({ symbolName: 'fnB' }),
    ]);
    vi.mocked(parseLogicReviewResponse).mockReturnValue({
      'src/foo.ts::fnA': { valid: false, reason: 'false positive' },
      'src/foo.ts::fnB': { valid: true, reason: 'real' },
    });

    const llm = createMockLLMClient(['{}']);
    const context = createTestContext({ chunks: [createTestChunk()], llm });
    const result = await plugin.analyze(context);

    expect(result).toHaveLength(1);
    expect(result[0].symbolName).toBe('fnB');
  });

  it('keeps all findings when LLM response parse fails', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);
    vi.mocked(parseLogicReviewResponse).mockReturnValue(null);

    const llm = createMockLLMClient(['garbage']);
    const context = createTestContext({ chunks: [createTestChunk()], llm });
    const result = await plugin.analyze(context);

    expect(result).toHaveLength(1);
  });

  it('keeps all findings when LLM throws', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);

    const llm = createMockLLMClient();
    llm.complete = vi.fn().mockRejectedValue(new Error('API timeout'));
    const context = createTestContext({ chunks: [createTestChunk()], llm });
    const result = await plugin.analyze(context);

    expect(result).toHaveLength(1);
  });

  it('works without LLM — skips validation', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([makeLogicFinding()]);

    const context = createTestContext({ chunks: [createTestChunk()] });
    // No llm in context
    const result = await plugin.analyze(context);

    expect(result).toHaveLength(1);
  });

  it('respects configured categories', async () => {
    vi.mocked(detectLogicFindings).mockReturnValue([]);

    const context = createTestContext({
      chunks: [createTestChunk()],
      config: { categories: ['breaking_change'] },
    });
    await plugin.analyze(context);

    expect(detectLogicFindings).toHaveBeenCalledWith(
      expect.anything(), // chunks
      expect.anything(), // complexityReport
      null, // baselineReport
      ['breaking_change'],
    );
  });
});
