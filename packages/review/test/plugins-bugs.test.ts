import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BugFinderPlugin } from '../src/plugins/bugs.js';
import { createTestContext, createTestChunk, createMockLLMClient } from '../src/test-helpers.js';
import type { PresentContext, BugFindingMetadata } from '../src/plugin-types.js';

function makeBugLLMResponse(
  bugs: Array<{
    changedFunction?: string;
    callerFilepath: string;
    callerLine: number;
    callerSymbol: string;
    severity?: string;
    category?: string;
    description: string;
    suggestion?: string;
  }>,
): string {
  return JSON.stringify({
    bugs: bugs.map(b => ({
      severity: 'warning',
      category: 'logic_error',
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
    expect(llm.calls).toHaveLength(0);
  });

  it('anchors findings on the changed function, not the caller', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llmResponse = makeBugLLMResponse([
      {
        callerFilepath: 'src/services/auth.ts',
        callerLine: 3,
        callerSymbol: 'register',
        severity: 'warning',
        category: 'null_check',
        description: 'Passes null to validateEmail check',
        suggestion: 'Add null guard',
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
    // Finding is anchored on the CHANGED function
    expect(findings[0].filepath).toBe('src/utils/validate.ts');
    expect(findings[0].line).toBe(1); // validateChunk.metadata.startLine
    expect(findings[0].symbolName).toBe('validateEmail');
    expect(findings[0].pluginId).toBe('bugs');
  });

  it('groups multiple callers into one finding per changed function', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    // Add a second caller
    const profileChunk = createTestChunk({
      content:
        'import { validateEmail } from "../utils/validate";\nfunction updateProfile() { validateEmail(email); }',
      metadata: {
        file: 'src/services/profile.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'updateProfile',
        symbolType: 'function',
        language: 'typescript',
        exports: ['updateProfile'],
        importedSymbols: { '../utils/validate': ['validateEmail'] },
        callSites: [{ symbol: 'validateEmail', line: 2 }],
      },
    });

    const llmResponse = makeBugLLMResponse([
      {
        callerFilepath: 'src/services/auth.ts',
        callerLine: 3,
        callerSymbol: 'register',
        severity: 'error',
        category: 'null_check',
        description: 'Null not handled',
      },
      {
        callerFilepath: 'src/services/profile.ts',
        callerLine: 2,
        callerSymbol: 'updateProfile',
        severity: 'warning',
        category: 'null_check',
        description: 'Null not handled',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [validateChunk],
      repoChunks: [validateChunk, authChunk, profileChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    // Grouped into one finding for validateEmail
    expect(findings).toHaveLength(1);
    expect(findings[0].filepath).toBe('src/utils/validate.ts');
    expect(findings[0].symbolName).toBe('validateEmail');
    // Worst severity wins
    expect(findings[0].severity).toBe('error');
    // Metadata has both callers
    const meta = findings[0].metadata as BugFindingMetadata;
    expect(meta.callers).toHaveLength(2);
    expect(meta.callers[0].symbol).toBe('register');
    expect(meta.callers[1].symbol).toBe('updateProfile');
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
    expect(prompt).toContain('validateEmail');
    expect(prompt).toContain('src/utils/validate.ts');
    expect(prompt).toContain('register');
    expect(prompt).toContain('src/services/auth.ts');
    // New prompt format asks for callerFilepath
    expect(prompt).toContain('callerFilepath');
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

  it('metadata includes callers array with details', async () => {
    const { validateChunk, authChunk } = makeTestScenario();

    const llmResponse = makeBugLLMResponse([
      {
        callerFilepath: 'src/services/auth.ts',
        callerLine: 3,
        callerSymbol: 'register',
        severity: 'error',
        category: 'type_mismatch',
        description: 'Type mismatch at call site',
        suggestion: 'Add type guard',
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
    const meta = findings[0].metadata as BugFindingMetadata;
    expect(meta.pluginType).toBe('bugs');
    expect(meta.changedFunction).toBe('src/utils/validate.ts::validateEmail');
    expect(meta.callers).toHaveLength(1);
    expect(meta.callers[0]).toEqual({
      filepath: 'src/services/auth.ts',
      line: 3,
      symbol: 'register',
      category: 'type_mismatch',
      description: 'Type mismatch at call site',
      suggestion: 'Add type guard',
    });
  });

  // ---------------------------------------------------------------------------
  // Changed type/interface analysis
  // ---------------------------------------------------------------------------

  it('detects interface contract violations in importers', async () => {
    const typeChunk = createTestChunk({
      content: 'export interface User { id: string; name: string; role: string; }',
      metadata: {
        file: 'src/types.ts',
        startLine: 1,
        endLine: 5,
        type: 'class',
        symbolName: 'User',
        symbolType: 'interface',
        language: 'typescript',
        exports: ['User'],
      },
    });

    const importerChunk = createTestChunk({
      content:
        'import { User } from "./types";\nexport function createUser(name: string): User {\n  return { id: "1", name };\n}',
      metadata: {
        file: 'src/user-service.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'createUser',
        symbolType: 'function',
        language: 'typescript',
        exports: ['createUser'],
        importedSymbols: { './types': ['User'] },
      },
    });

    const llmResponse = makeBugLLMResponse([
      {
        changedFunction: 'User',
        callerFilepath: 'src/user-service.ts',
        callerLine: 3,
        callerSymbol: 'createUser',
        severity: 'error',
        category: 'type_mismatch',
        description: 'Missing required field "role" in User literal',
        suggestion: 'Add role property to returned object',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [typeChunk],
      repoChunks: [typeChunk, importerChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    expect(findings).toHaveLength(1);
    expect(findings[0].symbolName).toBe('User');
    expect(findings[0].filepath).toBe('src/types.ts');
    const meta = findings[0].metadata as BugFindingMetadata;
    expect(meta.callers[0].description).toContain('role');
  });

  it('activates when only type chunks are present', () => {
    const context = createTestContext({
      chunks: [
        createTestChunk({
          metadata: {
            file: 'src/types.ts',
            startLine: 1,
            endLine: 5,
            type: 'class',
            symbolType: 'interface',
            symbolName: 'User',
            language: 'typescript',
          },
        }),
      ],
    });
    expect(plugin.shouldActivate(context)).toBe(true);
  });

  it('ignores importers whose import path does not match the source file', async () => {
    const typeChunk = createTestChunk({
      content: 'export interface User { id: string; name: string; role: string; }',
      metadata: {
        file: 'src/types.ts',
        startLine: 1,
        endLine: 5,
        type: 'class',
        symbolName: 'User',
        symbolType: 'interface',
        language: 'typescript',
        exports: ['User'],
      },
    });

    // This chunk imports User from a DIFFERENT path (not ./types)
    const unrelatedChunk = createTestChunk({
      content:
        'import { User } from "@company/auth";\nexport function getAdmin(): User {\n  return { id: "1", name: "admin" };\n}',
      metadata: {
        file: 'src/admin.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        symbolName: 'getAdmin',
        symbolType: 'function',
        language: 'typescript',
        exports: ['getAdmin'],
        importedSymbols: { '@company/auth': ['User'] },
      },
    });

    const llm = createMockLLMClient([]);
    const context = createTestContext({
      chunks: [typeChunk],
      repoChunks: [typeChunk, unrelatedChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    // Should find no violations because the importer imports User from
    // @company/auth, not from ./types (the source file)
    expect(findings).toHaveLength(0);
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
          filepath: 'src/utils/validate.ts',
          line: 1,
          symbolName: 'validateEmail',
          severity: 'warning' as const,
          category: 'bug',
          message: '1 caller affected',
          metadata: {
            pluginType: 'bugs' as const,
            changedFunction: 'src/utils/validate.ts::validateEmail',
            callers: [
              {
                filepath: 'src/auth.ts',
                line: 10,
                symbol: 'register',
                category: 'null_check',
                description: 'Missing null check',
                suggestion: 'Add guard',
              },
            ],
          },
        },
      ],
      presentContext,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('Bug Finder');
    expect(summaries[0]).toContain('validateEmail');
  });

  // ---------------------------------------------------------------------------
  // Deleted function detection
  // ---------------------------------------------------------------------------

  it('detects deleted functions with remaining callers', async () => {
    // authChunk calls validateEmail — simulate deleting validateEmail
    const { authChunk } = makeTestScenario();

    const patches = new Map([
      [
        'src/utils/validate.ts',
        [
          '@@ -1,5 +0,0 @@',
          '-export function validateEmail(email: string): boolean {',
          '-  return email.includes("@");',
          '-}',
        ].join('\n'),
      ],
    ]);

    const context = createTestContext({
      chunks: [], // validateEmail is deleted — no HEAD chunks for it
      repoChunks: [authChunk], // authChunk still calls validateEmail
      pr: {
        owner: 'test',
        repo: 'test',
        prNumber: 1,
        title: 'test',
        headSha: 'abc123',
        patches,
        diffLines: new Map(),
      },
    });

    const findings = await plugin.analyze(context);

    expect(findings).toHaveLength(1);
    expect(findings[0].symbolName).toBe('validateEmail (deleted)');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].filepath).toBe('src/utils/validate.ts');
    const meta = findings[0].metadata as BugFindingMetadata;
    expect(meta.callers).toHaveLength(1);
    expect(meta.callers[0].symbol).toBe('register');
    expect(meta.callers[0].description).toContain('deleted function');
  });

  it('does not flag deleted functions with no callers', async () => {
    const patches = new Map([
      [
        'src/unused.ts',
        ['@@ -1,3 +0,0 @@', '-export function unusedHelper(): void {', '-  // nothing', '-}'].join(
          '\n',
        ),
      ],
    ]);

    const context = createTestContext({
      chunks: [],
      repoChunks: [], // no callers anywhere
      pr: {
        owner: 'test',
        repo: 'test',
        prNumber: 1,
        title: 'test',
        headSha: 'abc123',
        patches,
        diffLines: new Map(),
      },
    });

    const findings = await plugin.analyze(context);
    expect(findings).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // changedFunction attribution disambiguation
  // ---------------------------------------------------------------------------

  it('disambiguates changedFunction when multiple functions share callers from the same file', async () => {
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

    const sanitizeChunk = createTestChunk({
      content: 'export function sanitizeString(input: string): string { return input.trim(); }',
      metadata: {
        file: 'src/utils/validate.ts',
        startLine: 10,
        endLine: 15,
        type: 'function',
        symbolName: 'sanitizeString',
        symbolType: 'function',
        language: 'typescript',
        exports: ['sanitizeString'],
        signature: 'sanitizeString(input: string): string',
        parameters: ['input: string'],
        returnType: 'string',
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

    const llmResponse = makeBugLLMResponse([
      {
        changedFunction: 'validateEmail',
        callerFilepath: 'src/services/auth.ts',
        callerLine: 3,
        callerSymbol: 'register',
        severity: 'warning',
        category: 'null_check',
        description: 'Passes null to validateEmail',
        suggestion: 'Add null guard',
      },
    ]);

    const llm = createMockLLMClient([llmResponse]);
    const context = createTestContext({
      chunks: [validateChunk, sanitizeChunk],
      repoChunks: [validateChunk, sanitizeChunk, authChunk],
      llm,
    });

    const findings = await plugin.analyze(context);

    expect(findings).toHaveLength(1);
    // Finding is attributed to validateEmail, NOT sanitizeString
    expect(findings[0].filepath).toBe('src/utils/validate.ts');
    expect(findings[0].symbolName).toBe('validateEmail');
    expect(findings[0].line).toBe(1); // validateChunk.metadata.startLine
    const meta = findings[0].metadata as BugFindingMetadata;
    expect(meta.changedFunction).toBe('src/utils/validate.ts::validateEmail');
  });

  // ---------------------------------------------------------------------------
  // diffLines filtering
  // ---------------------------------------------------------------------------

  it('excludes functions not overlapping with diff lines', async () => {
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
      },
    });

    const sanitizeChunk = createTestChunk({
      content: 'export function sanitizeString(input: string): string { return input.trim(); }',
      metadata: {
        file: 'src/utils/validate.ts',
        startLine: 50,
        endLine: 60,
        type: 'function',
        symbolName: 'sanitizeString',
        symbolType: 'function',
        language: 'typescript',
        exports: ['sanitizeString'],
      },
    });

    const callerChunk = createTestChunk({
      content:
        'import { validateEmail, sanitizeString } from "../utils/validate";\nfunction process() { validateEmail("x"); sanitizeString("y"); }',
      metadata: {
        file: 'src/services/processor.ts',
        startLine: 1,
        endLine: 5,
        type: 'function',
        symbolName: 'process',
        symbolType: 'function',
        language: 'typescript',
        exports: ['process'],
        importedSymbols: { '../utils/validate': ['validateEmail', 'sanitizeString'] },
        callSites: [
          { symbol: 'validateEmail', line: 2 },
          { symbol: 'sanitizeString', line: 2 },
        ],
      },
    });

    // diffLines only includes lines 1-5 (validateEmail range), NOT lines 50-60 (sanitizeString)
    const diffLines = new Map<string, Set<number>>([
      ['src/utils/validate.ts', new Set([1, 2, 3, 4, 5])],
    ]);

    const llm = createMockLLMClient([makeBugLLMResponse([])]);
    const context = createTestContext({
      chunks: [validateChunk, sanitizeChunk],
      repoChunks: [validateChunk, sanitizeChunk, callerChunk],
      llm,
      pr: {
        owner: 'test',
        repo: 'test',
        pullNumber: 1,
        title: 'test',
        baseSha: 'base123',
        headSha: 'head123',
        diffLines,
      },
    });

    await plugin.analyze(context);

    // LLM should have been called (validateEmail has callers)
    expect(llm.calls).toHaveLength(1);
    const prompt = llm.calls[0].prompt;
    // Prompt should contain validateEmail as a changed function section
    expect(prompt).toContain('### src/utils/validate.ts::validateEmail');
    // sanitizeString should NOT appear as a changed function section (does not overlap with diff lines)
    expect(prompt).not.toContain('### src/utils/validate.ts::sanitizeString');
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
