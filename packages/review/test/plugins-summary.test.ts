import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummaryPlugin } from '../src/plugins/summary.js';
import {
  computeRiskSignals,
  buildSummaryPrompt,
  parseSummaryResponse,
  formatSummaryMarkdown,
} from '../src/plugins/summary.js';
import type { ReviewContext, PresentContext, SummaryFindingMetadata } from '../src/plugin-types.js';
import {
  createTestContext,
  createTestChunk,
  createTestReport,
  createMockLLMClient,
  silentLogger,
} from '../src/test-helpers.js';

function makeSummaryLLMResponse(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    risk_level: 'medium',
    confidence: 'high',
    risk_explanation: 'Touches deployment flow; mistakes could leave stacks stuck.',
    overview: 'Adds a two-phase CloudFormation rollout to safely remove legacy RDS resources.',
    key_changes: [
      'Modified CloudFormation templates',
      'New deployment script',
      'Updated integration tests',
    ],
    ...overrides,
  });
}

describe('SummaryPlugin', () => {
  const plugin = new SummaryPlugin();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it('has correct id and requiresLLM', () => {
      expect(plugin.id).toBe('summary');
      expect(plugin.requiresLLM).toBe(true);
    });
  });

  describe('shouldActivate', () => {
    it('activates when PR context is present', () => {
      const context = createTestContext({
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'test PR',
          headSha: 'abc',
          baseSha: 'def',
        },
      });
      expect(plugin.shouldActivate(context)).toBe(true);
    });

    it('does not activate without PR context', () => {
      const context = createTestContext();
      expect(plugin.shouldActivate(context)).toBe(false);
    });
  });

  describe('computeRiskSignals', () => {
    it('categorizes files by path patterns', () => {
      const context = createTestContext({
        changedFiles: [
          'cloudformation/stack.yml',
          'src/app.ts',
          'test/app.test.ts',
          'README.md',
          'config.json',
          'db/migrations/001.sql',
        ],
      });

      const signals = computeRiskSignals(context);
      expect(signals.totalFiles).toBe(6);
      expect(signals.categories.infra).toBe(1);
      expect(signals.categories.source).toBe(1);
      expect(signals.categories.test).toBe(1);
      expect(signals.categories.docs).toBe(1);
      expect(signals.categories.config).toBe(1);
      expect(signals.categories.db).toBe(1);
    });

    it('counts new and improved violations from deltas', () => {
      const context = createTestContext({
        changedFiles: ['src/a.ts'],
        deltas: [
          {
            filepath: 'src/a.ts',
            symbolName: 'foo',
            symbolType: 'function',
            startLine: 1,
            metricType: 'cyclomatic',
            baseComplexity: null,
            headComplexity: 20,
            delta: 20,
            threshold: 15,
            severity: 'new',
          },
          {
            filepath: 'src/a.ts',
            symbolName: 'bar',
            symbolType: 'function',
            startLine: 10,
            metricType: 'cyclomatic',
            baseComplexity: 18,
            headComplexity: 12,
            delta: -6,
            threshold: 15,
            severity: 'improved',
          },
        ],
      });

      const signals = computeRiskSignals(context);
      expect(signals.newViolations).toBe(1);
      expect(signals.improvedViolations).toBe(1);
    });

    it('counts high-risk files with dependents', () => {
      const report = createTestReport([{ filepath: 'src/core.ts' }]);
      report.files['src/core.ts'].dependentCount = 5;

      const context = createTestContext({
        changedFiles: ['src/core.ts', 'src/util.ts'],
        complexityReport: report,
      });

      const signals = computeRiskSignals(context);
      expect(signals.highRiskFileCount).toBe(1);
    });

    it('extracts languages from chunks', () => {
      const context = createTestContext({
        changedFiles: ['src/a.ts', 'src/b.py'],
        chunks: [
          createTestChunk({ metadata: { language: 'typescript', file: 'src/a.ts' } }),
          createTestChunk({ metadata: { language: 'python', file: 'src/b.py' } }),
        ],
      });

      const signals = computeRiskSignals(context);
      expect(signals.languages).toEqual(['python', 'typescript']);
    });
  });

  describe('analyze', () => {
    it('returns empty when no LLM available', async () => {
      const context = createTestContext({
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'test',
          headSha: 'abc',
          baseSha: 'def',
        },
      });
      const findings = await plugin.analyze(context);
      expect(findings).toEqual([]);
    });

    it('sends prompt to LLM and returns finding', async () => {
      const llm = createMockLLMClient([makeSummaryLLMResponse()]);
      const context = createTestContext({
        changedFiles: ['src/deploy.ts'],
        chunks: [
          createTestChunk({
            content: 'function deploy() { /* ... */ }',
            metadata: { file: 'src/deploy.ts', symbolName: 'deploy', language: 'typescript' },
          }),
        ],
        llm,
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'Add CloudFormation rollout',
          headSha: 'abc',
          baseSha: 'def',
        },
      });

      const findings = await plugin.analyze(context);
      expect(findings).toHaveLength(1);
      expect(findings[0].pluginId).toBe('summary');
      expect(findings[0].category).toBe('summary');
      expect(findings[0].severity).toBe('info');

      const meta = findings[0].metadata as SummaryFindingMetadata;
      expect(meta.pluginType).toBe('summary');
      expect(meta.riskLevel).toBe('medium');
      expect(meta.confidence).toBe('high');
      expect(meta.keyChanges).toHaveLength(3);
    });

    it('includes PR title in LLM prompt', async () => {
      const llm = createMockLLMClient([makeSummaryLLMResponse()]);
      const context = createTestContext({
        changedFiles: ['src/a.ts'],
        chunks: [createTestChunk({ metadata: { file: 'src/a.ts' } })],
        llm,
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'My Special PR Title',
          headSha: 'abc',
          baseSha: 'def',
        },
      });

      await plugin.analyze(context);
      expect(llm.calls[0].prompt).toContain('My Special PR Title');
    });

    it('returns empty on unparseable LLM response', async () => {
      const llm = createMockLLMClient(['not valid json at all']);
      const context = createTestContext({
        changedFiles: ['src/a.ts'],
        chunks: [createTestChunk({ metadata: { file: 'src/a.ts' } })],
        llm,
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'test',
          headSha: 'abc',
          baseSha: 'def',
        },
      });

      const findings = await plugin.analyze(context);
      expect(findings).toEqual([]);
    });
  });

  describe('parseSummaryResponse', () => {
    it('parses valid JSON response', () => {
      const result = parseSummaryResponse(makeSummaryLLMResponse(), silentLogger);
      expect(result).not.toBeNull();
      expect(result!.risk_level).toBe('medium');
      expect(result!.confidence).toBe('high');
      expect(result!.key_changes).toHaveLength(3);
    });

    it('parses response wrapped in code block', () => {
      const wrapped = '```json\n' + makeSummaryLLMResponse() + '\n```';
      const result = parseSummaryResponse(wrapped, silentLogger);
      expect(result).not.toBeNull();
      expect(result!.risk_level).toBe('medium');
    });

    it('recovers JSON embedded in text', () => {
      const content = 'Here is my analysis:\n' + makeSummaryLLMResponse() + '\nHope that helps!';
      const result = parseSummaryResponse(content, silentLogger);
      expect(result).not.toBeNull();
      expect(result!.overview).toContain('CloudFormation');
    });

    it('returns null for completely invalid content', () => {
      const result = parseSummaryResponse('just some text with no json', silentLogger);
      expect(result).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      const incomplete = JSON.stringify({
        risk_level: 'medium',
        // missing confidence, overview, key_changes, risk_explanation
      });
      const result = parseSummaryResponse(incomplete, silentLogger);
      expect(result).toBeNull();
    });

    it('returns null for invalid risk_level', () => {
      const result = parseSummaryResponse(
        makeSummaryLLMResponse({ risk_level: 'extreme' }),
        silentLogger,
      );
      expect(result).toBeNull();
    });

    it('returns null for empty key_changes', () => {
      const result = parseSummaryResponse(
        makeSummaryLLMResponse({ key_changes: [] }),
        silentLogger,
      );
      expect(result).toBeNull();
    });
  });

  describe('formatSummaryMarkdown', () => {
    it('formats markdown with risk badge and key changes', () => {
      const md = formatSummaryMarkdown({
        risk_level: 'high',
        confidence: 'medium',
        risk_explanation: 'Touches critical infrastructure.',
        overview: 'Refactors deployment pipeline.',
        key_changes: ['Updated CI config', 'New rollback logic'],
      });

      expect(md).toContain('### Lien Summary');
      expect(md).toContain('**High Risk**');
      expect(md).toContain('Medium Confidence');
      expect(md).toContain('Touches critical infrastructure.');
      expect(md).toContain('**Overview** — Refactors deployment pipeline.');
      expect(md).toContain('- Updated CI config');
      expect(md).toContain('- New rollback logic');
      expect(md).toContain('*[Lien Review](https://lien.dev)*');
    });
  });

  describe('present', () => {
    function makePresentContext(overrides?: Partial<PresentContext>): PresentContext {
      return {
        complexityReport: createTestReport().complexityReport ?? createTestReport(),
        baselineReport: null,
        deltas: null,
        deltaSummary: null,
        logger: silentLogger,
        addAnnotations: vi.fn(),
        appendSummary: vi.fn(),
        updateDescription: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as PresentContext;
    }

    it('does nothing with no findings', async () => {
      const ctx = makePresentContext();
      await plugin.present!([], ctx);
      expect(ctx.appendSummary).not.toHaveBeenCalled();
    });

    it('updates PR description with summary section marker', async () => {
      const ctx = makePresentContext();
      const finding = {
        pluginId: 'summary',
        filepath: '',
        line: 0,
        severity: 'info' as const,
        category: 'summary',
        message: 'Adds two-phase rollout.',
        evidence: 'Touches deployment flow.',
        metadata: {
          pluginType: 'summary' as const,
          riskLevel: 'medium' as const,
          confidence: 'high' as const,
          overview: 'Adds two-phase rollout.',
          keyChanges: ['Updated templates', 'New script'],
        },
      };

      await plugin.present!([finding], ctx);

      expect(ctx.updateDescription).toHaveBeenCalledTimes(1);
      const [markdown, sectionId] = (ctx.updateDescription as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(sectionId).toBe('summary');
      expect(markdown).toContain('### Lien Summary');
      expect(markdown).toContain('**Medium Risk**');
    });

    it('appends summary to check run output', async () => {
      const ctx = makePresentContext();
      const finding = {
        pluginId: 'summary',
        filepath: '',
        line: 0,
        severity: 'info' as const,
        category: 'summary',
        message: 'Overview text.',
        evidence: 'Risk explanation.',
        metadata: {
          pluginType: 'summary' as const,
          riskLevel: 'low' as const,
          confidence: 'high' as const,
          overview: 'Overview text.',
          keyChanges: ['Change 1'],
        },
      };

      await plugin.present!([finding], ctx);
      expect(ctx.appendSummary).toHaveBeenCalledTimes(1);
      const summary = (ctx.appendSummary as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(summary).toContain('### Lien Summary');
    });

    it('works when updateDescription is not available', async () => {
      const ctx = makePresentContext({ updateDescription: undefined });
      const finding = {
        pluginId: 'summary',
        filepath: '',
        line: 0,
        severity: 'info' as const,
        category: 'summary',
        message: 'Overview.',
        evidence: 'Risk.',
        metadata: {
          pluginType: 'summary' as const,
          riskLevel: 'low' as const,
          confidence: 'high' as const,
          overview: 'Overview.',
          keyChanges: ['Change 1'],
        },
      };

      // Should not throw
      await plugin.present!([finding], ctx);
      expect(ctx.appendSummary).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildSummaryPrompt', () => {
    it('includes risk signals and PR context', () => {
      const signals = computeRiskSignals(
        createTestContext({
          changedFiles: ['src/a.ts', 'test/a.test.ts'],
          chunks: [createTestChunk({ metadata: { language: 'typescript', file: 'src/a.ts' } })],
        }),
      );

      const prompt = buildSummaryPrompt(signals, '### src/a.ts\n```\ncode\n```', {
        ...createTestContext(),
        pr: {
          owner: 'test',
          repo: 'repo',
          pullNumber: 1,
          title: 'My PR',
          headSha: 'abc',
          baseSha: 'def',
        },
      });

      expect(prompt).toContain('My PR');
      expect(prompt).toContain('Files changed: 2');
      expect(prompt).toContain('### src/a.ts');
      expect(prompt).toContain('risk_level');
      expect(prompt).toContain('confidence');
    });
  });
});
