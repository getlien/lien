import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/core';
import type { ComplexityReport } from '../src/types.js';
import type { DependentContext } from '../src/dependent-context.js';
import {
  assembleDependentContext,
  selectTopFunctions,
  findCallSitesForSymbol,
  extractSnippetWindow,
  formatDependentContext,
} from '../src/dependent-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides: {
  file: string;
  startLine?: number;
  endLine?: number;
  content?: string;
  symbolName?: string;
  complexity?: number;
  callSites?: Array<{ symbol: string; line: number }>;
  imports?: string[];
  exports?: string[];
}): CodeChunk {
  const startLine = overrides.startLine ?? 1;
  const content = overrides.content ?? 'line1\nline2\nline3\nline4\nline5\nline6\nline7';
  const lineCount = content.split('\n').length;
  return {
    content,
    metadata: {
      file: overrides.file,
      startLine,
      endLine: overrides.endLine ?? startLine + lineCount - 1,
      type: 'function',
      language: 'typescript',
      symbolName: overrides.symbolName,
      complexity: overrides.complexity,
      callSites: overrides.callSites,
      imports: overrides.imports,
      exports: overrides.exports,
    },
  };
}

function makeReport(
  files: Record<
    string,
    {
      violations?: Array<{ symbolName: string; complexity?: number }>;
      dependents?: string[];
      dependentCount?: number;
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    }
  >,
): ComplexityReport {
  const reportFiles: ComplexityReport['files'] = {};
  let totalViolations = 0;

  for (const [filepath, data] of Object.entries(files)) {
    const violations = (data.violations ?? []).map(v => ({
      filepath,
      startLine: 1,
      endLine: 10,
      symbolName: v.symbolName,
      symbolType: 'function' as const,
      language: 'typescript',
      complexity: v.complexity ?? 20,
      threshold: 15,
      severity: 'error' as const,
      message: `Complexity ${v.complexity ?? 20} exceeds threshold 15`,
      metricType: 'cyclomatic' as const,
    }));
    totalViolations += violations.length;

    reportFiles[filepath] = {
      violations,
      dependents: data.dependents ?? [],
      dependentCount: data.dependentCount ?? data.dependents?.length ?? 0,
      testAssociations: [],
      riskLevel: data.riskLevel ?? 'low',
    };
  }

  return {
    summary: {
      filesAnalyzed: Object.keys(files).length,
      totalViolations,
      bySeverity: { error: totalViolations, warning: 0 },
      avgComplexity: 20,
      maxComplexity: 30,
    },
    files: reportFiles,
  };
}

// ---------------------------------------------------------------------------
// selectTopFunctions
// ---------------------------------------------------------------------------

describe('selectTopFunctions', () => {
  it('returns empty for no high-risk files', () => {
    const report = makeReport({
      'src/utils.ts': {
        violations: [{ symbolName: 'doStuff' }],
        riskLevel: 'low',
        dependentCount: 5,
        dependents: ['src/a.ts'],
      },
    });
    expect(selectTopFunctions(report)).toEqual([]);
  });

  it('returns empty when dependentCount is 0', () => {
    const report = makeReport({
      'src/utils.ts': {
        violations: [{ symbolName: 'doStuff' }],
        riskLevel: 'high',
        dependentCount: 0,
      },
    });
    expect(selectTopFunctions(report)).toEqual([]);
  });

  it('returns qualifying high-risk functions sorted by impact', () => {
    const report = makeReport({
      'src/a.ts': {
        violations: [{ symbolName: 'funcA' }],
        riskLevel: 'high',
        dependentCount: 10,
        dependents: ['src/dep1.ts'],
      },
      'src/b.ts': {
        violations: [{ symbolName: 'funcB' }],
        riskLevel: 'critical',
        dependentCount: 5,
        dependents: ['src/dep2.ts'],
      },
    });

    const result = selectTopFunctions(report);
    expect(result).toHaveLength(2);
    // critical (weight=4) * 5 = 20 > high (weight=3) * 10 = 30
    // Actually: high*10 = 30 > critical*5 = 20
    expect(result[0].symbolName).toBe('funcA');
    expect(result[1].symbolName).toBe('funcB');
  });

  it('caps at 3 functions', () => {
    const report = makeReport({
      'src/a.ts': {
        violations: [{ symbolName: 'a' }],
        riskLevel: 'high',
        dependentCount: 10,
        dependents: ['src/x.ts'],
      },
      'src/b.ts': {
        violations: [{ symbolName: 'b' }],
        riskLevel: 'high',
        dependentCount: 8,
        dependents: ['src/x.ts'],
      },
      'src/c.ts': {
        violations: [{ symbolName: 'c' }],
        riskLevel: 'high',
        dependentCount: 6,
        dependents: ['src/x.ts'],
      },
      'src/d.ts': {
        violations: [{ symbolName: 'd' }],
        riskLevel: 'high',
        dependentCount: 4,
        dependents: ['src/x.ts'],
      },
      'src/e.ts': {
        violations: [{ symbolName: 'e' }],
        riskLevel: 'high',
        dependentCount: 2,
        dependents: ['src/x.ts'],
      },
    });

    const result = selectTopFunctions(report);
    expect(result).toHaveLength(3);
    expect(result.map(f => f.symbolName)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// extractSnippetWindow
// ---------------------------------------------------------------------------

describe('extractSnippetWindow', () => {
  it('extracts a 5-line window around the call site', () => {
    const chunk = makeChunk({
      file: 'src/caller.ts',
      startLine: 10,
      content: 'line10\nline11\nline12\nline13\nline14\nline15\nline16',
    });

    const result = extractSnippetWindow(chunk, 12);
    expect(result).toBe('line10\nline11\nline12\nline13\nline14');
  });

  it('clamps to chunk start when call site is near the beginning', () => {
    const chunk = makeChunk({
      file: 'src/caller.ts',
      startLine: 1,
      content: 'line1\nline2\nline3\nline4\nline5',
    });

    const result = extractSnippetWindow(chunk, 1);
    // relativeLine = 0, start = max(0, -2) = 0, end = min(4, 2) = 2
    expect(result).toBe('line1\nline2\nline3');
  });

  it('clamps to chunk end when call site is near the end', () => {
    const chunk = makeChunk({
      file: 'src/caller.ts',
      startLine: 1,
      content: 'line1\nline2\nline3\nline4\nline5',
    });

    const result = extractSnippetWindow(chunk, 5);
    // relativeLine = 4, start = max(0, 2) = 2, end = min(4, 6) = 4
    expect(result).toBe('line3\nline4\nline5');
  });

  it('returns null when call site is outside chunk range', () => {
    const chunk = makeChunk({
      file: 'src/caller.ts',
      startLine: 10,
      endLine: 16,
      content: 'line10\nline11\nline12\nline13\nline14\nline15\nline16',
    });

    expect(extractSnippetWindow(chunk, 5)).toBeNull();
    expect(extractSnippetWindow(chunk, 20)).toBeNull();
  });

  it('truncates lines longer than 120 characters', () => {
    const longLine = 'x'.repeat(200);
    const chunk = makeChunk({
      file: 'src/caller.ts',
      startLine: 1,
      content: `short\n${longLine}\nshort2`,
    });

    const result = extractSnippetWindow(chunk, 2);
    expect(result).not.toBeNull();
    const lines = result!.split('\n');
    // The long line should be truncated
    const truncatedLine = lines.find(l => l.startsWith('xxx'));
    expect(truncatedLine).toBeDefined();
    expect(truncatedLine!.length).toBe(123); // 120 + '...'
    expect(truncatedLine!.endsWith('...')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findCallSitesForSymbol
// ---------------------------------------------------------------------------

describe('findCallSitesForSymbol', () => {
  it('finds chunks with matching call sites', () => {
    const chunks = [
      makeChunk({
        file: 'src/dependent.ts',
        startLine: 1,
        content: 'import { validate } from "./validate";\nconst x = validate(input);\nreturn x;',
        symbolName: 'processInput',
        complexity: 12,
        callSites: [{ symbol: 'validate', line: 2 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dependent.ts'], chunks);
    expect(result).toHaveLength(1);
    expect(result[0].filepath).toBe('src/dependent.ts');
    expect(result[0].callerSymbol).toBe('processInput');
    expect(result[0].line).toBe(2);
    expect(result[0].callerComplexity).toBe(12);
  });

  it('returns empty when no matching call sites', () => {
    const chunks = [
      makeChunk({
        file: 'src/dependent.ts',
        startLine: 1,
        symbolName: 'processInput',
        callSites: [{ symbol: 'otherFunc', line: 3 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dependent.ts'], chunks);
    expect(result).toHaveLength(0);
  });

  it('returns empty when chunks have no call sites', () => {
    const chunks = [
      makeChunk({
        file: 'src/dependent.ts',
        startLine: 1,
        symbolName: 'processInput',
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dependent.ts'], chunks);
    expect(result).toHaveLength(0);
  });

  it('skips chunks not in dependent file list', () => {
    const chunks = [
      makeChunk({
        file: 'src/other.ts',
        startLine: 1,
        symbolName: 'caller',
        callSites: [{ symbol: 'validate', line: 2 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dependent.ts'], chunks);
    expect(result).toHaveLength(0);
  });

  it('sorts by caller complexity descending', () => {
    const chunks = [
      makeChunk({
        file: 'src/a.ts',
        startLine: 1,
        symbolName: 'lowComplexity',
        complexity: 5,
        callSites: [{ symbol: 'validate', line: 2 }],
      }),
      makeChunk({
        file: 'src/b.ts',
        startLine: 1,
        symbolName: 'highComplexity',
        complexity: 30,
        callSites: [{ symbol: 'validate', line: 3 }],
      }),
      makeChunk({
        file: 'src/c.ts',
        startLine: 1,
        symbolName: 'medComplexity',
        complexity: 15,
        callSites: [{ symbol: 'validate', line: 4 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/a.ts', 'src/b.ts', 'src/c.ts'], chunks);
    expect(result).toHaveLength(3);
    expect(result[0].callerComplexity).toBe(30);
    expect(result[1].callerComplexity).toBe(15);
    expect(result[2].callerComplexity).toBe(5);
  });

  it('limits to 3 snippets per function', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
    const chunks = files.map((file, i) =>
      makeChunk({
        file,
        startLine: 1,
        symbolName: `caller${i}`,
        complexity: 10 + i,
        callSites: [{ symbol: 'validate', line: 2 }],
      }),
    );

    const result = findCallSitesForSymbol('validate', files, chunks);
    expect(result).toHaveLength(3);
  });

  it('picks only one call site per dependent file', () => {
    const chunks = [
      makeChunk({
        file: 'src/dep.ts',
        startLine: 1,
        endLine: 5,
        content: 'a\nb\nc\nd\ne',
        symbolName: 'funcA',
        callSites: [{ symbol: 'validate', line: 2 }],
      }),
      makeChunk({
        file: 'src/dep.ts',
        startLine: 10,
        endLine: 15,
        content: 'f\ng\nh\ni\nj\nk',
        symbolName: 'funcB',
        callSites: [{ symbol: 'validate', line: 12 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dep.ts'], chunks);
    expect(result).toHaveLength(1);
  });

  it('skips call sites outside chunk range', () => {
    const chunks = [
      makeChunk({
        file: 'src/dep.ts',
        startLine: 10,
        endLine: 15,
        content: 'a\nb\nc\nd\ne\nf',
        symbolName: 'caller',
        callSites: [{ symbol: 'validate', line: 50 }],
      }),
    ];

    const result = findCallSitesForSymbol('validate', ['src/dep.ts'], chunks);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatDependentContext
// ---------------------------------------------------------------------------

describe('formatDependentContext', () => {
  it('formats context with snippets', () => {
    const ctx: DependentContext = {
      targetKey: 'src/validate.ts::validateEmail',
      filepath: 'src/validate.ts',
      symbolName: 'validateEmail',
      totalDependentCount: 5,
      riskLevel: 'high',
      snippets: [
        {
          filepath: 'src/auth.ts',
          callerSymbol: 'login',
          line: 34,
          snippet:
            'const isValid = validateEmail(user.email);\nif (!isValid) throw new AuthError();',
          callerComplexity: 28,
        },
        {
          filepath: 'src/user.ts',
          callerSymbol: 'create',
          line: 12,
          snippet: 'const result = validateEmail(req.body.email);',
          callerComplexity: 22,
        },
      ],
    };

    const result = formatDependentContext(ctx);
    expect(result).toContain('**Dependent Usage Context**');
    expect(result).toContain('top 2 of 5 dependents');
    expect(result).toContain('src/auth.ts:34');
    expect(result).toContain('in login()');
    expect(result).toContain('(complexity: 28)');
    expect(result).toContain('src/user.ts:12');
    expect(result).toContain('in create()');
  });

  it('shows exact count when snippets equal totalDependentCount', () => {
    const ctx: DependentContext = {
      targetKey: 'src/validate.ts::validateEmail',
      filepath: 'src/validate.ts',
      symbolName: 'validateEmail',
      totalDependentCount: 1,
      riskLevel: 'high',
      snippets: [
        {
          filepath: 'src/auth.ts',
          callerSymbol: 'login',
          line: 34,
          snippet: 'validateEmail(email);',
        },
      ],
    };

    const result = formatDependentContext(ctx);
    expect(result).toContain('1 dependent');
    expect(result).not.toContain('top');
  });

  it('uses plural for multiple dependents matching count', () => {
    const ctx: DependentContext = {
      targetKey: 'src/v.ts::fn',
      filepath: 'src/v.ts',
      symbolName: 'fn',
      totalDependentCount: 2,
      riskLevel: 'high',
      snippets: [
        { filepath: 'src/a.ts', callerSymbol: 'a', line: 1, snippet: 'fn();' },
        { filepath: 'src/b.ts', callerSymbol: 'b', line: 1, snippet: 'fn();' },
      ],
    };

    const result = formatDependentContext(ctx);
    expect(result).toContain('2 dependents');
  });

  it('omits complexity note when not available', () => {
    const ctx: DependentContext = {
      targetKey: 'src/v.ts::fn',
      filepath: 'src/v.ts',
      symbolName: 'fn',
      totalDependentCount: 1,
      riskLevel: 'high',
      snippets: [{ filepath: 'src/a.ts', callerSymbol: 'caller', line: 5, snippet: 'fn();' }],
    };

    const result = formatDependentContext(ctx);
    expect(result).not.toContain('complexity:');
  });

  it('returns fallback when no snippets but has dependents', () => {
    const ctx: DependentContext = {
      targetKey: 'src/v.ts::fn',
      filepath: 'src/v.ts',
      symbolName: 'fn',
      totalDependentCount: 10,
      riskLevel: 'high',
      snippets: [],
    };

    const result = formatDependentContext(ctx);
    expect(result).toContain('no call-site data available');
    expect(result).toContain('10 file(s) depend on `fn`');
  });

  it('returns empty string when no snippets and zero dependents', () => {
    const ctx: DependentContext = {
      targetKey: 'src/v.ts::fn',
      filepath: 'src/v.ts',
      symbolName: 'fn',
      totalDependentCount: 0,
      riskLevel: 'high',
      snippets: [],
    };

    const result = formatDependentContext(ctx);
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// assembleDependentContext (integration)
// ---------------------------------------------------------------------------

describe('assembleDependentContext', () => {
  it('returns formatted context for high-risk functions with call sites', () => {
    const report = makeReport({
      'src/validate.ts': {
        violations: [{ symbolName: 'validateEmail', complexity: 25 }],
        riskLevel: 'high',
        dependentCount: 2,
        dependents: ['src/auth.ts', 'src/user.ts'],
      },
    });

    const chunks = [
      // The target chunk (validate.ts itself)
      makeChunk({
        file: 'src/validate.ts',
        startLine: 1,
        content:
          'export function validateEmail(email: string) {\n  // complex logic\n  return true;\n}',
        symbolName: 'validateEmail',
        exports: ['validateEmail'],
      }),
      // Dependent: auth.ts
      makeChunk({
        file: 'src/auth.ts',
        startLine: 30,
        content:
          'function login(user: User) {\n  const email = user.email;\n  const valid = validateEmail(email);\n  if (!valid) throw new Error();\n  return token;\n}',
        symbolName: 'login',
        complexity: 18,
        callSites: [{ symbol: 'validateEmail', line: 32 }],
        imports: ['./validate'],
      }),
      // Dependent: user.ts
      makeChunk({
        file: 'src/user.ts',
        startLine: 10,
        content:
          'function createUser(data: UserData) {\n  validateEmail(data.email);\n  return save(data);\n}',
        symbolName: 'createUser',
        complexity: 8,
        callSites: [{ symbol: 'validateEmail', line: 11 }],
        imports: ['./validate'],
      }),
    ];

    const result = assembleDependentContext(report, chunks);
    expect(result.size).toBe(1);

    const key = 'src/validate.ts::validateEmail';
    expect(result.has(key)).toBe(true);

    const formatted = result.get(key)!;
    expect(formatted).toContain('**Dependent Usage Context**');
    expect(formatted).toContain('src/auth.ts:32');
    expect(formatted).toContain('in login()');
    expect(formatted).toContain('src/user.ts:11');
    expect(formatted).toContain('in createUser()');
  });

  it('returns empty map when no high-risk files', () => {
    const report = makeReport({
      'src/utils.ts': {
        violations: [{ symbolName: 'helper' }],
        riskLevel: 'low',
        dependentCount: 5,
      },
    });

    const result = assembleDependentContext(report, []);
    expect(result.size).toBe(0);
  });

  it('returns fallback when high-risk has dependents but no call-site data', () => {
    const report = makeReport({
      'src/validate.ts': {
        violations: [{ symbolName: 'validateEmail' }],
        riskLevel: 'high',
        dependentCount: 3,
        dependents: ['src/auth.ts', 'src/user.ts', 'src/admin.ts'],
      },
    });

    // Dependent chunks exist but have no callSites
    const chunks = [
      makeChunk({
        file: 'src/auth.ts',
        startLine: 1,
        symbolName: 'login',
        // No callSites
      }),
    ];

    const result = assembleDependentContext(report, chunks);
    expect(result.size).toBe(1);
    const formatted = result.get('src/validate.ts::validateEmail')!;
    expect(formatted).toContain('no call-site data available');
  });

  it('returns empty map when dependentCount > 0 but no dependent chunks in memory', () => {
    const report = makeReport({
      'src/validate.ts': {
        violations: [{ symbolName: 'validateEmail' }],
        riskLevel: 'high',
        dependentCount: 10,
        dependents: [], // No dependents in the PR changeset
      },
    });

    const result = assembleDependentContext(report, []);
    expect(result.size).toBe(0);
  });

  it('processes multiple high-risk functions', () => {
    const report = makeReport({
      'src/a.ts': {
        violations: [{ symbolName: 'funcA' }],
        riskLevel: 'high',
        dependentCount: 3,
        dependents: ['src/dep.ts'],
      },
      'src/b.ts': {
        violations: [{ symbolName: 'funcB' }],
        riskLevel: 'critical',
        dependentCount: 2,
        dependents: ['src/dep.ts'],
      },
    });

    const chunks = [
      makeChunk({
        file: 'src/dep.ts',
        startLine: 1,
        content: 'funcA();\nfuncB();\nreturn;',
        symbolName: 'handler',
        complexity: 10,
        callSites: [
          { symbol: 'funcA', line: 1 },
          { symbol: 'funcB', line: 2 },
        ],
      }),
    ];

    const result = assembleDependentContext(report, chunks);
    expect(result.size).toBe(2);
    expect(result.has('src/a.ts::funcA')).toBe(true);
    expect(result.has('src/b.ts::funcB')).toBe(true);
  });
});
