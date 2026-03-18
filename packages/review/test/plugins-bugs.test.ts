import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BugFinderPlugin } from '../src/plugins/bugs.js';
import { createTestContext, createTestChunk, createMockLLMClient } from '../src/test-helpers.js';

function makeBugLLMResponse(
  bugs: Array<{
    filepath: string;
    line: number;
    symbol?: string;
    severity?: string;
    category?: string;
    description: string;
    evidence?: string;
    suggestion?: string;
  }>,
): string {
  return JSON.stringify({
    bugs: bugs.map(b => ({
      severity: 'warning',
      category: 'logic_error',
      symbol: 'unknown',
      evidence: '',
      suggestion: '',
      ...b,
    })),
  });
}

// Reusable chunks for a simple "validate -> auth" dependency
function makeTestScenario() {
  const validateChunk = createTestChunk({
    content:
      'export function validateEmail(email: string): boolean { return email.includes("@"); }',
    metadata: {
      file: 'src/utils/validate.ts',
      startLine: 1,
      endLine: 5,
      type: 'function',
      symbolName: 'validateEmail',
      symbolType: 'function',
      language: 'typescript',
      exports: ['validateEmail'],
      signature: 'validateEmail(email: string): boolean',
      parameters: ['email: string'],
      returnType: 'boolean',
    },
  });

  const authChunk = createTestChunk({
    content:
      'import { validateEmail } from "../utils/validate";\nexport function register(email: string) {\n  if (validateEmail(email)) {\n    // register\n  }\n}',
    metadata: {
      file: 'src/services/auth.ts',
      startLine: 1,
      endLine: 10,
      type: 'function',
      symbolName: 'register',
      symbolType: 'function',
      language: 'typescript',
      exports: ['register'],
      importedSymbols: { '../utils/validate': ['validateEmail'] },
      callSites: [{ symbol: 'validateEmail', line: 3 }],
    },
  });

  return { validateChunk, authChunk };
}

describe('BugFinderPlugin', () => {
  const plugin = new BugFinderPlugin();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  it('has correct metadata', () => {
    expect(plugin.id).toBe('bugs');
    expect(plugin.name).toBe('Bug Finder');
    expect(plugin.requiresLLM).toBe(true);
    expect(plugin.requiresRepoChunks).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // shouldActivate
  // ---------------------------------------------------------------------------

  it('returns false when no function/method chunks', () => {
    const context = createTestContext({
      chunks: [
        createTestChunk({
          metadata: {
            file: 'a.ts',
            startLine: 1,
            endLine: 5,
            type: 'block',
            language: 'typescript',
          },
        }),
      ],
    });
    expect(plugin.shouldActivate(context)).toBe(false);
  });

  it('returns true when function chunks are present', () => {
    const context = createTestContext({
      chunks: [
        createTestChunk({
          metadata: {
            file: 'a.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            symbolType: 'function',
            symbolName: 'foo',
            language: 'typescript',
          },
        }),
      ],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('returns true when method chunks are present', () => {
    const context = createTestContext({
      chunks: [
        createTestChunk({
          metadata: {
            file: 'a.ts',
            startLine: 1,
            endLine: 5,
            type: 'function',
            symbolType: 'method',
            symbolName: 'bar',
            language: 'typescript',
          },
        }),
      ],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // analyze
  // ---------------------------------------------------------------------------

  it('returns empty when no LLM', async () => {
    const { validateChunk, authChunk } = makeTestScenario();
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
    });
    const findings = await plugin.analyze(context);
    expect(findings).toEqual([]);
  });

  it('returns empty when no repoChunks', async () => {
    const { validateChunk } = makeTestScenario();
    const llm = createMockLLMClient();
    const context = createTestContext({
      chunks: [validateChunk],
      llm,
    });
    const findings = await plugin.analyze(context);
    expect(findings).toEqual([]);
  });

  it('returns empty when changed functions have no callers', async () => {
    const isolatedChunk = createTestChunk({
      metadata: {
        file: 'src/standalone.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolType: 'function',
        symbolName: 'standalone',
        language: 'typescript',
        exports: ['standalone'],
      },
    });

    const llm = createMockLLMClient();
    const context = createTestContext({
      chunks: [isolatedChunk],
      repoChunks: [isolatedChunk],
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toEqual([]);
    expect(llm.calls).toHaveLength(0); // No LLM call made
  });

  it('sends prompt to LLM and parses bug findings', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llmResponse = makeBugLLMResponse([
      {
        filepath: 'src/services/auth.ts',
        line: 3,
        symbol: 'register',
        severity: 'warning',
        category: 'null_check',
        description: 'validateEmail may return null but register assumes boolean',
        evidence: 'Line 3: if (validateEmail(email))',
        suggestion: 'Add explicit null check',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    expect(llm.calls).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].pluginId).toBe('bugs');
    expect(findings[0].filepath).toBe('src/services/auth.ts');
    expect(findings[0].line).toBe(3);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('null_check');
    expect(findings[0].symbolName).toBe('register');
  });

  it('prompt includes changed function code and caller code', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llm = createMockLLMClient([makeBugLLMResponse([])]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    await plugin.analyze(context);

    expect(llm.calls).toHaveLength(1);
    const prompt = llm.calls[0].prompt;
    // Changed function code is in the prompt
    expect(prompt).toContain('validateEmail');
    expect(prompt).toContain('src/utils/validate.ts');
    // Caller code is in the prompt
    expect(prompt).toContain('register');
    expect(prompt).toContain('src/services/auth.ts');
  });

  it('handles malformed LLM response gracefully', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llm = createMockLLMClient(['not valid json at all']);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toEqual([]);
  });

  it('returns empty array when LLM finds no bugs', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llm = createMockLLMClient([makeBugLLMResponse([])]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toEqual([]);
  });

  it('sets correct metadata on findings', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llmResponse = makeBugLLMResponse([
      {
        filepath: 'src/services/auth.ts',
        line: 3,
        symbol: 'register',
        severity: 'error',
        category: 'type_mismatch',
        description: 'Type mismatch at call site',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    expect(findings).toHaveLength(1);
    const meta = findings[0].metadata as {
      pluginType: string;
      bugCategory: string;
      changedFunction: string;
    };
    expect(meta.pluginType).toBe('bugs');
    expect(meta.bugCategory).toBe('type_mismatch');
    expect(meta.changedFunction).toBe('src/utils/validate.ts::validateEmail');
  });

  it('normalizes invalid severity to warning', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llmResponse = makeBugLLMResponse([
      {
        filepath: 'src/services/auth.ts',
        line: 3,
        severity: 'critical' as 'error', // Invalid severity
        description: 'Some bug',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning'); // Normalized to warning
  });

  // ---------------------------------------------------------------------------
  // present
  // ---------------------------------------------------------------------------

  it('appends summary with findings', async () => {
    const summaries: string[] = [];
    const presentContext = {
      complexityReport: {
        files: {},
        summary: {
          filesAnalyzed: 0,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 0,
          maxComplexity: 0,
        },
      },
      baselineReport: null,
      deltas: null,
      deltaSummary: null,
      logger: { info: () => {}, warning: () => {}, error: () => {}, debug: () => {} },
      addAnnotations: () => {},
      appendSummary: (md: string) => summaries.push(md),
      appendDescription: () => {},
    } as unknown as PresentContext;

    await plugin.present(
      [
        {
          pluginId: 'bugs',
          filepath: 'src/auth.ts',
          line: 10,
          severity: 'warning',
          category: 'null_check',
          message: 'Missing null check',
        },
      ],
      presentContext,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('Bug Finder');
    expect(summaries[0]).toContain('Missing null check');
  });

  it('does nothing when no findings', async () => {
    const summaries: string[] = [];
    const presentContext = {
      complexityReport: {
        files: {},
        summary: {
          filesAnalyzed: 0,
          totalViolations: 0,
          bySeverity: { error: 0, warning: 0 },
          avgComplexity: 0,
          maxComplexity: 0,
        },
      },
      baselineReport: null,
      deltas: null,
      deltaSummary: null,
      logger: { info: () => {}, warning: () => {}, error: () => {}, debug: () => {} },
      addAnnotations: () => {},
      appendSummary: (md: string) => summaries.push(md),
      appendDescription: () => {},
    } as unknown as PresentContext;

    await plugin.present([], presentContext);
    expect(summaries).toHaveLength(0);
  });
});
